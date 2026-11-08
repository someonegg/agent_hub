import { type ComponentProps, useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { InteractionResponse } from "../../src/shared/api-contract";
import type { UploadAttachment } from "../../src/shared/uploads";

import { InteractionRegion } from "../../src/client/components/InteractionRegion";
import { updatePreferences } from "../../src/client/state/preferences";
import { SessionDraftProvider } from "../../src/client/state/session-drafts";

// @vitest-environment jsdom

beforeEach(() => {
  updatePreferences({ enterToSend: false });
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:preview"),
  });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
});

function interaction(state: "unbound" | "disconnected" | "connected"): InteractionResponse {
  return {
    supported: true,
    activity: null,
    supersededBySessionId: null,
    attachCommand: null,
    state,
  };
}

function props(value: InteractionResponse | null) {
  return {
    sessionId: "session-a",
    interaction: value,
    interactionBusy: false,
    error: null,
    onDismissError: vi.fn(),
    onHandoffPaneBinding: vi.fn().mockResolvedValue(undefined),
    onExpandPreview: vi.fn(),
    onSendMessage: vi.fn().mockResolvedValue(undefined),
    onSendKeys: vi.fn().mockResolvedValue(undefined),
    preview: null,
    previewBusy: false,
    previewStopped: false,
    onRetryPreview: vi.fn(),
    previewError: null,
    onTogglePreview: vi.fn(),
  };
}

function StatefulInteractionRegion(
  properties: Omit<ComponentProps<typeof InteractionRegion>, "previewExpanded">,
) {
  const [expanded, setExpanded] = useState(properties.preview !== null);
  return (
    <InteractionRegion
      {...properties}
      previewExpanded={expanded}
      onExpandPreview={() => {
        properties.onExpandPreview();
        setExpanded(true);
      }}
      onTogglePreview={() => {
        properties.onTogglePreview();
        setExpanded((value) => !value);
      }}
    />
  );
}

