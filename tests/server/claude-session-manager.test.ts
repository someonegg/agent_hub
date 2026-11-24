import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, it, vi } from "vitest";

import {
  ClaudeBindingIndex,
  claudeSourceKey,
} from "../../src/server/adapters/claude/binding-index.js";
import { claudeInteraction } from "../../src/server/adapters/claude/interaction.js";
import { ClaudeSessionManager } from "../../src/server/adapters/claude/session-manager.js";
import { interruptSteps } from "../../src/server/adapters/shared/session-management.js";
import { TmuxLauncher } from "../../src/server/interaction/tmux-launcher.js";
import { SessionLaunchError } from "../../src/server/management/session-manager.js";
import { createTempDirectory } from "../helpers/temp-directories.js";

const operationId = "00000000-0000-4000-8000-000000000001";
const nativeId = "11111111-2222-4333-8444-555555555555";
const socket = "/tmp/claude-test.sock";
const target = { socketPath: socket, sessionName: `ahub-${operationId}` };
const launchOptions = {
  operationId,
  workingDirectory: "/launch-directory",
  projectDirectory: "/project",
  taskName: "Task",
  worktree: false,
  permissionMode: "default" as const,
};

async function setup() {
  const directory = await createTempDirectory("claude-manager-");
  const bindings = join(directory, "bindings");
  const index = new ClaudeBindingIndex(bindings, claudeSourceKey(directory));
  const tmux = new TmuxLauncher(socket);
  const manager = new ClaudeSessionManager(directory, tmux, index, "/custom bin/claude");
  return { directory, bindings, index, tmux, manager };
}

it.each([
  ["default", false, false],
  ["default", true, false],
  ["yolo", true, false],
  ["auto", false, true],
] as const)(
  "publishes the binding before respawning Claude (mode=%s, worktree=%s, resume=%s)",
  async (permissionMode, worktree, resume) => {
    const { directory, bindings, tmux, manager } = await setup();
    await writeFile(join(directory, ".ahub-env"), 'CLAUDE_ENV_TEST="hello world"\n');
    const launch = vi
      .spyOn(tmux, "launchWithTarget")
      .mockImplementation(async (id, cwd, prepare, env) => {
        await expect(access(bindings)).rejects.toMatchObject({ code: "ENOENT" });
        const argv = await prepare(target);
        const [file] = await readdir(bindings);
        expect(file).toMatch(/^[a-f0-9]{32}\.json$/);
        expect(JSON.parse(await readFile(join(bindings, file!), "utf8"))).toEqual({
          ...target,
          kind: resume ? "resume" : "create",
          operationId,
          ...(resume ? { nativeId } : {}),
          source: claudeSourceKey(directory),
        });
        expect(id).toBe(operationId);
        expect(cwd).toBe("/launch-directory");
        expect(argv).toEqual([
          "/custom bin/claude",
          ...(resume ? ["--resume", nativeId] : []),
          ...(worktree ? ["--worktree"] : []),
          ...(permissionMode === "auto"
            ? ["--permission-mode", "auto"]
            : permissionMode === "yolo"
              ? ["--dangerously-skip-permissions"]
              : []),
          ...(worktree ? ["--"] : []),
          `Ignore this message and reply with only "OK". [ahub-bind:${JSON.stringify({
            id: file!.slice(0, -5),
            project: "/project",
            task: "Task",
          })}]`,
        ]);
        expect(env).toEqual({ CLAUDE_CONFIG_DIR: directory, CLAUDE_ENV_TEST: "hello world" });
        return target;
      });
    await expect(
      manager.launch({
        ...launchOptions,
        worktree,
        permissionMode,
        ...(resume ? { resumeNativeId: nativeId } : {}),
      }),
    ).resolves.toEqual(target);
    expect(launch).toHaveBeenCalledOnce();
  },
);

