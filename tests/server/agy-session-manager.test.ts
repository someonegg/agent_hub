import { execFileSync } from "node:child_process";
import { access, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, it, vi } from "vitest";

import { AgySessionManager } from "../../src/server/adapters/agy/session-manager.js";
import { TmuxLauncher } from "../../src/server/interaction/tmux-launcher.js";
import { SessionLaunchError } from "../../src/server/management/session-manager.js";
import { createTempDirectory } from "../helpers/temp-directories.js";

const operationId = "00000000-0000-4000-8000-000000000001";
const nativeId = "11111111-2222-4333-8444-555555555555";
const socket = "/tmp/agy-test.sock";
const target = { socketPath: socket, sessionName: `ahub-${operationId}` };
const launchOptions = {
  operationId,
  workingDirectory: "/launch-directory",
  projectDirectory: "/project",
  taskName: "Task",
  worktree: false,
  permissionMode: "default" as const,
};

async function setup(trustWorkspaceForSession?: boolean) {
  const directory = await createTempDirectory("agy-manager-");
  const tmux = new TmuxLauncher(socket);
  return {
    directory,
    tmux,
    manager: new AgySessionManager(directory, tmux, "/custom bin/agy", trustWorkspaceForSession),
  };
}

it.each([
  ["default", false],
  ["auto", true],
  ["yolo", true],
] as const)(
  "builds create/resume arguments (mode=%s, resume=%s)",
  async (permissionMode, resume) => {
    const { directory, tmux, manager } = await setup();
    await writeFile(join(directory, ".ahub-env"), 'HTTPS_PROXY="http://proxy.local:8080"\n');
    const launch = vi
      .spyOn(tmux, "launchWithTarget")
      .mockImplementation(async (id, cwd, prepare, env) => {
        const argv = prepare(target);
        expect(id).toBe(operationId);
        expect(cwd).toBe("/launch-directory");
        expect(env).toEqual({ HTTPS_PROXY: "http://proxy.local:8080" });
        expect(argv.slice(0, -1)).toEqual([
          "/custom bin/agy",
          ...(resume ? ["--resume", nativeId] : []),
          ...(permissionMode === "auto" ? ["--mode", "auto"] : []),
          ...(permissionMode === "yolo" ? ["--dangerously-skip-permissions"] : []),
          "-i",
        ]);
        expect(argv.at(-1)).toContain('"workingDirectory":"/launch-directory"');
        expect(argv.at(-1)).toContain('"projectDirectory":"/project"');
        return {} as never;
      });
    await manager.launch({
      ...launchOptions,
      permissionMode,
      ...(resume ? { resumeNativeId: nativeId } : {}),
    });
    expect(launch).toHaveBeenCalledOnce();
  },
);

it.each([
  ["/launch-directory", undefined, ["/launch-directory"]],
  ["/project", nativeId, ["/launch-directory", "/project"]],
  [undefined, undefined, ["/launch-directory"]],
] as const)(
  "scopes workspace trust with project directory %s",
  async (projectDirectory, resumeNativeId, trustedWorkspaces) => {
    const { directory, tmux, manager } = await setup(true);
    const settingsPath = join(directory, "settings.json");
    const globalSettings = JSON.stringify({ trustedWorkspaces: ["/third-party"] });
    await writeFile(settingsPath, globalSettings);
    const launch = vi
      .spyOn(tmux, "launchWithTarget")
      .mockImplementation(async (_id, _cwd, prepare) => {
        const args = prepare(target);
        expect(JSON.parse(args[args.indexOf("--settings") + 1]!)).toEqual({ trustedWorkspaces });
        return target;
      });
    await manager.launch({ ...launchOptions, projectDirectory, resumeNativeId });
    expect(launch).toHaveBeenCalledOnce();
    expect(await readFile(settingsPath, "utf8")).toBe(globalSettings);
  },
);

