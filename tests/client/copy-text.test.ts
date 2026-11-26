// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { copyText } from "../../src/client/copy-text";

const execCommandOriginal = document.execCommand;

afterEach(() => {
  vi.unstubAllGlobals();
  document.execCommand = execCommandOriginal;
  document.body.innerHTML = "";
});

describe("copyText", () => {
  it("writes through the async clipboard when available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const execCommand = vi.fn(() => true);
    document.execCommand = execCommand;
    await expect(copyText("tmux attach -t demo")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledExactlyOnceWith("tmux attach -t demo");
    expect(execCommand).not.toHaveBeenCalled();
  });

  it("falls back to execCommand when the clipboard API is missing (insecure contexts)", async () => {
    vi.stubGlobal("navigator", { clipboard: undefined });
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();

    let copiedValue = "";
    const execCommand = vi.fn(() => {
      const textarea = document.querySelector("textarea");
      copiedValue = textarea?.value ?? "";
      return true;
    });
    document.execCommand = execCommand;

    await expect(copyText("https://hub.test/web/abc/")).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledExactlyOnceWith("copy");
    expect(copiedValue).toBe("https://hub.test/web/abc/");
    expect(document.querySelector("textarea")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("mounts the fallback textarea inside an open dialog so modal dialogs do not block focus", async () => {
    vi.stubGlobal("navigator", { clipboard: undefined });
    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    const button = document.createElement("button");
    dialog.appendChild(button);
    document.body.appendChild(dialog);
    button.focus();

    let mountedInsideDialog = false;
    const execCommand = vi.fn(() => {
      const textarea = dialog.querySelector("textarea");
      mountedInsideDialog = textarea?.value === "https://hub.test/link";
      return true;
    });
    document.execCommand = execCommand;

    await expect(copyText("https://hub.test/link")).resolves.toBe(true);
    expect(mountedInsideDialog).toBe(true);
    expect(dialog.querySelector("textarea")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("falls back to execCommand when writeText rejects", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const execCommand = vi.fn(() => true);
    document.execCommand = execCommand;
    await expect(copyText("secret-link")).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledExactlyOnceWith("copy");
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("reports failure and cleans up when both paths fail or throw", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    document.execCommand = () => false;
    await expect(copyText("secret-link")).resolves.toBe(false);
    expect(document.querySelector("textarea")).toBeNull();

    document.execCommand = () => {
      throw new Error("blocked");
    };
    await expect(copyText("secret-link")).resolves.toBe(false);
    expect(document.querySelector("textarea")).toBeNull();
  });
});
