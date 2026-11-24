import type { DomainAgentInteraction, DomainBindingEvent } from "../../domain/session-domain.js";
import type { DecodedRecord } from "../shared/jsonl-decoder.js";
import { DEFAULT_KEY_BINDINGS, interruptSteps } from "../shared/session-management.js";
import { formatAgyBindingMessage, parseAgyBindingMessage } from "./binding-message.js";
import { extractAgyUserRequest } from "./user-content.js";

export type ParsedAgyBindingRecord = Omit<DomainBindingEvent, "sessionId">;

export function agyInteraction(
  projectDirectory: string | null,
  workingDirectory: string | null,
  taskName: string | null,
): DomainAgentInteraction {
  return {
    transport: "tmux",
    bindingCommand: (target) =>
      formatAgyBindingMessage(target, projectDirectory, workingDirectory, taskName),
    interruptSteps,
    keyBindings: DEFAULT_KEY_BINDINGS,
  };
}

export function isAgyUserInput(row: Record<string, unknown>): boolean {
  return row.source === "USER_EXPLICIT" && row.type === "USER_INPUT";
}

/** Returns the binding evidence of a user input row, or null for ordinary messages. */
export function parseAgyBindingRecord(
  record: DecodedRecord,
): { readonly event: ParsedAgyBindingRecord; readonly workingDirectory?: string } | null {
  const row = record.value;
  if (!isAgyUserInput(row) || typeof row.content !== "string") return null;
  const parsed = parseAgyBindingMessage(extractAgyUserRequest(row.content).trim(), record.ordinal);
  if (!parsed) return null;
  const time = typeof row.created_at === "string" ? Date.parse(row.created_at) : NaN;
  return {
    event: {
      ordinal: record.ordinal,
      time: Number.isFinite(time) ? time : 0,
      position: 0,
      attempt: parsed.attempt,
    },
    ...(parsed.workingDirectory !== undefined ? { workingDirectory: parsed.workingDirectory } : {}),
  };
}
