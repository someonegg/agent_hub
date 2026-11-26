import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { InteractionResponse } from "../../src/shared/api-contract";

import { InteractionRegion } from "../../src/client/components/InteractionRegion";
import { scrollToEdge } from "../../src/client/components/scroll-position";
import { SessionDraftProvider } from "../../src/client/state/session-drafts";

// @vitest-environment jsdom

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  vi.unstubAllGlobals();
});

function renderInteractionInScrollRegion(interaction: InteractionResponse) {
  const scrollTo = vi.fn();
  const { container } = render(
    <SessionDraftProvider>
      <div className="message-scroll">
        <InteractionRegion
          sessionId="session-1"
          interaction={interaction}
          actionsDisabled={false}
          error={null}
          onDismissError={vi.fn()}
          onExpandPreview={vi.fn()}
          onSendMessage={vi.fn().mockResolvedValue(undefined)}
          onSendKeys={vi.fn().mockResolvedValue(undefined)}
          preview={null}
          previewBusy={false}
          previewStopped={false}
          onRetryPreview={vi.fn()}
          previewError={null}
          previewExpanded={false}
          onTogglePreview={vi.fn()}
          recoveryActions={<button type="button">Resume</button>}
        />
      </div>
    </SessionDraftProvider>,
  );
  const scroll = container.querySelector<HTMLElement>(".message-scroll")!;
  Object.defineProperty(scroll, "scrollHeight", { configurable: true, value: 3_000 });
  scroll.scrollTo = scrollTo;
  return { container, scrollTo };
}

describe("bar blank-space scroll", () => {
  it.each([
    [false, "smooth"],
    [true, "auto"],
  ] as const)("scrollToEdge respects prefers-reduced-motion=%s", (matches, behavior) => {
    const scroll = document.createElement("div");
    const scrollTo = vi.fn();
    Object.defineProperty(scroll, "scrollHeight", { configurable: true, value: 3_000 });
    scroll.scrollTo = scrollTo;
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches }));

    scrollToEdge(scroll, "top");
    scrollToEdge(scroll, "bottom");

    expect(scrollTo.mock.calls).toEqual([[{ top: 0, behavior }], [{ top: 3_000, behavior }]]);
  });

  it("scrolls to bottom only on blank-space clicks in .interaction-toolbar", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));
    const { container, scrollTo } = renderInteractionInScrollRegion({
      supported: true,
      state: "connected",
      activity: "working",
      attachCommand: null,
      supersededBySessionId: null,
    });

    const toolbar = container.querySelector<HTMLElement>(".interaction-toolbar")!;
    fireEvent.click(screen.getByRole("button", { name: "Terminal" }));
    fireEvent.click(container.querySelector(".terminal-activity")!);
    expect(scrollTo).not.toHaveBeenCalled();

    fireEvent.click(toolbar);
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 3_000, behavior: "smooth" });
  });

  it("scrolls to bottom only on blank-space clicks in .interaction-recovery-bar", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));
    const { container, scrollTo } = renderInteractionInScrollRegion({
      supported: true,
      state: "unbound",
      activity: null,
      attachCommand: null,
      supersededBySessionId: null,
    });

    const recoveryBar = container.querySelector<HTMLElement>(".interaction-recovery-bar")!;
    fireEvent.click(container.querySelector(".interaction-status")!);
    fireEvent.click(container.querySelector(".resume-reason")!);
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(scrollTo).not.toHaveBeenCalled();

    fireEvent.click(recoveryBar);
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 3_000, behavior: "smooth" });
  });

  it("ignores blank-space clicks while a text selection is active", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));
    const { container, scrollTo } = renderInteractionInScrollRegion({
      supported: true,
      state: "connected",
      activity: "working",
      attachCommand: null,
      supersededBySessionId: null,
    });

    const toolbar = container.querySelector<HTMLElement>(".interaction-toolbar")!;
    const range = document.createRange();
    range.selectNodeContents(toolbar);
    window.getSelection()?.addRange(range);
    fireEvent.click(toolbar);
    expect(scrollTo).not.toHaveBeenCalled();

    window.getSelection()?.removeAllRanges();
    fireEvent.click(toolbar);
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 3_000, behavior: "smooth" });
  });
});
