const CONTEXT_INJECTION_BLOCK =
  /^\s*(?:<system-reminder>|<system-context>|<ide_opened_file>|<ide_selection>)/;

export function isClaudeContextInjectionBlock(text: string): boolean {
  return CONTEXT_INJECTION_BLOCK.test(text);
}

export function unwrapClaudePastedContent(text: string): string {
  const wrapped = text.trimStart();
  const opening = /^<pasted_content id="([0-9a-f]+)">\r?\n/.exec(wrapped);
  if (!opening) return text;

  const message = wrapped.trimEnd();
  const closingStart = message.lastIndexOf("\n") + 1;
  if (message.slice(closingStart) !== `</pasted_content id="${opening[1]}">`) return text;

  // The newline before the closing tag may be part of the pasted text.
  return message.slice(opening[0].length, closingStart);
}