describe("interaction region", () => {
  it("preserves focus on manual and automatic expansion, including before output arrives", async () => {
    const handlers = props(interaction("connected"));
    const user = userEvent.setup();
    const { rerender } = render(<InteractionRegion {...handlers} previewExpanded={false} />);
    const toggle = screen.getByRole("button", { name: "Terminal Preview" });
    const composer = screen.getByRole("textbox", { name: "Message to agent" });
    await user.click(composer);
    rerender(<InteractionRegion {...handlers} previewExpanded />);
    expect(composer).toHaveFocus();
    rerender(<InteractionRegion {...handlers} previewExpanded={false} />);
    await user.click(toggle);
    rerender(<InteractionRegion {...handlers} previewExpanded />);
    const previewBody = document.getElementById(toggle.getAttribute("aria-controls")!);
    expect(toggle).toHaveFocus();
    (previewBody as HTMLElement).focus();
    await user.keyboard("{ArrowUp}");
    expect(handlers.onSendKeys).toHaveBeenCalledWith(["up"]);
    await user.click(composer);
    rerender(
      <InteractionRegion
        {...handlers}
        previewExpanded
        preview={{
          content: "fresh output",
          truncated: false,
          revision: "r".repeat(43),
          capturedAt: "2026-08-08",
        }}
      />,
    );
    expect(composer).toHaveFocus();
    await user.click(toggle);
    rerender(<InteractionRegion {...handlers} previewExpanded={false} />);
    expect(toggle).toHaveFocus();
    await user.click(toggle);
    rerender(<InteractionRegion {...handlers} previewExpanded />);
    expect(toggle).toHaveFocus();
  });

  it("retains the region and draft through every unavailable state", () => {
    const handlers = props(interaction("connected"));
    const view = render(<StatefulInteractionRegion {...handlers} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Message to agent" }), {
      target: { value: "draft" },
    });
    const states: Array<InteractionResponse | null> = [
      interaction("disconnected"),
      {
        supported: true,
        activity: null,
        supersededBySessionId: null,
        state: "unknown",
        attachCommand: null,
      },
      interaction("unbound"),
      null,
      { supported: false, attachCommand: null },
    ];
    for (const state of states) {
      view.rerender(<StatefulInteractionRegion {...handlers} interaction={state} />);
      expect(screen.getByRole("region", { name: "Session interaction" })).toBeVisible();
      expect(screen.queryByRole("button", { name: "Terminal Preview" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^(Collapse|Expand)$/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
      expect(screen.queryByRole("region", { name: "Terminal Preview" })).not.toBeInTheDocument();
    }
    expect(handlers.onSendMessage).not.toHaveBeenCalled();
    view.rerender(<StatefulInteractionRegion {...handlers} />);
    expect(screen.getByRole("textbox", { name: "Message to agent" })).toBeEnabled();
    expect(screen.getByRole("textbox", { name: "Message to agent" })).toHaveValue("draft");
  });

  it("dispatches interaction controls and keeps the composer editable while actions are busy", async () => {
    const handlers = props(interaction("connected"));
    const user = userEvent.setup();
    const { rerender } = render(<StatefulInteractionRegion {...handlers} />);
    expect(screen.getByRole("textbox")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Interrupt" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Send" }).parentElement).toHaveClass(
      "interaction-primary-actions",
    );
    expect(screen.queryByRole("button", { name: "Esc" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Terminal Preview" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Interrupt" }));
    expect(screen.getByRole("button", { name: "Interrupt" })).toHaveFocus();
    expect(handlers.onSendKeys).toHaveBeenNthCalledWith(1, ["interrupt"]);
    expect(handlers.onSendKeys).toHaveBeenCalledTimes(1);

    await user.type(screen.getByRole("textbox"), "draft");
    const interrupt = screen.getByRole("button", { name: "Interrupt" });
    interrupt.focus();
    handlers.onSendKeys.mockClear();
    handlers.onSendMessage.mockClear();
    handlers.onExpandPreview.mockClear();
    rerender(<StatefulInteractionRegion {...handlers} interactionBusy />);

    expect(screen.getByRole("textbox")).toBeEnabled();
    expect(screen.getByRole("textbox")).toHaveValue("draft");
    expect(interrupt).toHaveFocus();
    expect(interrupt).toBeEnabled();
    expect(interrupt).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Terminal Preview" })).not.toHaveAttribute(
      "aria-disabled",
    );
    await user.click(interrupt);
    expect(handlers.onSendKeys).not.toHaveBeenCalled();
    expect(handlers.onSendMessage).not.toHaveBeenCalled();

    const send = screen.getByRole("button", { name: "Send" });
    expect(send).toBeEnabled();
    expect(send).toHaveAttribute("aria-disabled", "true");
    await user.click(send);
    expect(handlers.onSendMessage).not.toHaveBeenCalled();
    expect(handlers.onExpandPreview).not.toHaveBeenCalled();
  });

  it("sends the six terminal keys from the rectangular terminal keypad", async () => {
    const handlers = {
      ...props(interaction("connected")),
      preview: {
        content: "output",
        truncated: false,
        revision: "r".repeat(43),
        capturedAt: "2026-08-08T12:00:00.000Z",
      },
    };
    const user = userEvent.setup();
    const { rerender } = render(<StatefulInteractionRegion {...handlers} />);
    const keypad = screen.getByRole("group", { name: "Terminal controls" });
    expect(keypad).toBeInTheDocument();
    expect([...keypad.querySelectorAll("button")].map((button) => button.textContent)).toEqual([
      "Enter",
      "↑",
      "BTab",
      "←",
      "↓",
      "→",
    ]);

    screen.getByLabelText("Terminal content").focus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Terminal Preview" })).toHaveFocus();

    for (const name of ["Enter", "Up", "BTab", "Left", "Down", "Right"]) {
      await user.click(screen.getByRole("button", { name }));
    }
    expect(handlers.onSendKeys.mock.calls).toEqual([
      [["enter"]],
      [["up"]],
      [["BTab"]],
      [["left"]],
      [["down"]],
      [["right"]],
    ]);

    rerender(<StatefulInteractionRegion {...handlers} interactionBusy />);
    handlers.onSendKeys.mockClear();
    handlers.onExpandPreview.mockClear();
    for (const name of ["Enter", "Up", "BTab", "Left", "Down", "Right"]) {
      const button = screen.getByRole("button", { name });
      expect(button).toBeEnabled();
      expect(button).toHaveAttribute("aria-disabled", "true");
      await user.click(button);
    }
    expect(handlers.onSendKeys).not.toHaveBeenCalled();
    expect(handlers.onExpandPreview).not.toHaveBeenCalled();
  });
});

it.each([
  ["/plan", true],
  [" /plan", false],
])("sends %s with preview expansion=%s and preserves composer focus", async (message, expands) => {
  const user = userEvent.setup();
  const handlers = props(interaction("connected"));
  render(<StatefulInteractionRegion {...handlers} />);
  const textarea = screen.getByRole("textbox");
  const toggle = screen.getByRole("button", { name: "Terminal Preview" });
  textarea.focus();
  fireEvent.change(textarea, { target: { value: message } });
  await act(async () => fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true }));
  expect(handlers.onSendMessage).toHaveBeenCalledWith(message);
  expect(toggle).toHaveAttribute("aria-expanded", String(expands));
  expect(handlers.onExpandPreview).toHaveBeenCalledTimes(expands ? 1 : 0);
  if (!expands) {
    expect(textarea).toHaveFocus();
    return;
  }
  expect(textarea).toHaveFocus();
  document.getElementById(toggle.getAttribute("aria-controls")!)!.focus();
  await user.keyboard("{ArrowDown}");
  expect(handlers.onSendKeys).toHaveBeenCalledWith(["down"]);
  await user.click(toggle);
  await user.click(toggle);
  expect(toggle).toHaveFocus();
});