it("does not publish a record when session creation fails and propagates publication errors", async () => {
  const { tmux, manager, bindings } = await setup();
  const launch = vi.spyOn(tmux, "launchWithTarget");
  launch.mockRejectedValueOnce(new Error("tmux new-session failed"));
  await expect(manager.launch(launchOptions)).rejects.toThrow("tmux new-session failed");
  await expect(access(bindings)).rejects.toMatchObject({ code: "ENOENT" });

  await writeFile(bindings, "not a directory");
  launch.mockImplementationOnce(async (_id, _cwd, prepare) => {
    await prepare(target);
    return target;
  });
  await expect(manager.launch(launchOptions)).rejects.toMatchObject({ code: "EEXIST" });
  expect(launch).toHaveBeenCalledTimes(2);
});

it("discards temporary binding records only when respawn fails with not_started", async () => {
  const { tmux, manager, bindings } = await setup();
  const launch = vi.spyOn(tmux, "launchWithTarget");
  launch.mockImplementationOnce(async (_id, _cwd, prepare) => {
    await prepare(target);
    throw new SessionLaunchError("not_started", "tmux respawn-pane failed", null);
  });
  await expect(manager.launch(launchOptions)).rejects.toThrow("tmux respawn-pane failed");
  expect(await readdir(bindings)).toEqual([]);

  launch.mockImplementationOnce(async (_id, _cwd, prepare) => {
    await prepare(target);
    throw new SessionLaunchError("unknown", "tmux respawn-pane failed", "tmux attach", target);
  });
  await expect(manager.launch(launchOptions)).rejects.toThrow("tmux respawn-pane failed");
  expect(await readdir(bindings)).toHaveLength(1);
});

it("validates identity, binding metadata, and missing directories before starting Claude", async () => {
  const { tmux, manager, directory } = await setup();
  const launch = vi.spyOn(tmux, "launchWithTarget");
  await expect(manager.launch({ ...launchOptions, resumeNativeId: "invalid" })).rejects.toThrow(
    "Invalid resume identity",
  );
  await expect(
    manager.launch({ ...launchOptions, projectDirectory: "relative/project" }),
  ).rejects.toThrow("Invalid Claude binding record");
  await expect(manager.launch({ ...launchOptions, taskName: "   " })).rejects.toThrow(
    "Invalid Claude binding record",
  );
  expect(launch).not.toHaveBeenCalled();
  await expect(manager.resolveDirectory(join(directory, "missing"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  await expect(manager.resolveDirectory("relative/path")).rejects.toThrow("absolute local path");
});

it("provides shared interrupt steps and two pairs of exit interrupts", async () => {
  const { manager, index } = await setup();
  expect(claudeInteraction(index, null, null).interruptSteps).toBe(interruptSteps);
  let elapsed = 0;
  expect(
    manager.exitSteps().map((step) => ({
      keys: step.keys,
      atMs: (elapsed += step.delayMs),
    })),
  ).toEqual([
    { keys: ["C-c"], atMs: 0 },
    { keys: ["C-c"], atMs: 200 },
    { keys: ["C-c"], atMs: 2600 },
    { keys: ["C-c"], atMs: 2800 },
  ]);
});

it("deletes Claude logs and subagents across projects while preserving other content", async () => {
  const { directory: agent, manager } = await setup();
  const id = "11111111-2222-4333-8444-555555555555";
  for (const project of ["one", "two"]) {
    const root = join(agent, "projects", project);
    await mkdir(join(root, id, "subagents", "nested"), { recursive: true });
    await writeFile(join(root, `${id}.jsonl`), "history");
    await writeFile(join(root, id, "subagents", "nested", "agent.jsonl"), "agent");
    await writeFile(join(root, id, "keep"), "keep");
    await writeFile(join(root, "other.jsonl"), "other");
  }
  await expect(manager.delete("../invalid")).rejects.toThrow("Invalid Claude");
  await manager.delete(id);
  await manager.delete(id);
  for (const project of ["one", "two"]) {
    const root = join(agent, "projects", project);
    await expect(access(join(root, `${id}.jsonl`))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(join(root, id, "subagents"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(root, id, "keep"), "utf8")).toBe("keep");
    expect(await readFile(join(root, "other.jsonl"), "utf8")).toBe("other");
  }
});
