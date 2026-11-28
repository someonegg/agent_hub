import { execFileSync } from "node:child_process";
import { mkdir, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { expect, it, vi } from "vitest";

import { formatClaudeBindingMessage } from "../../src/server/adapters/claude/binding-message.js";
import { createAhub } from "../../src/server/create-hub.js";
import { createApiRouter } from "../../src/server/http/api-router.js";
import { TmuxInteractionService } from "../../src/server/interaction/tmux-service.js";
import { startHttpServer } from "../helpers/http-server.js";
import { createTempDirectory } from "../helpers/temp-directories.js";

/** Native CLI and tmux; credentials, model responses, agents and projects are test-owned. */
it("runs the Claude lifecycle across cold and running default servers", async () => {
  const root = await realpath(await createTempDirectory("ahc-"));
  const directory = join(root, "project");
  const agent = join(root, "agent");
  const socket = join(root, `tmux-${process.getuid!()}`, "default");
  const initialResolvers: (() => void)[] = [];
  const releaseInitial = () => {
    for (const resolve of initialResolvers.splice(0)) resolve();
  };
  let cleanupHub: { close(): void } | undefined;
  let cleanupApi: ReturnType<typeof createServer> | undefined;
  const spies: { mockRestore(): void }[] = [];
  try {
    vi.stubEnv("TMUX", undefined);
    vi.stubEnv("TMUX_TMPDIR", root);
    await mkdir(directory);
    await mkdir(agent);
    execFileSync("git", ["-C", directory, "init", "-q"]);
    execFileSync("git", [
      "-C",
      directory,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "--allow-empty",
      "-qm",
      "Test",
    ]);
    let mode: "text" | "question" | "hold" | "initial" = "initial";
    let requests = 0;
    const api = createServer(async (req, res) => {
      for await (const _ of req) {
        /* Drain the request without retaining prompts. */
      }
      if (!req.url?.includes("/messages")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
        return;
      }
      requests++;
      if (mode === "hold") {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.flushHeaders();
        return;
      }
      if (mode === "initial") {
        await new Promise<void>((resolve) => {
          initialResolvers.push(resolve);
        });
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      const event = (type: string, data: unknown) =>
        res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
      event("message_start", {
        type: "message_start",
        message: {
          id: `msg_test_${requests}`,
          type: "message",
          role: "assistant",
          model: "claude-sonnet-4-6",
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 0 },
        },
      });
      const question = mode === "question";
      mode = "text";
      event("content_block_start", {
        type: "content_block_start",
        index: 0,
        content_block: question
          ? { type: "tool_use", id: "ask_native", name: "AskUserQuestion", input: {} }
          : { type: "text", text: "" },
      });
      event("content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: question
          ? {
              type: "input_json_delta",
              partial_json: JSON.stringify({
                questions: [
                  {
                    header: "Test",
                    question: "Choose a test option",
                    options: [
                      { label: "One", description: "First" },
                      { label: "Two", description: "Second" },
                    ],
                    multiSelect: false,
                  },
                ],
              }),
            }
          : { type: "text_delta", text: "Native Claude integration response" },
      });
      event("content_block_stop", { type: "content_block_stop", index: 0 });
      event("message_delta", {
        type: "message_delta",
        delta: { stop_reason: question ? "tool_use" : "end_turn", stop_sequence: null },
        usage: { output_tokens: 1 },
      });
      event("message_stop", { type: "message_stop" });
      res.end();
    });
    cleanupApi = api;
    await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
    const address = api.address();
    if (!address || typeof address === "string") throw new Error("Missing mock address");
    const key = "test-only-not-a-real-api-key";
    await writeFile(
      join(agent, ".claude.json"),
      JSON.stringify({
        hasCompletedOnboarding: true,
        lastOnboardingVersion: "2.1.318",
        theme: "dark",
        customApiKeyResponses: { approved: [key.slice(-20)], rejected: [] },
        projects: {
          [directory]: { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true },
        },
      }),
    );
    await writeFile(
      join(agent, "settings.json"),
      JSON.stringify({
        env: {
          ANTHROPIC_API_KEY: key,
          ANTHROPIC_BASE_URL: `http://127.0.0.1:${address.port}`,
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
        },
        model: "claude-sonnet-4-6",
      }),
    );
    const options = {
      agents: [{ nickname: "claude", path: agent, adapter: "claude" as const }],
    };
    const hub = await createAhub(options);
    cleanupHub = hub;
    let activeHub = hub;
    const sendKeys = vi.spyOn(TmuxInteractionService.prototype, "sendKeys");
    const sendMessage = vi.spyOn(TmuxInteractionService.prototype, "sendMessage");
    spies.push(sendKeys, sendMessage);
    const initialKill = vi.spyOn(hub.interaction, "killTarget");
    const { base } = await startHttpServer(createApiRouter(hub), () => hub.close());
    const until = async (predicate: () => Promise<boolean>, description: string) => {
      const deadline = Date.now() + 45_000;
      while (Date.now() < deadline) {
        await activeHub.operations.poll();
        if (await predicate()) return;
        await delay(100);
      }
      let terminal = "";
      try {
        terminal = execFileSync("tmux", ["-S", socket, "capture-pane", "-p"], { encoding: "utf8" });
      } catch {}
      throw new Error(`Timed out: ${description}\n${terminal}`);
    };
    const succeeded = async (id: string) => {
      await until(async () => {
        const op = await activeHub.operations.get(id);
        if (op?.status === "failed" || op?.status === "unknown")
          throw new Error(JSON.stringify(op));
        return op?.status === "succeeded";
      }, "operation confirmation");
      return (await activeHub.operations.get(id))!;
    };
    const created = await succeeded(
      hub.operations.create({
        projectDirectory: directory,
        worktree: false,
        requestId: "claude-native-create",
      }).operationId,
    );
    expect(sendKeys).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
    const sessionId = created.sessionId!;
    const projects = join(agent, "projects");
    const rawJsonl = async () => {
      const directories = await readdir(projects, { withFileTypes: true });
      const files = (
        await Promise.all(
          directories
            .filter((entry) => entry.isDirectory())
            .map(async (entry) => {
              const project = join(projects, entry.name);
              return (await readdir(project))
                .filter((name) => name.endsWith(".jsonl"))
                .map((name) => join(project, name));
            }),
        )
      ).flat();
      return (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("\n");
    };
    expect(await rawJsonl()).toContain(
      JSON.stringify(
        formatClaudeBindingMessage(
          { socketPath: socket, sessionName: `ahub-${created.operationId}` },
          directory,
          null,
          created.operationId,
        ),
      ),
    );
    expect(await hub.sessions.messages(sessionId, {})).toMatchObject({ items: [] });
    await until(async () => initialResolvers.length > 0, "initial model request");
    mode = "text";
    releaseInitial();
    await until(
      async () =>
        JSON.stringify(await hub.sessions.messages(sessionId, {})).includes(
          "Native Claude integration response",
        ),
      "initial response after binding",
    );
    const nativeId = (await hub.sessions.managementSnapshot()).byId.get(sessionId)!.sourceId;
    expect(nativeId).toMatch(/^[a-f0-9-]+$/);
    expect((await hub.sessions.list()).agents).toEqual([
      { nickname: "claude", runtimeName: "Claude Code", management: { archive: true } },
    ]);
    expect(await hub.interaction.describe(sessionId)).toMatchObject({
      supported: true,
      state: "connected",
    });
    const beforeHello = requests;
    await hub.interaction.sendMessage(sessionId, "Say hello");
    await until(
      async () =>
        requests > beforeHello &&
        JSON.stringify(await hub.sessions.messages(sessionId, {})).includes("Say hello"),
      "ordinary response",
    );
    mode = "question";
    await hub.interaction.sendMessage(sessionId, "Ask a test question");
    await until(
      async () =>
        JSON.stringify(await hub.sessions.messages(sessionId, {})).includes("Choose a test option"),
      "question request",
    );
    await hub.interaction.sendKeys(sessionId, ["down", "enter"]);
    await until(
      async () =>
        JSON.stringify(await hub.sessions.messages(sessionId, {})).includes('"outcome":"answered"'),
      "question answer",
    );
    mode = "hold";
    const before = requests;
    await hub.interaction.sendMessage(sessionId, "Wait until interrupted");
    await until(async () => requests > before, "in-flight response");
    await hub.interaction.sendKeys(sessionId, ["interrupt"]);
    mode = "text";
    await succeeded(hub.operations.manage("exit", sessionId).operationId);
    expect(await hub.interaction.describe(sessionId)).toMatchObject({
      supported: true,
      state: "disconnected",
    });
    sendKeys.mockClear();
    sendMessage.mockClear();
    const resumed = await succeeded(
      hub.operations.create({ resumeSessionId: sessionId, requestId: "claude-native-resume" })
        .operationId,
    );
    expect(resumed.sessionId).toBe(sessionId);
    expect(sendKeys).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
    const resumeTarget = await hub.interaction.resolveTarget(sessionId);
    expect(resumeTarget).toMatchObject({
      socketPath: socket,
      sessionName: `ahub-${resumed.operationId}`,
    });
    expect((await hub.sessions.managementSnapshot()).byId.get(sessionId)?.sourceId).toBe(nativeId);
    const transport = new TmuxInteractionService();
    expect(await rawJsonl()).toContain(
      JSON.stringify(
        formatClaudeBindingMessage(resumeTarget!, directory, null, resumed.operationId),
      ),
    );
    const resumeMarker = "ahub-bind:";
    const capture = async () => (await transport.captureTerminal(resumeTarget!)).content;
    await until(async () => (await capture()).includes(resumeMarker), "resume prompt in pane");
    await hub.interaction.sendMessage(sessionId, "/clear");
    await until(
      async () => !(await capture()).includes(resumeMarker),
      "cleared Claude conversation",
    );
    sendMessage.mockClear();
    const handoff = await fetch(`${base}/api/v1/sessions/${sessionId}/handoff-pane-binding`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(handoff.status).toBe(204);
    const handoffMessage = formatClaudeBindingMessage(resumeTarget!, directory, null);
    expect(sendMessage).toHaveBeenCalledOnce();
    expect(sendMessage).toHaveBeenCalledWith(resumeTarget, handoffMessage, expect.any(Function));
    await until(
      async () => (await rawJsonl()).includes(JSON.stringify(handoffMessage)),
      "handoff JSONL",
    );
    expect(sendKeys).not.toHaveBeenCalled();
    await until(async () => {
      await hub.sessions.refresh();
      const interaction = await hub.interaction.describe(sessionId);
      return interaction?.supported === true && interaction.state === "superseded";
    }, "handoff ownership");
    const superseded = await hub.interaction.describe(sessionId);
    expect(superseded).toMatchObject({
      state: "superseded",
      supersededBySessionId: expect.any(String),
    });
    if (!superseded?.supported || !superseded.supersededBySessionId)
      throw new Error("Missing handoff session");
    const handoffSessionId = superseded.supersededBySessionId;
    expect(handoffSessionId).not.toBe(sessionId);
    expect(await hub.interaction.resolveTarget(handoffSessionId)).toEqual(resumeTarget);
    hub.close();
    const restarted = await createAhub(options);
    activeHub = restarted;
    const restartedKill = vi.spyOn(restarted.interaction, "killTarget");
    try {
      expect(await restarted.interaction.resolveTarget(handoffSessionId)).toEqual(resumeTarget);
      expect(await restarted.interaction.describe(sessionId)).toMatchObject({
        state: "superseded",
        supersededBySessionId: handoffSessionId,
      });
      expect(JSON.stringify(await restarted.sessions.messages(handoffSessionId, {}))).not.toContain(
        "ahub-bind:",
      );
      const worktree = await succeeded(
        restarted.operations.create({
          projectDirectory: directory,
          worktree: true,
          requestId: "claude-native-worktree",
        }).operationId,
      );
      const session = (await restarted.sessions.managementSnapshot()).byId.get(
        worktree.sessionId!,
      )!;
      expect(session.projectDirectory).toBe(directory);
      expect(session.workingDirectory).not.toBe(directory);
      await succeeded(restarted.operations.manage("exit", session.id).operationId);
      const deleteTarget = await restarted.interaction.resolveTarget(handoffSessionId);
      expect(deleteTarget).not.toBeNull();
      await succeeded(restarted.operations.manage("archive", handoffSessionId).operationId);
      expect(
        (await restarted.sessions.managementSnapshot()).byId.get(handoffSessionId)?.archived,
      ).toBe(true);
      await succeeded(restarted.operations.manage("delete", handoffSessionId).operationId);
      expect((await restarted.sessions.managementSnapshot()).byId.has(handoffSessionId)).toBe(
        false,
      );
      expect(await new TmuxInteractionService().inspect(deleteTarget!)).toBe("exited");
      // Ctrl-C is adapter-compatible; native versions may require the shared fallback.
      const killedTargets = [...initialKill.mock.calls, ...restartedKill.mock.calls].map(
        ([target]) => JSON.stringify(target),
      );
      expect(new Set(killedTargets).size).toBe(killedTargets.length);
      expect(killedTargets.length).toBeLessThanOrEqual(3);
    } finally {
      restarted.close();
    }
  } finally {
    cleanupHub?.close();
    releaseInitial();
    for (const spy of spies) spy.mockRestore();
    vi.unstubAllEnvs();
    try {
      execFileSync("tmux", ["-S", socket, "kill-server"], { stdio: "ignore" });
    } catch {}
    const apiToClose = cleanupApi;
    if (apiToClose?.listening) {
      apiToClose.closeAllConnections();
      await new Promise<void>((resolve) => apiToClose.close(() => resolve()));
    }
  }
}, 180_000);
