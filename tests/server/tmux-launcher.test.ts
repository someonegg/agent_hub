import type * as ChildProcess from "node:child_process";

import { beforeEach, expect, it, vi } from "vitest";

import {
  attachCommand,
  shellQuote,
  TmuxLauncher,
} from "../../src/server/interaction/tmux-launcher.js";

const execute = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async (original) => {
  const { promisify } = await import("node:util");
  // execFile's custom promisifier returns both output streams; keep that contract
  // local to this callback-based substitute instead of replacing node:util.
  Object.defineProperty(execute, promisify.custom, {
    value: (file: string, args: string[], options: ChildProcess.ExecFileOptions) =>
      new Promise((resolve, reject) => {
        execute(file, args, options, (error: Error | null, stdout: string, stderr: string) => {
          if (error) reject(error);
          else resolve({ stdout, stderr });
        });
      }),
  });
  return { ...(await original<typeof ChildProcess>()), execFile: execute };
});

type ExecuteCallback = (error: Error | null, stdout: string, stderr: string) => void;

function succeeds(stdout: string) {
  return (
    _file: string,
    _args: string[],
    _options: ChildProcess.ExecFileOptions,
    callback: ExecuteCallback,
  ) => {
    callback(null, stdout, "");
  };
}

function fails(error: Error) {
  return (
    _file: string,
    _args: string[],
    _options: ChildProcess.ExecFileOptions,
    callback: ExecuteCallback,
  ) => {
    callback(error, "", "");
  };
}

beforeEach(() => {
  execute.mockReset();
  execute.mockImplementation(succeeds("/actual/tmux.sock"));
});
it.each([undefined, "/configured/socket path"])(
  "launches with configured socket %s and records the actual socket",
  async (socket) => {
    const binding = await new TmuxLauncher(socket).launch(
      "00000000-0000-0000-0000-000000000007",
      "/project",
      ["codex", "--no-daemon"],
      { CODEX_HOME: "/config with spaces" },
    );
    const args = execute.mock.calls[0]![1] as string[];
    expect(args.slice(0, socket ? 2 : 1)).toEqual(socket ? ["-S", socket] : ["new-session"]);
    expect(args.slice(args.indexOf("-s"), args.indexOf("-s") + 2)).toEqual([
      "-s",
      "ahub-00000000-0000-0000-0000-000000000007",
    ]);
    expect(args).toContain("AHUB_TMUX_SESSION_NAME=ahub-00000000-0000-0000-0000-000000000007");
    expect(args).toContain("CODEX_HOME=/config with spaces");
    expect(args.slice(-2)).toEqual(["codex", "--no-daemon"]);
    expect(args).not.toContain("-L");
    if (!socket) expect(args).not.toContain("-S");
    expect(binding.socketPath).toBe("/actual/tmux.sock");
    expect(execute.mock.calls[1]![1]).toEqual([
      "-S",
      "/actual/tmux.sock",
      "set-option",
      "-p",
      "-t",
      "=ahub-00000000-0000-0000-0000-000000000007:",
      "remain-on-exit",
      "off",
    ]);
  },
);
it("quotes shell values for attach", () => {
  expect(shellQuote("/tmp/a'b ; $HOME")).toBe(
    "'/tmp/a'" + String.fromCharCode(92) + "''b ; $HOME'",
  );
  expect(attachCommand(undefined, "ahub-123")).toBe("tmux attach-session -t '=ahub-123:'");
});

it("classifies a refused launch as definitely not started", async () => {
  execute.mockImplementationOnce(fails(new Error("refused")));
  await expect(
    new TmuxLauncher().launch("00000000-0000-0000-0000-000000000007", "/project", ["codex"]),
  ).rejects.toMatchObject({
    outcome: "not_started",
    attachCommand: null,
  });
  expect(execute).toHaveBeenCalledOnce();
});

