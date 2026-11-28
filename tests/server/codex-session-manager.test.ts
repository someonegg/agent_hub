import { chmod, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, it, vi } from "vitest";

import { CodexSessionManager } from "../../src/server/adapters/codex/session-manager.js";
import { exitSteps } from "../../src/server/adapters/shared/session-management.js";
import { TmuxLauncher } from "../../src/server/interaction/tmux-launcher.js";
import { createTempDirectory } from "../helpers/temp-directories.js";

it.each(
  ([false, true] as const).flatMap((resume) =>
    (["default", "auto"] as const).map((permissionMode) => [resume, permissionMode] as const),
  ),
)("maps Codex launch mode (resume=%s, mode=%s)", async (resume, permissionMode) => {
  const tmux = new TmuxLauncher();
  const launch = vi
    .spyOn(tmux, "launch")
    .mockResolvedValue({ socketPath: "/tmp/test", sessionName: "test" });
  await new CodexSessionManager("/codex-home", tmux, undefined, true).launch({
    operationId: "54c105aa-3622-45bc-b4c4-e0fa9110d399",
    workingDirectory: resume ? "/worktrees/task" : '/project.with dots/"quoted"\\name',
    projectDirectory: '/project.with dots/"quoted"\\name',
    worktree: true,
    permissionMode,
    ...(resume ? { resumeNativeId: "00000000-0000-4000-8000-000000000001" } : {}),
  });
  const args = launch.mock.calls[0]![2];
  const configIndex = args.indexOf("-c");
  expect(configIndex).toBeGreaterThan(0);
  expect(args[configIndex + 1]).toBe(
    'projects={ "/project.with dots/\\"quoted\\"\\\\name" = { trust_level = "trusted" } }',
  );
  expect(launch.mock.calls[0]![1]).toBe(
    resume ? "/worktrees/task" : '/project.with dots/"quoted"\\name',
  );
  expect(args.filter((arg) => arg === "--approve-for-me")).toEqual(
    permissionMode === "auto" ? ["--approve-for-me"] : [],
  );
  expect(args).toContain("--worktree");
});

it("resumes an explicit UUID in the original CODEX_HOME with an operation binding prompt", async () => {
  const tmux = new TmuxLauncher();
  const launch = vi.spyOn(tmux, "launch").mockResolvedValue({
    socketPath: "/tmp/test",
    sessionName: "ahub-00000000-0000-0000-0000-000000000001",
  });
  const manager = new CodexSessionManager("/original-agent", tmux, undefined, true);
  const nativeId = "00000000-0000-4000-8000-000000000001";
  await manager.launch({
    operationId: "54c105aa-3622-45bc-b4c4-e0fa9110d399",
    workingDirectory: "/project",
    worktree: false,
    permissionMode: "default",
    resumeNativeId: nativeId,
  });
  const args = launch.mock.calls[0]![2];
  expect(args.slice(0, 3)).toEqual(["codex", "resume", nativeId]);
  expect(launch.mock.calls[0]![3]).toEqual({ CODEX_HOME: "/original-agent" });
  expect(args).not.toContain("--worktree");
  expect(args).not.toContain("-c");
  expect(args.at(-1)).toContain("54c105aa-3622-45bc-b4c4-e0fa9110d399");
  expect(manager.isValidNativeId(nativeId)).toBe(true);
  for (const resumeNativeId of ["malicious", "", "native:会话/42%"]) {
    expect(manager.isValidNativeId(resumeNativeId)).toBe(false);
    expect(() =>
      manager.launch({
        operationId: "54c105aa-3622-45bc-b4c4-e0fa9110d399",
        workingDirectory: "/project",
        worktree: false,
        permissionMode: "default",
        resumeNativeId,
      }),
    ).toThrow(/Invalid/);
    await expect(manager.archive(resumeNativeId)).rejects.toThrow(/UUID/);
    await expect(manager.delete(resumeNativeId)).rejects.toThrow(/UUID/);
  }
  expect(launch).toHaveBeenCalledOnce();
});

it("provides the shared exit capability", () => {
  expect(new CodexSessionManager("/test/home").exitSteps).toBe(exitSteps);
});

it("uses one literal executable for launch, archive, and delete", async () => {
  const directory = await createTempDirectory("codex-command-");
  const command = join(directory, "custom codex='literal'");
  const output = join(directory, "calls");
  await writeFile(
    command,
    `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
const call = { args: process.argv.slice(2), home: process.env.CODEX_HOME };
appendFileSync(${JSON.stringify(output)}, JSON.stringify(call) + "\\n");
`,
  );
  await chmod(command, 0o755);
  const tmux = new TmuxLauncher();
  const launch = vi
    .spyOn(tmux, "launch")
    .mockResolvedValue({ socketPath: "/tmp/test", sessionName: "test" });
  const manager = new CodexSessionManager("/custom home", tmux, command);
  const nativeId = "00000000-0000-4000-8000-000000000001";
  for (const resumeNativeId of [undefined, nativeId]) {
    await manager.launch({
      operationId: "54c105aa-3622-45bc-b4c4-e0fa9110d399",
      workingDirectory: "/project",
      worktree: false,
      permissionMode: "default",
      projectDirectory: "/project",
      ...(resumeNativeId ? { resumeNativeId } : {}),
    });
  }
  expect(launch.mock.calls.map((call) => call[2][0])).toEqual([command, command]);
  for (const [, , args] of launch.mock.calls) expect(args).not.toContain("-c");
  await manager.archive(nativeId);
  await manager.delete(nativeId);
  expect(
    (await readFile(output, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line)),
  ).toEqual([
    { args: ["archive", nativeId], home: "/custom home" },
    { args: ["delete", nativeId, "--force"], home: "/custom home" },
  ]);
});

it("reloads the home .ahub-env on launch and ignores a malformed file in full", async () => {
  const directory = await createTempDirectory("codex-env-");
  const file = join(directory, ".ahub-env");
  const tmux = new TmuxLauncher();
  const launch = vi
    .spyOn(tmux, "launch")
    .mockResolvedValue({ socketPath: "/tmp/test", sessionName: "test" });
  const manager = new CodexSessionManager(directory, tmux);
  const options = {
    operationId: "54c105aa-3622-45bc-b4c4-e0fa9110d399",
    workingDirectory: "/project",
    worktree: false,
    permissionMode: "default" as const,
  };

  await writeFile(join(directory, ".env"), "IGNORED=legacy\n");
  await manager.launch(options);
  expect(launch.mock.lastCall?.[3]).toEqual({ CODEX_HOME: directory });

  await writeFile(
    file,
    '# comment\r\nexport TEST = "a # b=$OTHER;" # comment\r\nCODEX_HOME=/other\r\nEMPTY=\r\n',
  );
  await manager.launch(options);
  expect(launch.mock.lastCall?.[3]).toEqual({
    CODEX_HOME: directory,
    TEST: "a # b=$OTHER;",
    EMPTY: "",
  });

  await writeFile(file, 'TEST=valid\nBROKEN =  "unterminated\n');
  await manager.launch(options);
  expect(launch.mock.lastCall?.[3]).toEqual({ CODEX_HOME: directory });
});
