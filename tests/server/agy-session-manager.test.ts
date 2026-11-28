import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, it, vi } from "vitest";

import { AgySessionManager } from "../../src/server/adapters/agy/session-manager.js";
import { TmuxLauncher } from "../../src/server/interaction/tmux-launcher.js";
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
  worktree: true,
  permissionMode: "default" as const,
};

async function setup() {
  const directory = await createTempDirectory("agy-manager-");
  const tmux = new TmuxLauncher(socket);
  return { directory, tmux, manager: new AgySessionManager(directory, tmux, "/custom bin/agy") };
}

it.each([
  ["default", false],
  ["auto", true],
  ["yolo", true],
] as const)(
  "builds create/resume arguments (mode=%s, resume=%s) and ignores worktree",
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