it("preserves a fallback attach command when launch times out", async () => {
  execute.mockImplementationOnce(fails(Object.assign(new Error("timeout"), { killed: true })));
  await expect(
    new TmuxLauncher("/configured/socket").launch(
      "00000000-0000-0000-0000-000000000007",
      "/project",
      ["codex"],
    ),
  ).rejects.toMatchObject({
    outcome: "unknown",
    attachCommand: attachCommand("/configured/socket", "ahub-00000000-0000-0000-0000-000000000007"),
  });
  expect(execute).toHaveBeenCalledOnce();
});

it("preserves fallback attach for an invalid socket in launch output", async () => {
  execute.mockImplementationOnce(succeeds("relative"));
  await expect(
    new TmuxLauncher("/configured/socket").launch(
      "00000000-0000-0000-0000-000000000007",
      "/project",
      ["codex"],
    ),
  ).rejects.toMatchObject({
    outcome: "unknown",
    attachCommand: attachCommand("/configured/socket", "ahub-00000000-0000-0000-0000-000000000007"),
  });
  expect(execute).toHaveBeenCalledOnce();
});

it("keeps the known target when post-launch setup fails", async () => {
  execute
    .mockImplementationOnce(succeeds("/actual/socket"))
    .mockImplementationOnce(fails(new Error("set-option failed")));
  await expect(
    new TmuxLauncher().launch("00000000-0000-0000-0000-000000000007", "/project", ["codex"]),
  ).rejects.toMatchObject({
    outcome: "unknown",
    target: {
      socketPath: "/actual/socket",
      sessionName: "ahub-00000000-0000-0000-0000-000000000007",
    },
    attachCommand: attachCommand("/actual/socket", "ahub-00000000-0000-0000-0000-000000000007"),
  });
  expect(execute).toHaveBeenCalledTimes(2);
});

it("rejects an invalid session name before starting tmux", async () => {
  await expect(new TmuxLauncher().launch("invalid", "/project", ["codex"])).rejects.toMatchObject({
    outcome: "not_started",
  });
  expect(execute).not.toHaveBeenCalled();
});

it("preserves trailing spaces in the actual socket path", async () => {
  execute.mockImplementationOnce(succeeds("/actual/socket \n"));
  expect(
    await new TmuxLauncher().launch("00000000-0000-0000-0000-000000000007", "/project", ["codex"]),
  ).toEqual({
    socketPath: "/actual/socket ",
    sessionName: "ahub-00000000-0000-0000-0000-000000000007",
  });
});

it("quotes a lone executable for tmux's single-command shell behavior", async () => {
  await new TmuxLauncher().launch("00000000-0000-0000-0000-000000000007", "/project", [
    "/tools/custom agent",
  ]);
  expect(execute.mock.calls[0]![1].at(-1)).toBe("exec '/tools/custom agent'");
});

it("escapes trailing semicolons in env arguments and keeps values out of launch errors", async () => {
  execute.mockImplementationOnce(fails(new Error("Command failed: tmux -e TEST=secret")));
  await expect(
    new TmuxLauncher().launch("00000000-0000-0000-0000-000000000007", "/project", ["codex"], {
      TEST: "secret;",
    }),
  ).rejects.toThrow(/^tmux new-session failed$/);
  expect(execute.mock.calls[0]![1]).toContain("TEST=secret\\;");
});

