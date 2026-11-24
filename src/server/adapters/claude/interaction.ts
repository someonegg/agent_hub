import type { DomainAgentInteraction } from "../../domain/session-domain.js";
import type { DecodedRecord } from "../shared/jsonl-decoder.js";
import { DEFAULT_KEY_BINDINGS, interruptSteps } from "../shared/session-management.js";
import {
  type ClaudeBindingIndex,
  parseClaudeBindingMessage,
  type ParsedClaudeBindingMessage,
} from "./binding-index.js";
import { isClaudeContextInjectionBlock } from "./user-content.js";

export interface ParsedClaudeBindingRecord {
  readonly ordinal: number;
  readonly time: number;
  readonly parsed: ParsedClaudeBindingMessage;
}

export function claudeInteraction(
  index: ClaudeBindingIndex,
  projectDirectory: string | null,
  taskName: string | null,
): DomainAgentInteraction {
  return {
    transport: "tmux",
    bindingCommand: async (target) => {
      const command = await index.publish(target, { kind: "handoff" }, projectDirectory, taskName);
      return {
        command,
        discard: () => index.discard(command),
      };
    },
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
  if (
    !message ||
    typeof message !== "object" ||
    !("role" in message) ||
    message.role !== "user" ||
    !("content" in message)
  )
    return null;

  const content = extractClaudeBindingText(message.content);
  if (content === null) return null;
  const parsed = parseClaudeBindingMessage(content);
  if (!parsed) return null;
  const time = typeof row.timestamp === "string" ? Date.parse(row.timestamp) : NaN;
  return {
    ordinal: record.ordinal,
    time: Number.isFinite(time) ? time : 0,
    parsed,
  };
}

export async function resolveClaudeBindingEvent(
  entry: ParsedClaudeBindingRecord,
  nativeId: string,
  index?: ClaudeBindingIndex,
) {
  const { ordinal, time, parsed } = entry;
  const binding = index ? await index.lookup(parsed.id, nativeId) : null;
  return {
    time,
    ordinal,
    position: 0,
    attempt: binding
      ? {
          ordinal,
          valid: true as const,
          socketPath: binding.socketPath,
          sessionName: binding.sessionName,
          ...(binding.kind !== "handoff" ? { operationId: binding.operationId } : {}),
          ...(parsed.projectDirectory !== undefined
            ? { projectDirectory: parsed.projectDirectory }
            : {}),
          ...(parsed.taskName !== undefined ? { taskName: parsed.taskName } : {}),
        }
      : {
          ordinal,
          valid: false as const,
          expired: true as const,
        },
  };
}

function extractClaudeBindingText(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  let candidate: string | null = null;
  for (const block of content) {
    if (
      !block ||
      typeof block !== "object" ||
      Array.isArray(block) ||
      block.type !== "text" ||
      typeof block.text !== "string"
    )
      return null;
    if (isClaudeContextInjectionBlock(block.text)) continue;
    if (candidate !== null) return null;
    candidate = block.text;
  }
  return candidate;
}