it("keeps an expanded preview open and preserves edits made during delivery", async () => {
  let resolve!: () => void;
  const handlers = props(interaction("connected"));
  handlers.onSendMessage.mockImplementationOnce(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  const view = render(<StatefulInteractionRegion {...handlers} />);
  const toggle = screen.getByRole("button", { name: "Terminal Preview" });
  fireEvent.click(toggle);
  const textarea = screen.getByRole("textbox");
  textarea.focus();
  fireEvent.change(textarea, { target: { value: "/plan" } });
  fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
  view.rerender(<StatefulInteractionRegion {...handlers} interactionBusy />);
  expect(textarea).toBeEnabled();
  expect(textarea).toHaveFocus();
  fireEvent.change(textarea, { target: { value: "下一条消息" } });
  fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
  expect(handlers.onSendMessage).toHaveBeenCalledExactlyOnceWith("/plan");
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  await act(async () => resolve());
  expect(textarea).toHaveValue("下一条消息");
  expect(textarea).toHaveFocus();
  expect(handlers.onExpandPreview).not.toHaveBeenCalled();
  expect(toggle).toHaveAttribute("aria-expanded", "true");
});

it("preserves the collapsed preview and draft after handoff and disables Handoff while busy or disconnected", async () => {
  const handlers = props(interaction("connected"));
  const view = render(<StatefulInteractionRegion {...handlers} />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "draft" } });
  const handoff = screen.getByRole("button", { name: "Handoff" });
  fireEvent.click(handoff);
  await act(async () => {
    await Promise.resolve();
  });
  expect(handlers.onHandoffPaneBinding).toHaveBeenCalledOnce();
  expect(handoff).toHaveAttribute(
    "title",
    "Hand off this pane’s binding to the active agent session.",
  );
  expect(screen.getByRole("textbox")).toHaveValue("draft");
  expect(screen.getByRole("button", { name: "Terminal Preview" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  handoff.focus();
  view.rerender(<StatefulInteractionRegion {...handlers} interactionBusy />);
  expect(handoff).toHaveFocus();
  fireEvent.click(handoff);
  expect(handlers.onHandoffPaneBinding).toHaveBeenCalledOnce();
  expect(handoff).toBeEnabled();
  expect(handoff).toHaveAttribute("aria-disabled", "true");
  view.rerender(
    <StatefulInteractionRegion {...handlers} interaction={interaction("disconnected")} />,
  );
  expect(screen.queryByRole("button", { name: "Handoff" })).not.toBeInTheDocument();
});

it("shows takeover beside the status, preserves drafts, and navigates to the replacement", () => {
  const handlers = props(interaction("connected"));
  const onNavigate = vi.fn();
  const view = render(<StatefulInteractionRegion {...handlers} onNavigate={onNavigate} />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "draft" } });
  view.rerender(
    <StatefulInteractionRegion
      {...handlers}
      onNavigate={onNavigate}
      interaction={{
        supported: true,
        activity: null,
        state: "superseded",
        supersededBySessionId: "replacement",
        attachCommand: null,
      }}
    />,
  );
  const status = screen.getByText("Superseded");
  expect(
    screen.queryByText("This pane is bound to another session. Your draft is preserved."),
  ).not.toBeInTheDocument();
  expect(screen.queryByText(/Connection unavailable/)).not.toBeInTheDocument();
  const link = screen.getByRole("link", { name: "Go to bound session" });
  expect(link.parentElement).toBe(status.parentElement);
  expect(link).toHaveAttribute("href", "/sessions/replacement");
  fireEvent.click(link);
  expect(onNavigate).toHaveBeenCalledWith("replacement");
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  for (const name of ["Send", "Handoff", "BTab"])
    expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
  view.rerender(<StatefulInteractionRegion {...props(interaction("connected"))} />);
  expect(screen.getByRole("textbox")).toHaveValue("draft");
});

it("shows the takeover even on first load, with no link when its session is missing", () => {
  render(
    <StatefulInteractionRegion
      {...props({
        supported: true,
        activity: null,
        state: "superseded",
        supersededBySessionId: null,
        attachCommand: null,
      })}
    />,
  );
  expect(screen.getByText("Superseded")).toBeVisible();
  expect(screen.getByText("Replacement session unavailable")).toBeVisible();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});

