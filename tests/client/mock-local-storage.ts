import { vi } from "vitest";

export function mockLocalStorage() {
  const values = new Map<string, string>();
  const storage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    clear: () => values.clear(),
  };
  vi.stubGlobal("localStorage", storage);
  return storage;
}
