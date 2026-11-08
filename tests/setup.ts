import { afterEach, vi } from "vitest";

import { cleanupTempDirectories } from "./helpers/temp-directories.js";

afterEach(cleanupTempDirectories);
// Node-only suites do not need the DOM matchers or React renderer.
if (typeof window !== "undefined") {
  // jsdom has no scrolling implementation; keep scroll-container interactions observable.
  HTMLElement.prototype.scrollTo = function (options?: ScrollToOptions | number, y?: number) {
    this.scrollTop = typeof options === "number" ? (y ?? 0) : (options?.top ?? this.scrollTop);
  };
  await import("@testing-library/jest-dom/vitest");
  const { cleanup } = await import("@testing-library/react/pure");
  afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    window.history.replaceState(null, "", "/");
  });
}
afterEach(() => vi.useRealTimers());

if (typeof HTMLDialogElement !== "undefined") {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
}