it("preserves expanded preview during and after handoff delivery", async () => {
  let resolve!: () => void;
  const handlers = props(interaction("connected"));
  handlers.onHandoffPaneBinding.mockImplementationOnce(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  render(<StatefulInteractionRegion {...handlers} />);
  const toggle = screen.getByRole("button", { name: "Terminal Preview" });
  fireEvent.click(toggle);
  handlers.onTogglePreview.mockClear();
  fireEvent.click(screen.getByRole("button", { name: "Handoff" }));
  expect(handlers.onHandoffPaneBinding).toHaveBeenCalledOnce();
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(handlers.onExpandPreview).not.toHaveBeenCalled();
  await act(async () => resolve());
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(handlers.onExpandPreview).not.toHaveBeenCalled();
  expect(handlers.onTogglePreview).not.toHaveBeenCalled();
});

it("collapses the preview with Escape without interrupting and restores toggle focus", () => {
  const handlers = props(interaction("connected"));
  render(<InteractionRegion {...handlers} previewExpanded interactionBusy />);
  const body = screen.getByRole("group", { name: "Terminal controls" }).parentElement!;
  body.focus();
  expect(fireEvent.keyDown(body, { key: "Escape" })).toBe(false);
  expect(handlers.onTogglePreview).toHaveBeenCalledExactlyOnceWith();
  expect(handlers.onSendKeys).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Terminal Preview" })).toHaveFocus();
});

it("ignores composer Escape while preserving preview, focus and draft", async () => {
  const handlers = props(interaction("connected"));
  const user = userEvent.setup();
  render(
    <StatefulInteractionRegion
      {...handlers}
      preview={{ revision: "1", content: "output", capturedAt: "now", truncated: false }}
    />,
  );
  const input = screen.getByRole("textbox");
  await user.click(input);
  await user.type(input, "unfinished draft");
  await user.keyboard("{Escape}");
  expect(screen.getByRole("button", { name: "Terminal Preview" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  expect(input).toHaveFocus();
  expect(input).toHaveValue("unfinished draft");
  expect(handlers.onTogglePreview).not.toHaveBeenCalled();
  expect(handlers.onSendKeys).not.toHaveBeenCalled();
  expect(handlers.onSendMessage).not.toHaveBeenCalled();
  await user.keyboard("{Escape}");
  expect(handlers.onTogglePreview).not.toHaveBeenCalled();
});

it("ignores interrupt shortcuts outside the preview, with other modifiers, or while busy", () => {
  const handlers = props(interaction("connected"));
  const view = render(<InteractionRegion {...handlers} previewExpanded />);
  const body = screen.getByRole("group", { name: "Terminal controls" }).parentElement!;
  for (const modifiers of [
    {},
    { metaKey: true },
    { ctrlKey: true, shiftKey: true },
    { ctrlKey: true, altKey: true },
    { ctrlKey: true, isComposing: true },
    { ctrlKey: true, keyCode: 229 },
  ]) {
    expect(fireEvent.keyDown(body, { key: "c", ...modifiers })).toBe(true);
  }
  expect(fireEvent.keyDown(screen.getByRole("textbox"), { key: "c", ctrlKey: true })).toBe(true);
  view.rerender(<InteractionRegion {...handlers} previewExpanded interactionBusy />);
  expect(fireEvent.keyDown(body, { key: "c", ctrlKey: true })).toBe(false);
  expect(handlers.onSendKeys).not.toHaveBeenCalled();
  expect(handlers.onTogglePreview).not.toHaveBeenCalled();
});

it("preserves editing and unrelated keyboard actions and blocks sends while busy or folded", () => {
  const handlers = props(interaction("connected"));
  const view = render(<InteractionRegion {...handlers} previewExpanded />);
  const body = screen.getByRole("group", { name: "Terminal controls" }).parentElement!;
  for (const modifier of ["shiftKey", "ctrlKey", "altKey", "metaKey", "isComposing"]) {
    for (const key of ["Enter", "Escape", "0", "9"]) {
      expect(fireEvent.keyDown(body, { key, [modifier]: true })).toBe(true);
    }
  }
  for (const key of ["Enter", "Escape", "0", "9"]) {
    expect(fireEvent.keyDown(body, { key, keyCode: 229 })).toBe(true);
  }
  expect(fireEvent.keyDown(screen.getByRole("textbox"), { key: "ArrowUp" })).toBe(true);
  expect(
    fireEvent.keyDown(screen.getByRole("button", { name: "Terminal Preview" }), { key: "Enter" }),
  ).toBe(true);
  expect(fireEvent.keyDown(screen.getByRole("textbox"), { key: "1" })).toBe(true);
  expect(handlers.onSendKeys).not.toHaveBeenCalled();
  fireEvent.click(body);
  expect(body).toHaveFocus();
  view.rerender(<InteractionRegion {...handlers} interactionBusy previewExpanded />);
  expect(fireEvent.keyDown(body, { key: "Enter" })).toBe(false);
  expect(fireEvent.keyDown(body, { key: "Escape" })).toBe(false);
  expect(fireEvent.keyDown(body, { key: "1" })).toBe(false);
  expect(handlers.onSendKeys).not.toHaveBeenCalled();
  view.rerender(
    <InteractionRegion {...handlers} previewExpanded interaction={interaction("disconnected")} />,
  );
  fireEvent.keyDown(body, { key: "Enter" });
  expect(handlers.onSendKeys).not.toHaveBeenCalled();
  view.rerender(<InteractionRegion {...handlers} previewExpanded={false} />);
  expect(screen.queryByRole("group", { name: "Terminal controls" })).toBeNull();
});

describe("composer uploads", () => {
  it("keeps files outside the text and sends paths in order before the original text", async () => {
    const { api } = await import("../../src/client/api/client");
    let finish!: (value: UploadAttachment) => void;
    const upload = vi
      .spyOn(api, "upload")
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValueOnce(uploadResult("/tmp/two.txt"));
    const handlers = props(interaction("connected"));
    render(<StatefulInteractionRegion {...handlers} />);
    const input = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "before replace after" } });
    input.setSelectionRange(7, 14);
    fireEvent.paste(input, {
      clipboardData: { files: [new File(["one"], "one.png"), new File(["two"], "two.txt")] },
    });
    expect(input).toBeEnabled();
    for (const name of ["Send", "Handoff", "Interrupt"]) {
      const button = screen.getByRole("button", { name });
      expect(button).toBeEnabled();
      expect(button).toHaveAttribute("aria-disabled", "true");
      button.focus();
      fireEvent.click(button);
      expect(button).toHaveFocus();
    }
    fireEvent.click(screen.getByRole("button", { name: "Terminal Preview" }));
    for (const name of ["Enter", "Up", "BTab", "Left", "Down", "Right"]) {
      const button = screen.getByRole("button", { name });
      expect(button).toBeEnabled();
      expect(button).toHaveAttribute("aria-disabled", "false");
      fireEvent.click(button);
    }
    const previewBody = screen.getByRole("group", { name: "Terminal controls" }).parentElement!;
    for (const key of ["Enter", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab"])
      fireEvent.keyDown(previewBody, { key });
    fireEvent.keyDown(previewBody, { key: "c", ctrlKey: true });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(handlers.onSendMessage).not.toHaveBeenCalled();
    expect(handlers.onHandoffPaneBinding).not.toHaveBeenCalled();
    expect(handlers.onSendKeys).toHaveBeenCalledTimes(12);
    expect(screen.getByText("Uploading 1/2…")).toBeInTheDocument();
    await act(async () => finish(uploadResult("/tmp/space dir/one.png")));
    expect(input.value).toBe("before replace after");
    expect(screen.getByText("one.png")).toBeInTheDocument();
    expect(screen.getByText("two.txt")).toBeInTheDocument();
    expect(input).toBeEnabled();
    await vi.waitFor(() => expect(input).toHaveFocus());
    expect(input.selectionStart).toBe(7);
    expect(input.selectionEnd).toBe(14);
    expect(handlers.onSendMessage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await vi.waitFor(() =>
      expect(handlers.onSendMessage).toHaveBeenCalledWith(
        '- "/tmp/space dir/one.png"\n- /tmp/two.txt\n\nbefore replace after',
      ),
    );
    await vi.waitFor(() => expect(screen.queryByText("two.txt")).not.toBeInTheDocument());
    upload.mockRestore();
  });

  it("keeps successful paths after failure and stops the batch", async () => {
    const { api } = await import("../../src/client/api/client");
    const upload = vi
      .spyOn(api, "upload")
      .mockResolvedValueOnce(uploadResult("/tmp/one.txt"))
      .mockRejectedValueOnce(new Error("Disk full"));
    render(<StatefulInteractionRegion {...props(interaction("connected"))} />);
    const input = screen.getByRole("textbox");
    fireEvent.drop(input, {
      dataTransfer: { files: [1, 2, 3].map((n) => new File(["x"], `${n}.txt`)), items: [] },
    });
    await screen.findByText("Disk full");
    expect(input).toHaveValue("");
    expect(screen.getByText("1.txt")).toBeInTheDocument();
    expect(input).toBeEnabled();
    expect(upload).toHaveBeenCalledTimes(2);
    upload.mockRestore();
  });

  it("aborts on unmount and ignores late responses", async () => {
    const { api } = await import("../../src/client/api/client");
    let finish!: (value: UploadAttachment) => void;
    const upload = vi.spyOn(api, "upload").mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(<StatefulInteractionRegion {...props(interaction("connected"))} />);
    fireEvent.paste(screen.getByRole("textbox"), {
      clipboardData: { files: [new File(["x"], "a.txt")] },
    });
    const signal = upload.mock.calls[0]![1];
    view.unmount();
    expect(signal.aborted).toBe(true);
    render(<StatefulInteractionRegion {...props(interaction("connected"))} />);
    await act(async () => finish(uploadResult("/tmp/old.txt")));
    expect(screen.getByRole("textbox")).toHaveValue("");
    upload.mockRestore();
  });

  it("leaves ordinary text paste alone and rejects oversized files before uploading", async () => {
    const { api } = await import("../../src/client/api/client");
    const upload = vi.spyOn(api, "upload");
    render(<StatefulInteractionRegion {...props(interaction("connected"))} />);
    const input = screen.getByRole("textbox");
    expect(
      fireEvent.paste(input, { clipboardData: { files: [], getData: () => "/local/file.txt" } }),
    ).toBe(true);
    const file = new File(["x"], "large.txt");
    Object.defineProperty(file, "size", { value: 20 * 1024 * 1024 + 1 });
    fireEvent.paste(input, { clipboardData: { files: [file] } });
    expect(await screen.findByText("Files must be at most 20 MiB")).toBeInTheDocument();
    expect(upload).not.toHaveBeenCalled();
    expect(input).toBeEnabled();
    upload.mockRestore();
  });
});

it("adds a MIME extension to clipboard images and refuses new uploads while busy", async () => {
  const { api } = await import("../../src/client/api/client");
  let finish!: (value: UploadAttachment) => void;
  const upload = vi.spyOn(api, "upload").mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<StatefulInteractionRegion {...props(interaction("connected"))} />);
  const input = screen.getByRole("textbox");
  const clipboard = {
    clipboardData: { files: [new File(["pixels"], "clipboard", { type: "image/png" })] },
  };
  fireEvent.paste(input, clipboard);
  expect(upload.mock.calls[0]![0].name).toBe("clipboard.png");
  fireEvent.paste(input, clipboard);
  expect(upload).toHaveBeenCalledTimes(1);
  await act(async () => finish(uploadResult("/tmp/image.png")));
  upload.mockRestore();
});

it("rejects folders without uploading", async () => {
  const { api } = await import("../../src/client/api/client");
  const upload = vi.spyOn(api, "upload");
  render(<StatefulInteractionRegion {...props(interaction("connected"))} />);
  fireEvent.drop(screen.getByRole("textbox"), {
    dataTransfer: {
      files: [],
      items: [{ kind: "file", webkitGetAsEntry: () => ({ isDirectory: true }) }],
    },
  });
  expect(await screen.findByText("Folders are not supported")).toBeInTheDocument();
  expect(upload).not.toHaveBeenCalled();
  upload.mockRestore();
});

it("renders activity idle independently of preview expansion", () => {
  const value = { ...interaction("connected"), activity: "idle" } as InteractionResponse;
  const view = render(<InteractionRegion {...props(value)} previewExpanded={false} />);
  for (const expanded of [false, true]) {
    view.rerender(<InteractionRegion {...props(value)} previewExpanded={expanded} />);
    expect(screen.getByText("Idle")).toBeVisible();
  }
});

describe("image attachments", () => {
  it("navigates the menu, dismisses it and restores focus", async () => {
    const user = userEvent.setup();
    render(<StatefulInteractionRegion {...props(interaction("connected"))} />);
    const trigger = screen.getByRole("button", { name: "Attach files" });
    await user.click(trigger);
    expect(screen.queryByRole("menuitem", { name: "Upload history" })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Take photo" })).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("menuitem", { name: "Choose files" })).toHaveFocus();
    await user.keyboard("{Home}{ArrowDown}{End}{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Draft" } });
    await user.click(trigger);
    await user.keyboard("{Tab}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toHaveFocus();
  });

  it("opens separate camera and gallery inputs and preserves the selection across repeated choices", async () => {
    const { api } = await import("../../src/client/api/client");
    const upload = vi.spyOn(api, "upload").mockResolvedValue(uploadResult("/tmp/photo space.jpg"));
    const user = userEvent.setup();
    const handlers = props(interaction("connected"));
    render(<StatefulInteractionRegion {...handlers} />);
    const composer = screen.getByRole("textbox") as HTMLTextAreaElement;
    const camera = screen.getByLabelText("Take photo") as HTMLInputElement;
    const gallery = screen.getByLabelText("Choose images") as HTMLInputElement;
    const files = screen.getByLabelText("Choose files") as HTMLInputElement;
    expect(files).toHaveAttribute("multiple");
    expect(files).not.toHaveAttribute("accept");
    expect(camera).toHaveAttribute("capture", "environment");
    expect(camera).not.toHaveAttribute("multiple");
    expect(gallery).toHaveAttribute("multiple");
    expect(gallery).not.toHaveAttribute("capture");
    expect(camera).toHaveAttribute("accept", "image/*");
    expect(gallery).toHaveAttribute("accept", "image/*");
    fireEvent.change(composer, { target: { value: "before replace after" } });
    composer.setSelectionRange(7, 14);
    for (const [name, input] of [
      ["Take photo", camera],
      ["Choose images", gallery],
      ["Choose files", files],
    ] as const) {
      const click = vi.spyOn(input, "click");
      await user.click(screen.getByRole("button", { name: "Attach files" }));
      await user.click(screen.getByRole("menuitem", { name }));
      expect(click).toHaveBeenCalledOnce();
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      // A cancelled picker does not change the draft.
      fireEvent.change(input, { target: { files: [] } });
      expect(upload).not.toHaveBeenCalled();
      click.mockRestore();
    }
    const file = new File(["pixels"], "photo", { type: "image/jpeg" });
    await user.upload(gallery, [file, file]);
    await vi.waitFor(() => expect(composer).toBeEnabled());
    expect(composer.value).toBe("before replace after");
    expect(screen.getAllByText("photo")).toHaveLength(2);
    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload.mock.calls[0]![0].name).toBe("photo.jpg");
    expect(gallery.value).toBe("");
    await user.click(screen.getByRole("button", { name: "Attach files" }));
    await user.click(screen.getByRole("menuitem", { name: "Take photo" }));
    await user.upload(camera, file);
    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(3));
    expect(handlers.onSendMessage).not.toHaveBeenCalled();
    upload.mockRestore();
  });

  it("rejects picker returns while busy or disconnected and disables attachments", async () => {
    const { api } = await import("../../src/client/api/client");
    const upload = vi.spyOn(api, "upload");
    const handlers = props(interaction("connected"));
    const view = render(<StatefulInteractionRegion {...handlers} />);
    const camera = screen.getByLabelText("Take photo");
    view.rerender(<StatefulInteractionRegion {...handlers} interactionBusy />);
    expect(screen.getByRole("button", { name: "Attach files" })).not.toBeDisabled();
    fireEvent.change(camera, { target: { files: [new File(["x"], "a.jpg")] } });
    expect(screen.getByRole("alert")).toHaveTextContent("Session is busy");
    view.rerender(
      <StatefulInteractionRegion {...handlers} interaction={interaction("disconnected")} />,
    );
    fireEvent.change(camera, { target: { files: [new File(["x"], "a.jpg")] } });
    expect(screen.getByRole("alert")).toHaveTextContent("Reconnect");
    expect(upload).not.toHaveBeenCalled();
    upload.mockRestore();
  });

  it("shares limits, failures, upload locking and session aborts with other upload sources", async () => {
    const { api } = await import("../../src/client/api/client");
    const upload = vi.spyOn(api, "upload").mockRejectedValueOnce(new Error("Storage unavailable"));
    const view = render(
      <StatefulInteractionRegion {...props(interaction("connected"))} key="first" />,
    );
    const camera = screen.getByLabelText("Take photo");
    const file = new File(["x"], "a.jpg");
    Object.defineProperty(file, "size", { value: 20 * 1024 * 1024 + 1 });
    fireEvent.change(camera, { target: { files: [file] } });
    expect(screen.getByRole("alert")).toHaveTextContent("20 MiB");
    expect(upload).not.toHaveBeenCalled();
    fireEvent.change(camera, { target: { files: [new File(["x"], "a.jpg")] } });
    await screen.findByText("Storage unavailable");
    let finish!: (result: UploadAttachment) => void;
    upload.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    fireEvent.change(camera, { target: { files: [new File(["x"], "a.jpg")] } });
    expect(screen.getByRole("button", { name: "Attach files" })).not.toBeDisabled();
    const signal = upload.mock.calls[1]![1];
    view.rerender(<StatefulInteractionRegion {...props(interaction("connected"))} key="second" />);
    expect(signal.aborted).toBe(true);
    await act(async () => finish(uploadResult("/tmp/old.jpg")));
    expect(screen.getByRole("textbox")).toHaveValue("");
    upload.mockRestore();
  });
});

describe("session drafts", () => {
  function session(id: string, handlers = props(interaction("connected"))) {
    return (
      <SessionDraftProvider>
        <StatefulInteractionRegion {...handlers} sessionId={id} key={id} />
      </SessionDraftProvider>
    );
  }

  it("restores independent drafts after session remounts and clears only successful sends", async () => {
    const view = render(session("a"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "draft a" } });
    view.rerender(session("b"));
    expect(screen.getByRole("textbox")).toHaveValue("");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "draft b" } });
    view.rerender(session("a"));
    expect(screen.getByRole("textbox")).toHaveValue("draft a");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /^Send$/ })));
    expect(screen.getByRole("textbox")).toHaveValue("");
    view.rerender(session("b"));
    expect(screen.getByRole("textbox")).toHaveValue("draft b");
    view.rerender(session("a"));
    expect(screen.getByRole("textbox")).toHaveValue("");
  });

  it.each([false, true])(
    "handles send completion after switching away (new edits: %s)",
    async (edit) => {
      let finish!: () => void;
      const handlers = props(interaction("connected"));
      handlers.onSendMessage.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      );
      const view = render(session("a", handlers));
      fireEvent.change(screen.getByRole("textbox"), { target: { value: "sent draft" } });
      fireEvent.click(screen.getByRole("button", { name: /^Send$/ }));
      view.rerender(session("b"));
      fireEvent.change(screen.getByRole("textbox"), { target: { value: "draft b" } });
      if (edit) {
        view.rerender(session("a"));
        fireEvent.change(screen.getByRole("textbox"), { target: { value: "new draft" } });
        view.rerender(session("b"));
      }
      await act(async () => finish());
      expect(screen.getByRole("textbox")).toHaveValue("draft b");
      view.rerender(session("a"));
      expect(screen.getByRole("textbox")).toHaveValue(edit ? "new draft" : "");
    },
  );
});

