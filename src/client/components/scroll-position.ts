const FOLLOW_OUTPUT_THRESHOLD_PX = 48;

export function isNearScrollEnd(element: HTMLElement): boolean {
  return (
    element.scrollHeight - element.clientHeight - element.scrollTop < FOLLOW_OUTPUT_THRESHOLD_PX
  );
}

export function isBlankRegionClick(event: {
  target: EventTarget | null;
  currentTarget: EventTarget;
}): boolean {
  if (event.target !== event.currentTarget) return false;
  const selection = window.getSelection();
  return !selection || selection.isCollapsed;
}

export function scrollToEdge(
  element: HTMLElement | null | undefined,
  edge: "top" | "bottom",
): void {
  if (!element) return;
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  element.scrollTo({
    top: edge === "top" ? 0 : element.scrollHeight,
    behavior: reduceMotion ? "auto" : "smooth",
  });
}
