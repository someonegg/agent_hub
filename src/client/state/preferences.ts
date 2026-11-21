import { useSyncExternalStore } from "react";

import { isPermissionMode, type PermissionMode } from "../../shared/permission-mode";

import { applyLanguage, isLanguage, type Language } from "../i18n";
import { currentNode, nodeStorageKey, subscribeNode } from "../node-path";

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
type SharedPreferences = Omit<Preferences, "defaultAgent">;
let sharedFallback: Partial<SharedPreferences> = {};
const agentFallback = new Map<string, string>();

function parseStored(raw: string | null) {
  try {
    return JSON.parse(raw ?? "null") ?? {};
  } catch {
    return {};
  }
}

function readStored(storageKey: string) {
  try {
    return parseStored(localStorage.getItem(storageKey));
  } catch {
    return {};
  }
}

function read(): Preferences {
  const value = readStored(key);
  const agentKey = nodeStorageKey(key);
  const scoped = agentKey === key ? value : readStored(agentKey);
  return {
    language: isLanguage(value.language) ? value.language : defaults.language,
    theme: value.theme === "warm" ? "warm" : defaults.theme,
    worktree: value.worktree === true,
    permissionMode: isPermissionMode(value.permissionMode)
      ? value.permissionMode
      : defaults.permissionMode,
    enterToSend: value.enterToSend === true,
    ...sharedFallback,
    defaultAgent:
      agentFallback.get(agentKey) ??
      (typeof scoped.defaultAgent === "string" ? scoped.defaultAgent : defaults.defaultAgent),
  };
}
let node = currentNode();
let current = read();
const listeners = new Set<() => void>();
export function initializeTheme() {
  document.documentElement.dataset.theme = current.theme;
  applyLanguage(current.language);
}
function publish(next: Preferences) {
  current = next;
  initializeTheme();
  listeners.forEach((listener) => listener());
}
export function updatePreferences(patch: Partial<Preferences>) {
  const { defaultAgent, ...sharedPatch } = patch;
  const agentKey = nodeStorageKey(key);
  sharedFallback = { ...sharedFallback, ...sharedPatch };
  if (defaultAgent !== undefined) agentFallback.set(agentKey, defaultAgent);
  if (Object.keys(sharedFallback).length || agentFallback.has(key)) {
    try {
      const stored = parseStored(localStorage.getItem(key));
      localStorage.setItem(
        key,
        JSON.stringify({
          ...stored,
          ...sharedFallback,
          defaultAgent: agentFallback.get(key) ?? stored.defaultAgent,
        }),
      );
      sharedFallback = {};
      agentFallback.delete(key);
    } catch {
      /* Retain unsaved changes in this tab. */
    }
  }
  if (agentKey !== key && agentFallback.has(agentKey)) {
    try {
      localStorage.setItem(agentKey, JSON.stringify({ defaultAgent: agentFallback.get(agentKey) }));
      agentFallback.delete(agentKey);
    } catch {
      /* Retain this Node's unsaved default Agent. */
    }
  }
  publish({ ...current, ...patch });
}
window.addEventListener("storage", (event) => {
  if (event.key !== key && event.key !== nodeStorageKey(key) && event.key !== null) return;
  reload();
});
subscribeNode(() => {
  if (node !== currentNode()) reload();
});
function reload() {
  node = currentNode();
  publish(read());
}
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
