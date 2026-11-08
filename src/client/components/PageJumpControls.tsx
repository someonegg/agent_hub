import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { t } from "../i18n";

const EDGE_DISTANCE_PX = 480;

interface ControlVisibility {
  top: boolean;
  bottom: boolean;
}

const hiddenControls: ControlVisibility = { top: false, bottom: false };

export function PageJumpControls({
  scrollElement,
  contentElement,
}: {
  scrollElement: HTMLElement | null;
  contentElement?: HTMLElement | null;
}) {
  useTranslation();
  const [visible, setVisible] = useState(hiddenControls);

  useEffect(() => {
    if (!scrollElement) return;
    let animationFrame: number | null = null;
    const updateControls = () => {
      const next = {
        top: scrollElement.scrollTop > EDGE_DISTANCE_PX,
        bottom:
          scrollElement.scrollHeight - scrollElement.scrollTop - scrollElement.clientHeight >
          EDGE_DISTANCE_PX,
      };
      setVisible((current) =>
        current.top === next.top && current.bottom === next.bottom ? current : next,
      );
    };
    const scheduleControlsUpdate = () => {
      if (typeof window.requestAnimationFrame !== "function") {
        updateControls();
        return;
      }
      if (animationFrame !== null) return;
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = null;
        updateControls();
      });
    };

    updateControls();
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleControlsUpdate);
    scrollElement.addEventListener("scroll", scheduleControlsUpdate, { passive: true });
    window.addEventListener("resize", scheduleControlsUpdate);
    resizeObserver?.observe(scrollElement);
    if (contentElement) resizeObserver?.observe(contentElement);
    return () => {
      scrollElement.removeEventListener("scroll", scheduleControlsUpdate);
      window.removeEventListener("resize", scheduleControlsUpdate);
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
      resizeObserver?.disconnect();
    };
  }, [scrollElement, contentElement]);

  const scrollTo = (top: number) => {
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    scrollElement?.scrollTo({ top, behavior: reduceMotion ? "auto" : "smooth" });
  };

  return (
    <nav className="page-jump-controls" aria-label={t("pagePosition")}>
      <button
        type="button"
        className={`page-jump-control${visible.top ? " is-visible" : ""}`}
        aria-label={t("backToTop")}
        aria-hidden={!visible.top}
        tabIndex={visible.top ? 0 : -1}
        onClick={() => scrollTo(0)}
      >
        <span aria-hidden="true">↑</span> {t("top")}
      </button>
      <button
        type="button"
        className={`page-jump-control${visible.bottom ? " is-visible" : ""}`}
        aria-label={t("jumpToBottom")}
        aria-hidden={!visible.bottom}
        tabIndex={visible.bottom ? 0 : -1}
        onClick={() => scrollTo(scrollElement?.scrollHeight ?? 0)}
      >
        <span aria-hidden="true">↓</span> {t("end")}
      </button>
    </nav>
  );
}
