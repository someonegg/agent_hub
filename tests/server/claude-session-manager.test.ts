import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, it, vi } from "vitest";

import { formatClaudeBindingMessage } from "../../src/server/adapters/claude/binding-message.js";
import { claudeInteraction } from "../../src/server/adapters/claude/interaction.js";
import { ClaudeSessionManager } from "../../src/server/adapters/claude/session-manager.js";
import { interruptSteps } from "../../src/server/adapters/shared/session-management.js";
import { TmuxLauncher } from "../../src/server/interaction/tmux-launcher.js";
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
  const tmux = new TmuxLauncher(socket);
  const manager = new ClaudeSessionManager(directory, tmux, "/custom bin/claude");
  return { directory, tmux, manager };
}

it.each([
  ["default", false, false],
  ["default", true, false],
  ["yolo", true, false],
  ["auto", false, true],
] as const)(
  "passes the binding as the first positional argument (mode=%s, worktree=%s, resume=%s)",
  async (permissionMode, worktree, resume) => {
    const { directory, tmux, manager } = await setup();
    await writeFile(join(directory, ".ahub-env"), 'CLAUDE_ENV_TEST="hello world"\n');
    const launch = vi
      .spyOn(tmux, "launchWithTarget")
      .mockImplementation(async (id, cwd, prepare, env) => {
        const argv = prepare(target);
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
            ...target,
            operationId,
            projectDirectory: "/project",
            taskName: "Task",
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

it("validates identity, binding inputs, and missing directories before starting Claude", async () => {
  const { tmux, manager, directory } = await setup();
  const launch = vi.spyOn(tmux, "launchWithTarget");
  await expect(manager.launch({ ...launchOptions, resumeNativeId: "invalid" })).rejects.toThrow(
    "Invalid resume identity",
  );
  await expect(manager.launch({ ...launchOptions, taskName: "bad\ntask" })).rejects.toThrow(
    "Task name",
  );
  expect(() =>
    formatClaudeBindingMessage({ ...target, socketPath: "relative" }, null, null),
  ).toThrow("Invalid Claude binding target");
  expect(() => formatClaudeBindingMessage(target, null, null, "invalid")).toThrow(
    "Invalid operation ID",
  );
  expect(launch).not.toHaveBeenCalled();
  await expect(manager.resolveDirectory(join(directory, "missing"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  await expect(manager.resolveDirectory("relative/path")).rejects.toThrow("absolute local path");
});

it("provides shared interrupt steps and two pairs of exit interrupts", async () => {
  const { manager } = await setup();
  expect(claudeInteraction(null, null).interruptSteps).toBe(interruptSteps);
  let elapsed = 0;
  expect(
    manager.exitSteps().map((step) => ({
      steps: step.steps,
      atMs: (elapsed += step.delayMs),
    })),
  ).toEqual([
    {
      steps: [
        { keys: ["C-c"], delayMs: 0 },
        { keys: ["C-c"], delayMs: 200 },
      ],
      atMs: 0,
    },
    {
      steps: [
        { keys: ["C-c"], delayMs: 0 },
        { keys: ["C-c"], delayMs: 150 },
      ],
      atMs: 2400,
    },
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
