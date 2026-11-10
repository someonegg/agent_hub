// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import { TerminalPreview } from "../../src/client/components/TerminalPreview";

function props() {
  return {
    preview: { revision: "1", content: "last snapshot", capturedAt: "now", truncated: false },
    previewExpanded: true,
    previewBusy: false,
    previewStopped: false,
    previewError: null as string | null,
    contentId: "terminal",
    actionsDisabled: false,
    onSendKeys: vi.fn().mockResolvedValue(undefined),
    onRetry: vi.fn(),
    onToggle: vi.fn(),
  };
}

it("preserves diagnostic summary focus and leaves its keyboard actions local", () => {
  const handlers = props();
  render(<TerminalPreview {...handlers} previewError="stream failed" />);
  const summary = screen.getByText("Diagnostic details");
  summary.focus();
  fireEvent.click(summary);
  expect(summary).toHaveFocus();
  expect(fireEvent.keyDown(summary, { key: "Enter" })).toBe(true);
  expect(handlers.onSendKeys).not.toHaveBeenCalled();
});

it("keeps stream and keyboard failures independent and clears keyboard failures on reopen", async () => {
  const handlers = props();
  handlers.onSendKeys.mockRejectedValueOnce(new Error("key failed"));
  const view = render(<TerminalPreview {...handlers} previewError="stream failed" previewBusy />);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Up" })));
  expect(screen.getByRole("alert")).toHaveTextContent("key failed");
  expect(screen.getByRole("status")).toHaveTextContent("Reconnecting");
  expect(screen.getByLabelText("Terminal content")).toHaveTextContent("last snapshot");
  view.rerender(<TerminalPreview {...handlers} />);
  expect(screen.getByRole("alert")).toHaveTextContent("key failed");
  view.rerender(<TerminalPreview {...handlers} previewExpanded={false} />);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  view.rerender(<TerminalPreview {...handlers} />);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("has one stopped notice, a usable retry, and expandable diagnostics without an empty placeholder", () => {
  const handlers = props();
  render(
    <TerminalPreview {...handlers} preview={null} previewStopped previewError="stream failed" />,
  );
  expect(screen.getAllByRole("status")).toHaveLength(1);
  expect(screen.queryByText("Terminal preview unavailable.")).not.toBeInTheDocument();
  expect(screen.getByText("stream failed")).not.toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Retry terminal" }));
  expect(handlers.onRetry).toHaveBeenCalledOnce();
});

it("ignores a late keyboard failure after closing and reopening", async () => {
  let reject!: (error: Error) => void;
  const handlers = props();
  handlers.onSendKeys.mockImplementationOnce(
    () =>
      new Promise<void>((_, fail) => {
        reject = fail;
      }),
  );
  const view = render(<TerminalPreview {...handlers} />);
  fireEvent.click(screen.getByRole("button", { name: "Up" }));
  view.rerender(<TerminalPreview {...handlers} previewExpanded={false} />);
  view.rerender(<TerminalPreview {...handlers} />);
  await act(async () => reject(new Error("late failure")));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("distinguishes first capture and an empty snapshot and preserves content while reconnecting", () => {
  const handlers = props();
  const view = render(<TerminalPreview {...handlers} preview={null} previewBusy />);
  expect(screen.getByText("Capturing terminal pane…")).toBeInTheDocument();
  view.rerender(<TerminalPreview {...handlers} preview={{ ...handlers.preview, content: "" }} />);
  expect(screen.getByText("The terminal pane is empty.")).toBeInTheDocument();
  view.rerender(<TerminalPreview {...handlers} previewBusy previewError="disconnected" />);
  expect(screen.getByText("Reconnecting…")).toBeInTheDocument();
  expect(screen.getByLabelText("Terminal content")).toHaveTextContent("last snapshot");
  expect(screen.queryByText("Capturing terminal pane…")).not.toBeInTheDocument();
});

it("renders a truncated terminal preview as plain text", () => {
  const handlers = props();
  render(
    <TerminalPreview
      {...handlers}
      preview={{
        ...handlers.preview,
        content: "\u001b[31mplain text<img src=x onerror=alert(1)><script>alert(2)</script>",
        truncated: true,
      }}
    />,
  );

  const content = screen.getByLabelText("Terminal content");
  expect(content).toHaveTextContent(
    "plain text<img src=x onerror=alert(1)><script>alert(2)</script>",
  );
  expect(content.querySelector("img")).toBeNull();
  expect(content.querySelector("script")).toBeNull();
  expect(screen.getByText(/terminal output exceeded the preview limit/i)).toBeInTheDocument();
});

it.each([
  ["Enter", "enter"],
  ["ArrowLeft", "left"],
  ["0", "0"],
  ["Escape", "interrupt"],
])("maps physical %s in the preview and prevents defaults", (physical, key) => {
  const handlers = props();
  render(<TerminalPreview {...handlers} />);
  const body = screen.getByRole("group", { name: "Terminal controls" }).parentElement!;
  body.focus();
  expect(body).toHaveFocus();
  expect(fireEvent.keyDown(body, { key: physical })).toBe(false);
  expect(handlers.onSendKeys).toHaveBeenLastCalledWith([key]);
  const button = screen.getByRole("button", { name: /^Left$/ });
  button.focus();
  expect(fireEvent.keyDown(button, { key: physical })).toBe(false);
  expect(handlers.onSendKeys).toHaveBeenCalledTimes(2);
  expect(handlers.onToggle).not.toHaveBeenCalled();
  expect(button).toHaveFocus();
});

it("interrupts with Ctrl+c in the preview without collapsing it", () => {
  const handlers = props();
  render(<TerminalPreview {...handlers} />);
  const body = screen.getByRole("group", { name: "Terminal controls" }).parentElement!;
  expect(fireEvent.keyDown(body, { key: "c", ctrlKey: true })).toBe(false);
  expect(handlers.onSendKeys).toHaveBeenCalledExactlyOnceWith(["interrupt"]);
  expect(handlers.onToggle).not.toHaveBeenCalled();
});

it("sends once when Enter is pressed on a terminal button", async () => {
  const handlers = props();
  const user = userEvent.setup();
  render(<TerminalPreview {...handlers} />);
  screen.getByRole("button", { name: /^Up$/ }).focus();
  await user.keyboard("{Enter}");
  expect(handlers.onSendKeys).toHaveBeenCalledExactlyOnceWith(["enter"]);
});

it("follows new terminal output near the end and preserves a scrolled reading position", () => {
  const handlers = props();
  const view = render(<TerminalPreview {...handlers} />);
  const content = screen.getByLabelText("Terminal content");
  Object.defineProperties(content, {
    scrollHeight: { configurable: true, value: 1000 },
    clientHeight: { configurable: true, value: 300 },
  });
  content.scrollTop = 675;
  fireEvent.scroll(content);
  view.rerender(
    <TerminalPreview
      {...handlers}
      preview={{ ...handlers.preview, revision: "2", content: "new output" }}
    />,
  );
  expect(content.scrollTop).toBe(1000);
  content.scrollTop = 400;
  fireEvent.scroll(content);
  view.rerender(
    <TerminalPreview
      {...handlers}
      preview={{ ...handlers.preview, revision: "3", content: "more output" }}
    />,
  );
  expect(content.scrollTop).toBe(400);
});

it("keeps close-button keyboard activation local instead of sending Enter to the terminal", async () => {
  const handlers = props();
  const user = userEvent.setup();
  render(<TerminalPreview {...handlers} />);
  screen.getByRole("button", { name: "Collapse terminal" }).focus();
  await user.keyboard("{Enter}");
  expect(handlers.onToggle).toHaveBeenCalledOnce();
  expect(handlers.onSendKeys).not.toHaveBeenCalled();
});
