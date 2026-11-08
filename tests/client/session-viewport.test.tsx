// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SessionReader } from "../../src/client/components/SessionReader";
import { firstPage } from "./session.fixtures";

vi.mock("../../src/client/components/SessionInteraction", () => ({
  SessionInteraction: () => null,
}));

function renderReader(inHub = true) {
  const reader = (
    <SessionReader
      context={firstPage}
      readerLoading={false}
      readerBusy={false}
      onLoadMore={vi.fn()}
    />
  );
  return render(inHub ? <div className="hub">{reader}</div> : reader);
}

describe("session visual viewport", () => {
  it.each([true, false])(
    "follows keyboard resize and subsequent iOS panning, inHub=%s",
    (inHub) => {
      const viewport = Object.assign(new EventTarget(), { height: 800, offsetTop: 0 });
      vi.stubGlobal("visualViewport", viewport);
      const view = renderReader(inHub);
      const host = view.container.querySelector<HTMLElement>(inHub ? ".hub" : ".session-layout")!;
      expect(host.style.getPropertyValue("--session-viewport-height")).toBe("800px");
      act(() => {
        viewport.height = 360;
        viewport.dispatchEvent(new Event("resize"));
      });
      expect(host.style.getPropertyValue("--session-viewport-height")).toBe("360px");
      act(() => {
        viewport.offsetTop = 240;
        viewport.dispatchEvent(new Event("scroll"));
      });
      expect(host.style.getPropertyValue("--session-viewport-top")).toBe("240px");
      expect(host.style.getPropertyValue("--session-viewport-height")).toBe("360px");
      act(() => {
        viewport.height = 800;
        viewport.offsetTop = 0;
        viewport.dispatchEvent(new Event("resize"));
      });
      expect(host.style.getPropertyValue("--session-viewport-height")).toBe("800px");
      expect(host.style.getPropertyValue("--session-viewport-top")).toBe("0px");
      view.unmount();
      act(() => {
        viewport.offsetTop = 150;
        viewport.dispatchEvent(new Event("scroll"));
      });
      expect(host.style.getPropertyValue("--session-viewport-top")).toBe("");
      expect(host.style.getPropertyValue("--session-viewport-height")).toBe("");
    },
  );
});
