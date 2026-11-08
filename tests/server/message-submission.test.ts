import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { confirmMessageSubmission } from "../../src/server/interaction/message-submission.js";
import type { PreviewListener } from "../../src/server/interaction/tmux-preview-listener.js";

const binding = { socketPath: "/tmp/test.sock", sessionName: "test" };
let change: (output: boolean) => void;
let fail: (error: Error) => void;
let content: string;
let close: ReturnType<typeof vi.fn<() => void>>;
let read: ReturnType<typeof vi.fn<() => Promise<{ content: string; truncated: boolean }>>>;
let listen: PreviewListener;
beforeEach(() => {
  vi.useFakeTimers();
  content = "baseline";
  close = vi.fn();
  read = vi.fn(async () => ({ content, truncated: false }));
  listen = (_binding, changed, failed) => {
    change = changed;
    fail = failed;
    return { ready: Promise.resolve(), close };
  };
});
afterEach(() => vi.useRealTimers());
const prepare = () =>
  confirmMessageSubmission(binding, listen, () => new Error("message_not_submitted")).prepare(read);

it("observes fast echo before paste completes and submits only once", async () => {
  const confirmation = await prepare();
  content = "echo";
  change(true);
  await vi.advanceTimersByTimeAsync(350);
  await confirmation.confirm();
  confirmation.close();
  expect(read).toHaveBeenCalledTimes(2);
  expect(close).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it("does not count notifications or truncation changes as text changes", async () => {
  const confirmation = await prepare();
  const result = confirmation.confirm();
  const rejected = expect(result).rejects.toThrow("message_not_submitted");
  read.mockResolvedValue({ content, truncated: true });
  for (let i = 0; i < 20; i++) {
    change(true);
    await vi.advanceTimersByTimeAsync(100);
  }
  await rejected;
  confirmation.close();
  expect(read.mock.calls.length).toBeGreaterThan(2);
  expect(vi.getTimerCount()).toBe(0);
});

it("flushes a pending merge window at the deadline", async () => {
  const confirmation = await prepare();
  const result = confirmation.confirm();
  await vi.advanceTimersByTimeAsync(1900);
  content = "late echo";
  change(true);
  await vi.advanceTimersByTimeAsync(100);
  await result;
  confirmation.close();
  expect(read).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

it("waits for an in-flight read and drains pending notifications without overlapping reads", async () => {
  const confirmation = await prepare();
  let finish!: (value: { content: string; truncated: boolean }) => void;
  read.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const result = confirmation.confirm();
  change(true);
  await vi.advanceTimersByTimeAsync(350);
  change(true);
  await vi.advanceTimersByTimeAsync(1650);
  expect(read).toHaveBeenCalledTimes(2);
  content = "deadline echo";
  finish({ content: "baseline", truncated: false });
  await result;
  confirmation.close();
  expect(read).toHaveBeenCalledTimes(3);
});

it.each(["read", "listener"])("fails closed on %s failure and releases resources", async (kind) => {
  const confirmation = await prepare();
  const result = confirmation.confirm();
  const rejected = expect(result).rejects.toThrow("failed");
  if (kind === "listener") fail(new Error("failed"));
  else {
    read.mockRejectedValueOnce(new Error("failed"));
    change(true);
    await vi.advanceTimersByTimeAsync(350);
  }
  await rejected;
  confirmation.close();
  expect(close).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it("waits for listener readiness before reading a baseline", async () => {
  let ready!: () => void;
  listen = () => ({
    ready: new Promise<void>((resolve) => {
      ready = resolve;
    }),
    close,
  });
  const pending = prepare();
  await vi.advanceTimersByTimeAsync(500);
  expect(read).not.toHaveBeenCalled();
  ready();
  const confirmation = await pending;
  expect(read).toHaveBeenCalledOnce();
  confirmation.close();
  expect(close).toHaveBeenCalledOnce();
});

it("cleans up baseline and startup failures before paste", async () => {
  read.mockRejectedValueOnce(new Error("baseline failed"));
  await expect(prepare()).rejects.toThrow("baseline failed");
  expect(close).toHaveBeenCalledOnce();
  close.mockClear();
  listen = (_binding, _change, failed) => {
    failed(new Error("startup failed"));
    return { ready: new Promise(() => {}), close };
  };
  await expect(prepare()).rejects.toThrow("startup failed");
  expect(close).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
