import { isObject } from "../shared/jsonl-decoder.js";

const CONTEXT_INJECTION_BLOCK =
  /^\s*(?:<system-reminder>|<system-context>|<ide_opened_file>|<ide_selection>)/;

export interface ClaudeQueuedUserPrompt {
  readonly content: unknown;
  readonly timestamp: string | null;
}

export function isClaudeContextInjectionBlock(text: string): boolean {
  return CONTEXT_INJECTION_BLOCK.test(text);
}

export function extractClaudeQueuedUserPrompt(
  row: Record<string, unknown>,
): ClaudeQueuedUserPrompt | null {
  if (row.type !== "attachment" || !isObject(row.attachment)) return null;
  const attachment = row.attachment;
  if (attachment.type !== "queued_command") return null;
  if (attachment.humanTurn === false) return null;
  if (typeof attachment.commandMode === "string" && attachment.commandMode !== "prompt") {
    return null;
  }
  if (
    isObject(attachment.origin) &&
    typeof attachment.origin.kind === "string" &&
    attachment.origin.kind !== "human"
  ) {
    return null;
  }
  if (typeof attachment.prompt !== "string" && !Array.isArray(attachment.prompt)) return null;
  let timestamp: string | null = null;
  if (typeof row.timestamp === "string") timestamp = row.timestamp;
  else if (typeof attachment.timestamp === "string") timestamp = attachment.timestamp;
  return { content: attachment.prompt, timestamp };
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
