import { useSyncExternalStore } from "react";

import { browserStorage } from "./browser-storage";

const listeners = new Set<() => void>();
const key = (sessionId: string) => `ahub.composer-expanded.${sessionId}`;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setSessionComposerExpanded(sessionId: string, expanded: boolean) {
  browserStorage.setItem(key(sessionId), String(expanded));
  listeners.forEach((listener) => listener());
}

export function useSessionComposerPreference(sessionId: string) {
  const expanded = useSyncExternalStore(subscribe, () => {
    const value = browserStorage.getItem(key(sessionId));
    if (value === "true" || value === "false") return value === "true";
    return undefined;
  });
  return {
    expanded,
    setExpanded: (value: boolean) => setSessionComposerExpanded(sessionId, value),
  };
}