it.each([undefined, "/configured/socket path"])(
  "creates a placeholder session before building and respawning a deferred command (%s)",
  async (socket) => {
    const tmux = new TmuxLauncher(socket);
    const prepare = vi.fn((target) => {
      expect(target).toEqual({
        socketPath: "/actual/tmux.sock",
        sessionName: "ahub-00000000-0000-0000-0000-000000000007",
      });
      expect(execute).toHaveBeenCalledTimes(1);
      return ["claude", "prompt"];
    });
    const binding = await tmux.launchWithTarget(
      "00000000-0000-0000-0000-000000000007",
      "/project",
      prepare,
      {
        CLAUDE_CONFIG_DIR: "/agent;",
        TEST: "value",
      },
    );
    expect(binding).toEqual({
      socketPath: "/actual/tmux.sock",
      sessionName: "ahub-00000000-0000-0000-0000-000000000007",
    });
    expect(prepare).toHaveBeenCalledOnce();
    const first = execute.mock.calls[0]![1] as string[];
    expect(first.slice(0, socket ? 2 : 1)).toEqual(socket ? ["-S", socket] : ["new-session"]);
    expect(first).not.toContain("-e");
    expect(first.slice(-2)).toEqual(["sleep", "60"]);
    expect(execute.mock.calls[1]![1]).toEqual([
      "-S",
      "/actual/tmux.sock",
      "respawn-pane",
      "-k",
      "-t",
      "=ahub-00000000-0000-0000-0000-000000000007:",
      "-e",
      "CLAUDE_CONFIG_DIR=/agent\\;",
      "-e",
      "TEST=value",
      "-e",
      "AHUB_TMUX_SESSION_NAME=ahub-00000000-0000-0000-0000-000000000007",
      "-c",
      "/project",
      "claude",
      "prompt",
    ]);
    expect(execute.mock.calls[2]![1]).toEqual([
      "-S",
      "/actual/tmux.sock",
      "set-option",
      "-p",
      "-t",
      "=ahub-00000000-0000-0000-0000-000000000007:",
      "remain-on-exit",
      "off",
    ]);
  },
);

it("cleans up the placeholder session when deferred preparation or respawn fails", async () => {
  const tmux = new TmuxLauncher();
  await expect(
    tmux.launchWithTarget("00000000-0000-0000-0000-000000000007", "/project", () => {
      throw new Error("command failed");
    }),
  ).rejects.toThrow("command failed");
  expect(execute).toHaveBeenCalledTimes(2);
  expect(execute.mock.calls[1]![1]).toEqual([
    "-S",
    "/actual/tmux.sock",
    "kill-session",
    "-t",
    "=ahub-00000000-0000-0000-0000-000000000007:",
  ]);

  execute.mockClear();
  execute
    .mockImplementationOnce(succeeds("/actual/tmux.sock"))
    .mockImplementationOnce(fails(new Error("Command failed: tmux -e SECRET=value")))
    .mockImplementationOnce(succeeds(""));
  await expect(
    tmux.launchWithTarget("00000000-0000-0000-0000-000000000007", "/project", () => ["claude"], {
      SECRET: "value",
    }),
  ).rejects.toMatchObject({
    outcome: "not_started",
    message: "tmux respawn-pane failed",
    attachCommand: null,
  });
  expect(execute.mock.calls[2]![1]).toEqual([
    "-S",
    "/actual/tmux.sock",
    "kill-session",
    "-t",
    "=ahub-00000000-0000-0000-0000-000000000007:",
  ]);

  execute.mockClear();
  execute
    .mockImplementationOnce(succeeds("/actual/tmux.sock"))
    .mockImplementationOnce(fails(Object.assign(new Error("timeout"), { killed: true })));
  await expect(
    tmux.launchWithTarget("00000000-0000-0000-0000-000000000007", "/project", () => ["claude"]),
  ).rejects.toMatchObject({
    outcome: "unknown",
    message: "tmux respawn-pane failed",
    target: {
      socketPath: "/actual/tmux.sock",
      sessionName: "ahub-00000000-0000-0000-0000-000000000007",
    },
    attachCommand: attachCommand("/actual/tmux.sock", "ahub-00000000-0000-0000-0000-000000000007"),
  });
  expect(execute).toHaveBeenCalledTimes(2);
});

it("rejects invalid configured socket paths before starting tmux", async () => {
  await expect(
    new TmuxLauncher("relative/socket").launch("00000000-0000-0000-0000-000000000007", "/project", [
      "codex",
    ]),
  ).rejects.toMatchObject({
    outcome: "not_started",
    message: "Invalid tmux socket path",
  });
  await expect(
    new TmuxLauncher("/bad\nsocket").launch("00000000-0000-0000-0000-000000000007", "/project", [
      "codex",
    ]),
  ).rejects.toMatchObject({
    outcome: "not_started",
    message: "Invalid tmux socket path",
  });
  expect(execute).not.toHaveBeenCalled();
});
