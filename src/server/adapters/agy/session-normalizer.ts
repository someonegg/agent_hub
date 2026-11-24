import type { MessageItem, TimelineItem } from "../../../shared/domain.js";
import type { DomainDiagnostic } from "../../domain/session-domain.js";
import { truncateText } from "../../domain/session-text.js";
import { type DecodedRecord } from "../shared/jsonl-decoder.js";
import { MAX_MESSAGE_CHARS, MAX_SESSION_DIAGNOSTICS } from "../shared/limits.js";
import {
  isAgyUserInput,
  parseAgyBindingRecord,
  type ParsedAgyBindingRecord,
} from "./interaction.js";
import { extractAgyUserRequest } from "./user-content.js";

export interface AgyState {
  readonly nativeId: string;
  readonly line: number;
  readonly timeline: readonly TimelineItem[];
  readonly diagnostics: readonly DomainDiagnostic[];
  readonly decoderDiagnostics: readonly DomainDiagnostic[];
  readonly project: string | null;
  readonly workingDirectory: string | null;
  readonly taskName: string | null;
  readonly firstUser: string | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
  readonly pendingBindingReply: boolean;
}

/** Decoder codes are renamed to adapter-neutral session diagnostics. */
export function agyDecoderDiagnostics(
  diagnostics: readonly DomainDiagnostic[],
): DomainDiagnostic[] {
  return diagnostics.map((d) =>
    d.code === "malformed_json" ? { ...d, code: "invalid_jsonl" } : d,
  );
}

export function createAgyState(nativeId: string): AgyState {
  return {
    nativeId,
    line: 0,
    timeline: [],
    diagnostics: [],
    decoderDiagnostics: [],
    project: null,
    workingDirectory: null,
    taskName: null,
    firstUser: null,
    createdAt: null,
    updatedAt: null,
    pendingBindingReply: false,
  };
}

const BINDING_REPLY = /^ok[.!]?$/i;

function isBindingReply(content: string): boolean {
  let text = content.trim();
  const unpunctuated = text.replace(/[.!]$/, "").trim();
  const quote = unpunctuated.charAt(0);
  if (unpunctuated.length >= 2 && ['"', "'", "`"].includes(quote) && unpunctuated.endsWith(quote)) {
    text = unpunctuated.slice(1, -1).trim();
  }
  return BINDING_REPLY.test(text);
}

export function appendAgyRecords(
  previous: AgyState,
  records: readonly DecodedRecord[],
  diagnostics: readonly DomainDiagnostic[] = [],
  onBinding?: (binding: ParsedAgyBindingRecord) => void,
): AgyState {
  if (
    records.length === 0 &&
    JSON.stringify(previous.decoderDiagnostics) === JSON.stringify(diagnostics)
  )
    return previous;
  const state = { ...previous };
  const newItems: TimelineItem[] = [];
  const emit = (item: Omit<MessageItem, "id" | "ordinal">) => {
    const ordinal = previous.timeline.length + newItems.length + 1;
    newItems.push({
      ...item,
      markdown: truncateText(item.markdown, MAX_MESSAGE_CHARS).text,
      id: `${state.nativeId}:${ordinal}`,
      ordinal,
    });
  };

  for (const record of records) {
    const { ordinal, value: row } = record;
    state.line = ordinal;
    const timestamp =
      typeof row.created_at === "string" && Number.isFinite(Date.parse(row.created_at))
        ? row.created_at
        : null;
    if (timestamp) {
      state.createdAt ??= timestamp;
      state.updatedAt = timestamp;
    }
    if (isAgyUserInput(row)) {
      const binding = parseAgyBindingRecord(record);
      if (binding) {
        const { attempt } = binding.event;
        if (attempt.valid) {
          state.project = attempt.projectDirectory ?? state.project;
          state.workingDirectory =
            binding.workingDirectory ?? attempt.projectDirectory ?? state.workingDirectory;
          state.taskName = attempt.taskName ?? state.taskName;
        }
        state.pendingBindingReply = true;
        onBinding?.(binding.event);
        continue;
      }
      state.pendingBindingReply = false;
      const markdown = extractAgyUserRequest(typeof row.content === "string" ? row.content : "");
      if (!markdown.trim()) continue;
      state.firstUser ??= markdown;
      emit({ kind: "message", role: "user", phase: null, itemType: null, markdown, timestamp });
      continue;
    }
    if (row.source !== "MODEL" || row.type !== "PLANNER_RESPONSE") continue;
    const content = typeof row.content === "string" ? row.content : "";
    const hasToolCalls = Array.isArray(row.tool_calls) && row.tool_calls.length > 0;
    if (state.pendingBindingReply) {
      if (!hasToolCalls && !content.trim()) continue;
      state.pendingBindingReply = false;
      if (!hasToolCalls && isBindingReply(content)) continue;
    }
    if (!content.trim()) continue;
    emit({
      kind: "message",
      role: "assistant",
      phase: hasToolCalls ? "update" : "response",
      itemType: null,
      markdown: content,
      timestamp,
    });
  }
  return {
    ...state,
    timeline: newItems.length ? [...previous.timeline, ...newItems] : previous.timeline,
    decoderDiagnostics: diagnostics,
    diagnostics: diagnostics.slice(0, MAX_SESSION_DIAGNOSTICS),
  };
}