it("previews, removes and releases image resources, falling back for undecodable images", async () => {
  const { api } = await import("../../src/client/api/client");
  const upload = vi.spyOn(api, "upload").mockResolvedValue(uploadResult("/tmp/photo.png"));
  const view = render(<StatefulInteractionRegion {...props(interaction("connected"))} />);
  fireEvent.change(screen.getByLabelText("Take photo"), {
    target: { files: [new File(["pixels"], "photo.png", { type: "image/png" })] },
  });
  const preview = await screen.findByRole("button", { name: "Preview photo.png" });
  fireEvent.click(preview);
  expect(screen.getByRole("dialog")).toHaveAttribute("open");
  fireEvent.click(screen.getByRole("button", { name: "Close image preview" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.error(screen.getByRole("img"));
  expect(screen.getByText("Preview unavailable")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Remove photo.png" }));
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
  expect(screen.getByRole("button", { name: "Send" })).toHaveAttribute("aria-disabled", "true");
  view.unmount();
  upload.mockRestore();
});

it("retains attachment drafts across sessions and failed sends, then sends without text", async () => {
  const { api } = await import("../../src/client/api/client");
  const upload = vi.spyOn(api, "upload").mockResolvedValue(uploadResult("/tmp/report.txt"));
  const handlers = props(interaction("connected"));
  handlers.onSendMessage.mockRejectedValueOnce(new Error("Disconnected"));
  const session = (id: string) => (
    <SessionDraftProvider>
      <StatefulInteractionRegion {...handlers} sessionId={id} key={id} />
    </SessionDraftProvider>
  );
  const view = render(session("a"));
  fireEvent.change(screen.getByLabelText("Choose files"), {
    target: { files: [new File(["report"], "report.txt")] },
  });
  await screen.findByRole("button", { name: "Remove report.txt" });
  view.rerender(session("b"));
  expect(screen.queryByRole("button", { name: "Remove report.txt" })).not.toBeInTheDocument();
  view.rerender(session("a"));
  expect(screen.getByRole("button", { name: "Remove report.txt" })).toBeEnabled();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Send" })));
  expect(screen.getByRole("button", { name: "Remove report.txt" })).toBeEnabled();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Send" })));
  expect(handlers.onSendMessage).toHaveBeenLastCalledWith("- /tmp/report.txt");
  expect(screen.queryByRole("button", { name: "Remove report.txt" })).not.toBeInTheDocument();
  upload.mockRestore();
});

it("counts attachment paths in the message limit", async () => {
  const { api } = await import("../../src/client/api/client");
  const { MAX_INTERACTION_MESSAGE_BYTES } = await import("../../src/shared/api-contract");
  const upload = vi.spyOn(api, "upload").mockResolvedValue(uploadResult("/tmp/report.txt"));
  const handlers = props(interaction("connected"));
  render(<StatefulInteractionRegion {...handlers} />);
  fireEvent.change(screen.getByLabelText("Choose files"), {
    target: { files: [new File(["x"], "report.txt")] },
  });
  await screen.findByRole("button", { name: "Remove report.txt" });
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "a".repeat(MAX_INTERACTION_MESSAGE_BYTES) },
  });
  const send = screen.getByRole("button", { name: "Send" });
  expect(send).toBeEnabled();
  expect(send).toHaveAttribute("aria-disabled", "true");
  await act(async () => fireEvent.click(send));
  expect(handlers.onSendMessage).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "/help" } });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Send" })));
  expect(handlers.onSendMessage).toHaveBeenCalledWith("- /tmp/report.txt\n\n/help");
  upload.mockRestore();
});