it("rejects worktree creation outside Git before launching tmux", async () => {
  const { directory, tmux, manager } = await setup();
  const launch = vi.spyOn(tmux, "launchWithTarget");
  await expect(
    manager.launch({ ...launchOptions, workingDirectory: directory, worktree: true }),
  ).rejects.toThrow("requires a working directory inside a Git repository");
  expect(launch).not.toHaveBeenCalled();
});

it("creates a canonicalized worktree and retains it on launch failure", async () => {
  const { directory, tmux, manager } = await setup(true);
  const repo = join(directory, "repo");
  await mkdir(repo);
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
  git("init", "-q");
  git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "-qm",
    "base",
    "--allow-empty",
  );
  const worktree = join(await realpath(directory), ".agent-hub", "worktrees", operationId);
  const error = new SessionLaunchError("not_started", "tmux launch failed");
  vi.stubEnv("HOME", directory);
  vi.stubEnv("USERPROFILE", directory);
  try {
    vi.spyOn(tmux, "launchWithTarget").mockImplementation(async (_id, cwd, prepare) => {
      expect(cwd).toBe(worktree);
      const args = prepare(target);
      expect(JSON.parse(args[args.indexOf("--settings") + 1]!)).toEqual({
        trustedWorkspaces: [worktree, "/project"],
      });
      throw error;
    });
    await expect(
      manager.launch({ ...launchOptions, workingDirectory: repo, worktree: true }),
    ).rejects.toBe(error);
    expect(git("worktree", "list", "--porcelain")).toContain(operationId);
    expect(git("branch", "--list", `ahub/${operationId}`)).toContain(`ahub/${operationId}`);
  } finally {
    vi.unstubAllEnvs();
  }
});

it("validates session identities", async () => {
  const { manager } = await setup();
  await expect(manager.launch({ ...launchOptions, resumeNativeId: "bad" })).rejects.toThrow(
    "Invalid resume identity",
  );
  await expect(manager.delete("../x")).rejects.toThrow("Invalid Antigravity session identity");
  await expect(manager.archive("../x")).rejects.toThrow("Invalid Antigravity session identity");
});

it("deletes UUID-named files best-effort without touching the summary database", async () => {
  const { directory, manager } = await setup();
  const paths = [
    join("brain", nativeId, "a.txt"),
    join("conversations", `${nativeId}.db`),
    join("conversations", `${nativeId}.db-wal`),
    join("annotations", `${nativeId}.pbtxt`),
    join("presence", `${nativeId}.lock`),
    join("conversations", "conversation_summaries.db"),
  ];
  for (const path of paths) {
    await mkdir(join(directory, path, ".."), { recursive: true });
    await writeFile(join(directory, path), "x");
  }
  await manager.delete(nativeId);
  await manager.delete(nativeId);
  for (const path of paths.slice(0, -1))
    await expect(access(join(directory, path))).rejects.toThrow();
  await expect(access(join(directory, paths.at(-1)!))).resolves.toBeUndefined();
});

it("keeps archived history when an associated file cannot be removed", async () => {
  const { directory, manager } = await setup();
  const transcript = join(
    directory,
    "brain",
    nativeId,
    ".system_generated",
    "logs",
    "transcript_full.jsonl",
  );
  const blocked = join(directory, "conversations", `${nativeId}.db`);
  const annotation = join(directory, "annotations", `${nativeId}.pbtxt`);
  const archive = join(directory, "ahub_archived_sessions", `${nativeId}.jsonl`);
  await mkdir(join(transcript, ".."), { recursive: true });
  await mkdir(blocked, { recursive: true });
  await mkdir(join(annotation, ".."));
  await writeFile(transcript, "history");
  await writeFile(annotation, "annotation");

  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    await manager.archive(nativeId);
    expect(warn).toHaveBeenCalledWith(expect.any(String), blocked, expect.any(Error));
    expect(await readFile(archive, "utf8")).toBe("history");
    await expect(access(annotation)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(transcript)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(blocked)).resolves.toBeUndefined();
  } finally {
    warn.mockRestore();
  }
});
