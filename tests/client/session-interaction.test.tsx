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
    expect(screen.getByRole("button", { name: "Terminal Preview" })).toHaveAttribute(
      "aria-expanded",
      String(code === "message_not_submitted"),
    );
  },
);
