// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { api, ApiClientError } from "../../src/client/api/client";
import { SessionInteraction } from "../../src/client/components/SessionInteraction";
import { SessionDraftProvider } from "../../src/client/state/session-drafts";

vi.mock("../../src/client/api/terminal-preview", () => ({
  connectTerminalPreview: () => () => {},
}));
afterEach(() => vi.restoreAllMocks());

it.each(["message_not_submitted", "interaction_failed"])(
  "retains drafts and attachments on %s and only expands for unsubmitted messages",
  async (code) => {
    vi.spyOn(api, "sendMessage").mockRejectedValue(new ApiClientError(409, code, "send failed"));
    vi.spyOn(api, "upload").mockResolvedValue({
      path: "/tmp/report.txt",
      filename: "report.txt",
      size: 6,
      type: "text/plain",
      id: "report",
      sessionId: "session-a",
      uploadedAt: "now",
    });
    const dismiss = vi.fn();
    const optimistic = vi.fn(() => dismiss);
    render(
      <SessionDraftProvider>
        <SessionInteraction
          sessionId="session-a"
          interaction={{
            supported: true,
            state: "connected",
            activity: null,
            supersededBySessionId: null,
            attachCommand: null,
          }}
          onMessagePreview={optimistic}
        />
      </SessionDraftProvider>,
    );
    const composer = screen.getByRole("textbox", { name: "Message to agent" });
    fireEvent.change(composer, { target: { value: "draft" } });
    fireEvent.change(screen.getByLabelText("Choose files"), {
      target: { files: [new File(["report"], "report.txt")] },
    });
    await screen.findByRole("button", { name: "Remove report.txt" });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Send" })));
    expect(composer).toHaveValue("draft");
    expect(screen.getByRole("button", { name: "Remove report.txt" })).toBeEnabled();
    expect(dismiss).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Terminal" })).toHaveAttribute(
      "aria-expanded",
      String(code === "message_not_submitted"),
    );
  },
);

it.each(["message", "keys", "interrupt"] as const)(
  "blocks concurrent actions during %s and disables controls while management is busy",
  async (operation) => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const sendMessage = vi.spyOn(api, "sendMessage").mockReturnValue(pending);
    const sendKeys = vi.spyOn(api, "sendKeys").mockReturnValue(pending);
    vi.spyOn(api, "upload").mockResolvedValue({
      path: "/tmp/report.txt",
      filename: "report.txt",
      size: 6,
      type: "text/plain",
      id: "report",
      sessionId: "session-a",
      uploadedAt: "now",
    });
    const properties = {
      sessionId: "session-a",
      interaction: {
        supported: true as const,
        state: "connected" as const,
        activity: null,
        supersededBySessionId: null,
        attachCommand: null,
      },
    };
    const { rerender } = render(
      <SessionDraftProvider>
        <SessionInteraction {...properties} />
      </SessionDraftProvider>,
    );
    const composer = screen.getByRole("textbox", { name: "Message to agent" });
    fireEvent.change(composer, { target: { value: "draft" } });
    fireEvent.change(screen.getByLabelText("Choose files"), {
      target: { files: [new File(["report"], "report.txt")] },
    });
    const remove = await screen.findByRole("button", { name: "Remove report.txt" });
    fireEvent.click(screen.getByRole("button", { name: "Terminal" }));
    const send = screen.getByRole("button", { name: "Send" });
    const interrupt = screen.getByRole("button", { name: "Interrupt" });
    const up = screen.getByRole("button", { name: "Up" });
    fireEvent.click({ message: send, keys: up, interrupt }[operation]);
    const initialKeyWrites = operation === "keys" || operation === "interrupt" ? 1 : 0;
    for (const button of [send, interrupt, up]) {
      expect(button).toHaveAttribute("aria-disabled", "false");
      fireEvent.click(button);
    }
    expect(remove).toBeEnabled();
    fireEvent.click(remove);
    expect(screen.getByRole("button", { name: "Remove report.txt" })).toBe(remove);
    fireEvent.keyDown(up.closest(".terminal-preview-body")!, { key: "ArrowDown" });
    fireEvent.keyDown(composer, { key: "Enter", shiftKey: true });
    fireEvent.click(screen.getByRole("button", { name: "Attach files" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(sendMessage).toHaveBeenCalledTimes(operation === "message" ? 1 : 0);
    expect(sendKeys).toHaveBeenCalledTimes(initialKeyWrites);
    expect(composer).toBeEnabled();
    rerender(
      <SessionDraftProvider>
        <SessionInteraction {...properties} managementBusy />
      </SessionDraftProvider>,
    );
    expect(send).toHaveAttribute("aria-disabled", "true");
    expect(interrupt).toHaveAttribute("aria-disabled", "true");
    rerender(
      <SessionDraftProvider>
        <SessionInteraction {...properties} />
      </SessionDraftProvider>,
    );
    await act(async () => finish());
    if (operation !== "message") {
      expect(remove).toBeEnabled();
      fireEvent.click(remove);
      expect(screen.queryByRole("button", { name: "Remove report.txt" })).not.toBeInTheDocument();
    }
    fireEvent.click(up);
    expect(sendKeys).toHaveBeenCalledTimes(initialKeyWrites + 1);
  },
);
