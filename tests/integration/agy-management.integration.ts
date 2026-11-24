import { execFileSync } from "node:child_process";
import { access, chmod, mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { expect, it, vi } from "vitest";

import { createAhub } from "../../src/server/create-hub.js";
import { createApiRouter } from "../../src/server/http/api-router.js";
import { startHttpServer } from "../helpers/http-server.js";
import { createTempDirectory } from "../helpers/temp-directories.js";

/** A minimal fake `agy`: writes transcript_full.jsonl, echoes input, exits on a double Ctrl+C. */
const fakeAgy = (home: string) => `#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const args = process.argv.slice(2);
const resume = args.indexOf("--resume") >= 0 ? args[args.indexOf("--resume") + 1] : null;
let id = resume || require("crypto").randomUUID();
const logs = () => path.join(${JSON.stringify(home)}, "brain", id, ".system_generated", "logs");
const write = (row) => {
  fs.mkdirSync(logs(), { recursive: true });
  fs.appendFileSync(path.join(logs(), "transcript_full.jsonl"), JSON.stringify({ created_at: new Date().toISOString(), ...row }) + "\\n");
};
const user = (text) => write({ source: "USER_EXPLICIT", type: "USER_INPUT", content: "<USER_REQUEST>\\n" + text + "\\n</USER_REQUEST>" });
const model = (content) => write({ source: "MODEL", type: "PLANNER_RESPONSE", content });
const prompt = args[args.indexOf("-i") + 1];
if (resume) write({ source: "SYSTEM", type: "SYSTEM_MESSAGE", content: "resumed" });
user(prompt);
model("OK");
let buffer = "";
let interrupts = 0;
process.stdin.setRawMode(true);
process.stdin.on("data", (data) => {
  for (const char of data.toString().replace(/\\x1b\\[20[01]~/g, "")) {
    if (char === "\\x03") { if (++interrupts >= 2) process.exit(0); continue; }
    interrupts = 0;
    if (char === "\\x15" || char === "\\x1b") buffer = "";
    else if (char === "\\r") {
      if (buffer === "/clear") id = require("crypto").randomUUID();
      else if (buffer) { user(buffer); model(buffer.includes("[ahub-bind:") ? "OK" : "Echo: " + buffer); }
      buffer = "";
    } else buffer += char;
  }
});
process.stdin.resume();
`;

it("runs the Antigravity lifecycle with a fake agy", async () => {
  const root = await realpath(await createTempDirectory("aga-"));
  const directory = join(root, "project");
  const agent = join(root, "agent");
  const socket = join(root, `tmux-${process.getuid!()}`, "default");
  let hub: Awaited<ReturnType<typeof createAhub>> | undefined;
  try {
    vi.stubEnv("TMUX", undefined);
    vi.stubEnv("TMUX_TMPDIR", root);
    await mkdir(directory);
    await mkdir(agent);
    const command = join(root, "agy");
    await writeFile(command, fakeAgy(agent));
    await chmod(command, 0o755);
    hub = await createAhub({ agents: [{ nickname: "agy", path: agent, adapter: "agy", command }] });
    const active = hub;
    const { base } = await startHttpServer(createApiRouter(hub), () => active.close());
    const until = async (predicate: () => Promise<boolean>, description: string) => {
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        await active.operations.poll();
        if (await predicate()) return;
        await delay(100);
      }
      throw new Error(`Timed out: ${description}`);
    };
    const succeeded = async (id: string) => {
      await until(async () => {
        const op = await active.operations.get(id);
        if (op?.status === "failed" || op?.status === "unknown")
          throw new Error(JSON.stringify(op));
        return op?.status === "succeeded";
      }, "operation confirmation");
      return (await active.operations.get(id))!;
    };
    const messages = async (id: string) => JSON.stringify(await active.sessions.messages(id, {}));

    const created = await succeeded(
      active.operations.create({
        projectDirectory: directory,
        worktree: true,
        requestId: "agy-create",
      }).operationId,
    );
    const sessionId = created.sessionId!;
    const snapshot = await active.sessions.managementSnapshot();
    const nativeId = snapshot.byId.get(sessionId)!.sourceId;
    expect(snapshot.byId.get(sessionId)).toMatchObject({
      projectDirectory: directory,
      workingDirectory: directory,
    });
    expect(await active.sessions.messages(sessionId, {})).toMatchObject({ items: [] });
    expect((await active.sessions.list()).agents).toEqual([
      { nickname: "agy", runtimeName: "Antigravity", management: { archive: false } },
    ]);

    await active.interaction.sendMessage(sessionId, "Say hello");
    await until(async () => (await messages(sessionId)).includes("Echo: Say hello"), "echo");

    const archive = await fetch(`${base}/api/v1/sessions/${sessionId}/archive`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(archive.status).toBe(409);
    expect(await archive.json()).toMatchObject({ error: { code: "operation_not_supported" } });

    await active.interaction.sendKeys(sessionId, ["interrupt"]);
    expect(await active.interaction.describe(sessionId)).toMatchObject({ state: "connected" });
    await succeeded(active.operations.manage("exit", sessionId).operationId);
    expect(await active.interaction.describe(sessionId)).toMatchObject({ state: "disconnected" });

    const resumed = await succeeded(
      active.operations.create({ resumeSessionId: sessionId, requestId: "agy-resume" }).operationId,
    );
    expect(resumed.sessionId).toBe(sessionId);
    expect((await active.sessions.managementSnapshot()).byId.get(sessionId)?.sourceId).toBe(
      nativeId,
    );
    expect(await messages(sessionId)).not.toContain("ahub-bind:");

    await active.interaction.sendMessage(sessionId, "/clear");
    const handoff = await fetch(`${base}/api/v1/sessions/${sessionId}/handoff-pane-binding`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(handoff.status).toBe(204);
    await until(async () => {
      await active.sessions.refresh();
      const interaction = await active.interaction.describe(sessionId);
      return interaction?.supported === true && interaction.state === "superseded";
    }, "handoff ownership");
    const superseded = await active.interaction.describe(sessionId);
    if (!superseded?.supported || !superseded.supersededBySessionId)
      throw new Error("Missing handoff session");
    const handoffId = superseded.supersededBySessionId;
    const handoffNative = (await active.sessions.managementSnapshot()).byId.get(
      handoffId,
    )!.sourceId;
    expect(handoffNative).not.toBe(nativeId);
    expect(await messages(handoffId)).not.toContain("ahub-bind:");

    await succeeded(active.operations.manage("delete", handoffId).operationId);
    await expect(access(join(agent, "brain", handoffNative))).rejects.toThrow();
  } finally {
    hub?.close();
    vi.unstubAllEnvs();
    try {
      execFileSync("tmux", ["-S", socket, "kill-server"], { stdio: "ignore" });
    } catch {}
  }
}, 120_000);
