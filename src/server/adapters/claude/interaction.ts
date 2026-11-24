import type { DomainAgentInteraction, DomainBindingEvent } from "../../domain/session-domain.js";
import { type DecodedRecord, isObject } from "../shared/jsonl-decoder.js";
import { DEFAULT_KEY_BINDINGS, interruptSteps } from "../shared/session-management.js";
import { formatClaudeBindingMessage, parseClaudeBindingMessage } from "./binding-message.js";
import { isClaudeContextInjectionBlock } from "./user-content.js";

export type ParsedClaudeBindingRecord = Omit<DomainBindingEvent, "sessionId">;

export function claudeInteraction(
  projectDirectory: string | null,
  taskName: string | null,
): DomainAgentInteraction {
  return {
    transport: "tmux",
    bindingCommand: (target) => formatClaudeBindingMessage(target, projectDirectory, taskName),
    interruptSteps,
    keyBindings: DEFAULT_KEY_BINDINGS,
  };
}

export function parseClaudeBindingRecord(record: DecodedRecord): ParsedClaudeBindingRecord | null {
  const row = record.value;
  if (
    row.type !== "user" ||
    row.isSidechain === true ||
    row.parent_tool_use_id != null ||
    row.isMeta === true ||
    row.isCompactSummary === true ||
    row.subtype === "subagent"
  )
    return null;
  const message = row.message;
  if (!isObject(message) || message.role !== "user") return null;

  const content = extractClaudeBindingText(message.content);
  if (content === null) return null;
  const attempt = parseClaudeBindingMessage(content, record.ordinal);
  if (!attempt) return null;
  const time = typeof row.timestamp === "string" ? Date.parse(row.timestamp) : NaN;
  return {
    ordinal: record.ordinal,
    time: Number.isFinite(time) ? time : 0,
    position: 0,
    attempt,
  };
}

function extractClaudeBindingText(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  let candidate: string | null = null;
  for (const block of content) {
    if (!isObject(block) || block.type !== "text" || typeof block.text !== "string") return null;
    if (isClaudeContextInjectionBlock(block.text)) continue;
    if (candidate !== null) return null;
    candidate = block.text;
  }
  return candidate;
}
