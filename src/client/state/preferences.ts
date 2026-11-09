import { useSyncExternalStore } from "react";

import { isPermissionMode, type PermissionMode } from "../../shared/permission-mode";

import { applyLanguage, isLanguage, type Language } from "../i18n";

export interface Preferences {
  language: Language;
  defaultAgent: string;
  theme: "mist" | "warm";
  worktree: boolean;
  permissionMode: PermissionMode;
  enterToSend: boolean;
}
const key = "ahub.preferences.v1";
const defaults: Preferences = {
  language: "en",
  defaultAgent: "",
  theme: "mist",
  worktree: false,
  permissionMode: "default",
  enterToSend: false,
};
function read(): Preferences {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "null") ?? {};
    return {
      language: isLanguage(value.language) ? value.language : "en",
      defaultAgent: typeof value.defaultAgent === "string" ? value.defaultAgent : "",
      theme: value.theme === "warm" ? "warm" : "mist",
      worktree: value.worktree === true,
      permissionMode: isPermissionMode(value.permissionMode) ? value.permissionMode : "default",
      enterToSend: value.enterToSend === true,
    };
  } catch {
    return defaults;
  }
}
let current = read();
const listeners = new Set<() => void>();
export function initializeTheme() {
  document.documentElement.dataset.theme = current.theme;
  applyLanguage(current.language);
}
export function updatePreferences(patch: Partial<Preferences>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(key, JSON.stringify(current));
  } catch {
    /* Keep settings usable without storage. */
  }
  initializeTheme();
  listeners.forEach((listener) => listener());
}
window.addEventListener("storage", (event) => {
  if (event.key !== key && event.key !== null) return;
  current = read();
  initializeTheme();
  listeners.forEach((listener) => listener());
});
export function usePreferences() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => current,
  );
}