function uploadResult(path: string): UploadAttachment {
  return {
    path,
    id: path,
    sessionId: "test-session",
    filename: path.split("/").at(-1)!,
    size: 1,
    type: "image/png",
    uploadedAt: "2026-01-01T00:00:00.000Z",
  };
}

it("keeps the mounted draft and expanded preview when changing language", () => {
  updatePreferences({ language: "en" });
  const callbacks = props(interaction("connected"));
  render(
    <SessionDraftProvider>
      <StatefulInteractionRegion {...callbacks} />
    </SessionDraftProvider>,
  );
  const composer = screen.getByRole("textbox", { name: "Message to agent" });
  fireEvent.change(composer, { target: { value: "Keep this draft /original/path" } });
  fireEvent.click(screen.getByRole("button", { name: "Terminal Preview" }));
  try {
    act(() => updatePreferences({ language: "zh-CN" }));
    expect(screen.getByRole("textbox", { name: "发送给智能体的消息" })).toBe(composer);
    expect(composer).toHaveValue("Keep this draft /original/path");
    expect(screen.getByRole("button", { name: "终端预览" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(callbacks.onSendMessage).not.toHaveBeenCalled();
  } finally {
    act(() => updatePreferences({ language: "en" }));
  }
});

it("collapses the composer independently and retains its draft", async () => {
  const user = userEvent.setup();
  render(<InteractionRegion {...props(interaction("connected"))} previewExpanded />);
  await user.type(screen.getByRole("textbox"), "draft survives");
  await user.click(screen.getByRole("button", { name: "Collapse" }));
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Terminal Preview" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await user.click(screen.getByRole("button", { name: "Expand" }));
  expect(screen.getByRole("textbox")).toHaveValue("draft survives");
});

it.each(["idle", "working"] as const)(
  "keeps %s status independent from the terminal preview toggle",
  async (activity) => {
    const user = userEvent.setup();
    const handlers = props({ ...interaction("connected"), activity } as InteractionResponse);
    render(<StatefulInteractionRegion {...handlers} />);
    const toggle = screen.getByRole("button", { name: "Terminal Preview" });
    const status = screen.getByText(activity === "idle" ? "Idle" : "Working");
    expect(toggle).not.toContainElement(status);
    const expanded = toggle.getAttribute("aria-expanded");
    await user.click(status);
    expect(toggle).toHaveAttribute("aria-expanded", expanded);
    expect(handlers.onTogglePreview).not.toHaveBeenCalled();
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", String(expanded !== "true"));
    expect(toggle).toHaveFocus();
  },
);

// Supported and unsupported connections exercise the two error-composition paths.
it.each(["unbound", "unavailable"] as const)(
  "preserves %s connection reason alongside old operation errors",
  (state) => {
    const value: InteractionResponse =
      state === "unavailable"
        ? { supported: false, attachCommand: null }
        : {
            supported: true,
            state,
            activity: null,
            supersededBySessionId: null,
            attachCommand: null,
          };
    render(
      <InteractionRegion
        {...props(value)}
        error="old send failure"
        previewError="old stream failure"
        previewExpanded
      />,
    );
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Terminal Preview" })).not.toBeInTheDocument();
    expect(screen.queryByText("Error")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("old send failure");
    expect(screen.queryByText("old stream failure")).not.toBeInTheDocument();
    expect(document.querySelector(".interaction-status-warning")).toHaveTextContent(
      {
        unbound: "Unbound",
        unavailable: "Unavailable",
      }[state],
    );
  },
);
