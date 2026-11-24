import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { beforeEach, expect, it, vi } from "vitest";

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn }));
vi.mock("node:fs", () => ({ lstatSync: () => ({ isSocket: () => true, uid: process.getuid!() }) }));
import { createTmuxPreviewListener } from "../../src/server/interaction/tmux-preview-listener.js";

beforeEach(() => spawn.mockReset());

function child() {
  return Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    stdin: new PassThrough(),
    kill: vi.fn(),
  });
}
const binding = {
  socketPath: "/tmp/control.sock",
  sessionName: "ahub-00000000-0000-0000-0000-000000000001",
};
it("shares socket/session clients, parses fragmented notifications, and closes the final subscription", async () => {
  const process = child();
  spawn.mockReturnValue(process);
  const listen = createTmuxPreviewListener();
  const first = vi.fn();
  const second = vi.fn();
  const a = listen(binding, first, vi.fn());
  const b = listen(binding, second, vi.fn());
  expect(spawn).toHaveBeenCalledTimes(1);
  expect(spawn.mock.calls[0]![1]).toEqual([
    "-S",
    binding.socketPath,
    "-C",
    "attach-session",
    "-f",
    "ignore-size",
    "-E",
    "-t",
    `=${binding.sessionName}:`,
  ]);
  process.stdout.write("%begin 1 1 0\n%en");
  process.stdout.write("d 1 1 0\n%out");
  await a.ready;
  process.stdout.write("put %1 hello\\012world\n%layout-change @1 layout\n");
  expect(first.mock.calls).toEqual([[true], [false]]);
  expect(second.mock.calls).toEqual(first.mock.calls);
  a.close();
  expect(process.kill).not.toHaveBeenCalled();
  b.close();
  expect(process.kill).toHaveBeenCalledOnce();
});
it("ignores terminal input-mode changes and empty synchronized output", async () => {
  const process = child();
  spawn.mockReturnValue(process);
  const listen = createTmuxPreviewListener();
  const changes = vi.fn();
  const subscription = listen(binding, changes, vi.fn());
  process.stdout.write("%end 1 1 0\n");
  await subscription.ready;

  const ignored = [
    "%output %1 \\033[?2004h\\033[>4;2m",
    "%output %1 \\033[?2004l\\033[?1004h\\033[?1004l",
    "%output %1 \\033[?2004;1004h\\033[?1004;2004l",
    "%output %1 \\033[>4m\\033[>4;0m\\033[>1u\\033[>u\\033[<1u\\033[<u\\033[=1u\\033[=1;2u",
    "%output %1 \\033[?2026h\\033[?2026l",
    "%output %1 \\033[?2026h\\033[?2004h\\033[>4;2m\\033[?2026l",
    "%output %1 \\033[?2026h\\033[?2026h\\033[?2026l\\033[?2026l",
    "%output %1 ",
    "%extended-output %1 12 : \\033[?2004h\\033[>4;2m",
    "%extended-output %1 12 flag1 flag2 : \\033[?2026h\\033[?1004h\\033[?2026l",
  ];
  for (const line of ignored) {
    process.stdout.write(`${line}\n`);
    expect(changes, line).not.toHaveBeenCalled();
  }

  const reported = [
    "%output %1 \\033[?2004hhello",
    "%output %1 \\033[31m",
    "%output %1 \\033[u",
    "%output %1 \\033[?25h",
    "%output %1 \\033[?25;2004h",
    "%output %1 \\033[?2026h",
    "%output %1 \\033[?2026l",
    "%output %1 \\134033[?2004h",
    "%output %1 \\033[?200",
    "%output %1",
    "%extended-output %1 12 : a : \\033[?2004h",
    "%extended-output %1 12 malformed",
  ];
  for (const line of reported) {
    changes.mockClear();
    process.stdout.write(`${line}\n`);
    expect(changes.mock.calls, line).toEqual([[true]]);
  }
  subscription.close();
});
it.each(["error", "close", "protocol", "timeout"])(
  "rejects startup and notifies subscribers on %s",
  async (kind) => {
    vi.useFakeTimers();
    const process = child();
    spawn.mockReturnValue(process);
    const listen = createTmuxPreviewListener();
    const failed = vi.fn();
    const a = listen(binding, vi.fn(), failed);
    const rejected = expect(a.ready).rejects.toThrow();
    if (kind === "error") process.emit("error", new Error("spawn failed"));
    if (kind === "close") process.emit("close", 1);
    if (kind === "protocol") process.stdout.write("%error 1 1 0\n");
    if (kind === "timeout") await vi.advanceTimersByTimeAsync(5000);
    await rejected;
    expect(failed).toHaveBeenCalledOnce();
    const replacement = child();
    spawn.mockReturnValue(replacement);
    const b = listen(binding, vi.fn(), vi.fn());
    replacement.stdout.write("%end 1 1 0\n");
    await b.ready;
    b.close();
  },
);
