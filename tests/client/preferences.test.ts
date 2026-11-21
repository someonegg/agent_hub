// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { navigateNode } from "../../src/client/node-path";
import { updatePreferences, usePreferences } from "../../src/client/state/preferences";
import { mockLocalStorage } from "./mock-local-storage";

it.each(["unavailable", "write-failure"])(
  "preserves tab preferences across nodes with %s storage",
  (mode) => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const storage = mockLocalStorage();
    const key = "ahub.preferences.v1";
    localStorage.setItem(key, JSON.stringify({ language: "en", theme: "mist" }));
    localStorage.setItem(`${key}.node.local`, JSON.stringify({ defaultAgent: "old" }));
    const fail = () => {
      throw new Error("Storage unavailable");
    };
    const { result } = renderHook(usePreferences);
    const check = () => {
      act(() => navigateNode("/nodes/local/"));
      act(() =>
        updatePreferences({ language: "zh-TW", theme: "warm", defaultAgent: "local-agent" }),
      );
      act(() => navigateNode("/nodes/remote/"));
      expect(result.current).toMatchObject({ language: "zh-TW", theme: "warm", defaultAgent: "" });
      act(() => updatePreferences({ defaultAgent: "remote-agent" }));
      act(() => navigateNode("/nodes/local/"));
      expect(result.current).toMatchObject({
        language: "zh-TW",
        theme: "warm",
        defaultAgent: "local-agent",
      });
      act(() => navigateNode("/nodes/remote/"));
      expect(result.current.defaultAgent).toBe("remote-agent");
    };
    try {
      storage.setItem.withImplementation(fail, () => {
        if (mode === "unavailable") storage.getItem.withImplementation(fail, check);
        else check();
      });
    } finally {
      act(() => updatePreferences({ defaultAgent: "" }));
      act(() => navigateNode("/nodes/local/"));
      act(() => updatePreferences({ defaultAgent: "", language: "en", theme: "mist" }));
      localStorage.clear();
      act(() => navigateNode("/"));
    }
  },
);

it("persists new preferences over invalid JSON", () => {
  mockLocalStorage();
  const key = "ahub.preferences.v1";
  localStorage.setItem(key, "{broken");
  updatePreferences({ language: "zh-TW", theme: "warm" });
  expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({
    language: "zh-TW",
    theme: "warm",
  });
});
