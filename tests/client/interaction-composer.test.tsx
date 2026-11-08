// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

import { InteractionComposer } from "../../src/client/components/InteractionComposer";
import { updatePreferences } from "../../src/client/state/preferences";

beforeEach(() => {
  updatePreferences({ enterToSend: false });
});

function props() {
  return {
    sessionId: "composer-test",
    interactionAvailable: true,
    interactionBusy: false,
    composerExpanded: true,
    previewExpanded: false,
    error: null,
    onDismissError: vi.fn(),
    onSendMessage: vi.fn().mockResolvedValue(undefined),
    onSendKeys: vi.fn().mockResolvedValue(undefined),
    onHandoffPaneBinding: vi.fn().mockResolvedValue(undefined),
    onExpandPreview: vi.fn(),
    scrollToEnd: vi.fn(),
  };
}

it("keeps a draft and its error when collapsed or disconnected", () => {
  const handlers = { ...props(), error: "send failed" };
  const view = render(<InteractionComposer {...handlers} />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "draft" } });
  view.rerender(<InteractionComposer {...handlers} composerExpanded={false} />);
  expect(screen.getByRole("alert")).toHaveTextContent("send failed");
  view.rerender(<InteractionComposer {...handlers} interactionAvailable={false} />);
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("send failed");
  view.rerender(<InteractionComposer {...handlers} />);
  expect(screen.getByRole("textbox")).toHaveValue("draft");
});

it("inserts a newline on Enter, sends on Shift+Enter, and clears after success", async () => {
  const handlers = props();
  const user = userEvent.setup();
  render(<InteractionComposer {...handlers} />);
  const textarea = screen.getByRole("textbox", { name: "Message to agent" });
  expect(textarea).toHaveAttribute("rows", "3");
  await user.type(textarea, "line one{enter}line two");
  expect(textarea).toHaveValue("line one\nline two");
  expect(handlers.onSendMessage).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
  });
  expect(handlers.onSendMessage).toHaveBeenCalledWith("line one\nline two");
  expect(textarea).toHaveValue("");
});

it("keeps Send focusable but blocks activation for blank input", async () => {
  const handlers = props();
  const user = userEvent.setup();
  render(<InteractionComposer {...handlers} />);
  const textarea = screen.getByRole("textbox", { name: "Message to agent" });
  const send = screen.getByRole("button", { name: "Send" });
  expect(send).toBeEnabled();
  expect(send).toHaveAttribute("aria-disabled", "true");
  screen.getByRole("button", { name: "Attach files" }).focus();
  await user.tab();
  expect(send).toHaveFocus();
  await user.keyboard("{Enter}");
  await user.click(send);
  expect(handlers.onSendMessage).not.toHaveBeenCalled();

  await user.type(textarea, "   ");
  expect(send).toHaveAttribute("aria-disabled", "true");
  await user.click(send);
  fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
  expect(handlers.onSendMessage).not.toHaveBeenCalled();
  expect(handlers.onSendKeys).not.toHaveBeenCalled();
  expect(textarea).toHaveValue("   ");
});

it.each([false, true])(
  "protects IME confirmation and key repeat with enterToSend=%s",
  (enterToSend) => {
    updatePreferences({ enterToSend });
    const handlers = props();
    render(<InteractionComposer {...handlers} />);
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "中文" } });
    for (const options of [{ isComposing: true }, { keyCode: 229 }, { repeat: true }]) {
      fireEvent.keyDown(textarea, { key: "Enter", shiftKey: !enterToSend, ...options });
    }
    expect(handlers.onSendMessage).not.toHaveBeenCalled();
    expect(textarea).toHaveValue("中文");
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: !enterToSend });
    expect(handlers.onSendMessage).toHaveBeenCalledExactlyOnceWith("中文");
  },
);

it("retains the draft after failed delivery", async () => {
  const handlers = props();
  handlers.onSendMessage.mockRejectedValueOnce(new Error("offline"));
  render(<InteractionComposer {...handlers} />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "/plan" } });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Send" })));
  expect(screen.getByRole("textbox")).toHaveValue("/plan");
  expect(handlers.onSendMessage).toHaveBeenCalledExactlyOnceWith("/plan");
});

it("switches send shortcuts live", async () => {
  const handlers = props();
  render(<InteractionComposer {...handlers} />);
  act(() => updatePreferences({ enterToSend: true }));
  const textarea = screen.getByRole("textbox");
  expect(textarea).toHaveAttribute(
    "placeholder",
    expect.stringContaining("Shift+Enter for newline"),
  );
  for (const message of ["hello", "/help"]) {
    fireEvent.change(textarea, { target: { value: message } });
    expect(fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true })).toBe(true);
    expect(handlers.onSendMessage).not.toHaveBeenCalled();
    await act(async () => {
      expect(fireEvent.keyDown(textarea, { key: "Enter" })).toBe(false);
    });
    expect(handlers.onSendMessage).toHaveBeenCalledWith(message);
    expect(textarea).toHaveValue("");
    handlers.onSendMessage.mockClear();
  }
});
