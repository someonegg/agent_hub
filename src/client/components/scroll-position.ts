const FOLLOW_OUTPUT_THRESHOLD_PX = 48;

export function isNearScrollEnd(element: HTMLElement): boolean {
  return (
    element.scrollHeight - element.clientHeight - element.scrollTop < FOLLOW_OUTPUT_THRESHOLD_PX
  );
}
