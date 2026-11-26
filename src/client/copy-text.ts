function copyContainer(): HTMLElement {
  const activeDialog = document.activeElement?.closest("dialog");
  if (activeDialog instanceof HTMLElement) return activeDialog;

  // Fallback when focus is not inside the dialog (e.g. Safari button clicks);
  // pick the topmost open dialog without relying on :modal (unsupported in jsdom).
  const openDialogs = document.querySelectorAll("dialog[open]");
  const topDialog = openDialogs.item(openDialogs.length - 1);
  return topDialog instanceof HTMLElement ? topDialog : document.body;
}

function copyWithExecCommand(text: string): boolean {
  const previousFocus =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.readOnly = true;
  // Stay off-screen without display:none (which blocks selection), avoid scroll
  // jumps, and keep a normal font size so iOS does not zoom on focus.
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  textarea.style.fontSize = "16px";
  copyContainer().appendChild(textarea);
  try {
    textarea.focus({ preventScroll: true });
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
    previousFocus?.focus({ preventScroll: true });
  }
}

// navigator.clipboard only exists in secure contexts; the execCommand fallback
// also covers plain HTTP (e.g. LAN access). Both must run inside the click's
// user gesture, so copyText has to be invoked synchronously from handlers.
export function copyText(text: string): Promise<boolean> {
  const clipboard = navigator.clipboard;
  if (typeof clipboard?.writeText !== "function") {
    return Promise.resolve(copyWithExecCommand(text));
  }
  return clipboard.writeText(text).then(
    () => true,
    () => copyWithExecCommand(text),
  );
}
