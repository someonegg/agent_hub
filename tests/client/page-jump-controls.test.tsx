import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PageJumpControls } from "../../src/client/components/PageJumpControls";

// @vitest-environment jsdom

describe("page jump controls", () => {
  let scroll: HTMLElement;
  beforeEach(() => {
    vi.useFakeTimers();
    scroll = document.createElement("div");
  });

  it("shows only the controls that move away from the nearest edge", async () => {
    setPageMetrics(scroll, { scrollY: 0, innerHeight: 800, scrollHeight: 3_000 });
    render(<PageJumpControls scrollElement={scroll} />);

    expect(screen.queryByRole("button", { name: "Back to top" })).toBeNull();
    expect(screen.getByRole("button", { name: "Jump to bottom" })).toBeVisible();

    act(() => {
      setPageMetrics(scroll, { scrollY: 1_100, innerHeight: 800, scrollHeight: 3_000 });
      fireEvent.scroll(scroll);
    });
    await act(async () => vi.advanceTimersToNextFrame());
    expect(screen.getByRole("button", { name: "Back to top" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Jump to bottom" })).toBeVisible();

    act(() => {
      setPageMetrics(scroll, { scrollY: 2_200, innerHeight: 800, scrollHeight: 3_000 });
      fireEvent.scroll(scroll);
    });
    expect(screen.getByRole("button", { name: "Back to top" })).toBeVisible();
    await act(async () => vi.advanceTimersToNextFrame());
    expect(screen.queryByRole("button", { name: "Jump to bottom" })).toBeNull();
  });

  it.each([
    [false, "smooth"],
    [true, "auto"],
  ] as const)("jumps to either edge with reduced motion=%s", (matches, behavior) => {
    const scrollTo = vi.fn();
    scroll.scrollTo = scrollTo;
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches }));
    setPageMetrics(scroll, { scrollY: 1_000, innerHeight: 800, scrollHeight: 3_000 });
    render(<PageJumpControls scrollElement={scroll} />);

    fireEvent.click(screen.getByRole("button", { name: "Back to top" }));
    fireEvent.click(screen.getByRole("button", { name: "Jump to bottom" }));
    expect(scrollTo.mock.calls).toEqual([[{ top: 0, behavior }], [{ top: 3_000, behavior }]]);
  });

  it("updates when the document height changes and disconnects its observer", async () => {
    let notifyResize!: ResizeObserverCallback;
    const disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          notifyResize = callback;
        }
        observe() {}
        disconnect() {
          disconnect();
        }
      },
    );
    setPageMetrics(scroll, { scrollY: 0, innerHeight: 800, scrollHeight: 800 });
    const view = render(<PageJumpControls scrollElement={scroll} />);
    expect(screen.queryByRole("button", { name: "Jump to bottom" })).toBeNull();

    act(() => {
      setPageMetrics(scroll, { scrollY: 0, innerHeight: 800, scrollHeight: 2_000 });
      notifyResize([], {} as ResizeObserver);
    });
    await act(async () => vi.advanceTimersToNextFrame());
    expect(screen.getByRole("button", { name: "Jump to bottom" })).toBeVisible();

    view.unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("uses the message region rather than document scroll metrics", async () => {
    setPageMetrics(scroll, { scrollY: 0, innerHeight: 800, scrollHeight: 3000 });
    Object.defineProperty(window, "scrollY", { configurable: true, value: 2000 });
    render(<PageJumpControls scrollElement={scroll} />);
    expect(screen.queryByRole("button", { name: "Back to top" })).toBeNull();
    expect(screen.getByRole("button", { name: "Jump to bottom" })).toBeVisible();
    Object.defineProperty(scroll, "clientHeight", { configurable: true, value: 2700 });
    fireEvent.resize(window);
    await act(async () => vi.advanceTimersToNextFrame());
    expect(screen.queryByRole("button", { name: "Jump to bottom" })).toBeNull();
  });
});

function setPageMetrics(
  scroll: HTMLElement,
  metrics: { scrollY: number; innerHeight: number; scrollHeight: number },
) {
  Object.defineProperties(scroll, {
    scrollTop: { configurable: true, value: metrics.scrollY },
    clientHeight: { configurable: true, value: metrics.innerHeight },
    scrollHeight: { configurable: true, value: metrics.scrollHeight },
  });
}
