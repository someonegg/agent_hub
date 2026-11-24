import type { TimelineItem, UserInputQuestion } from "../../../shared/domain.js";
import type { DomainDiagnostic } from "../../domain/session-domain.js";
import { normalizeSessionTitle, truncateText } from "../../domain/session-text.js";
import { type DecodedRecord, isObject as object } from "../shared/jsonl-decoder.js";
import { MAX_MESSAGE_CHARS, MAX_SESSION_DIAGNOSTICS } from "../shared/limits.js";
import { appendClaudeIdentity, type ClaudeIdentityState } from "./identity.js";
import { parseClaudeBindingRecord, type ParsedClaudeBindingRecord } from "./interaction.js";
import { isClaudeContextInjectionBlock } from "./user-content.js";
import { normalizeQuestionResponse, normalizeQuestions } from "./user-input-normalizer.js";

type ObjectValue = Record<string, unknown>;
export { object };
const string = (value: unknown): string | null => (typeof value === "string" ? value : null);

export interface ClaudeBindingReplyState {
  readonly messageId: string | null;
}

export interface ClaudeState extends ClaudeIdentityState {
  readonly timeline: readonly TimelineItem[];
  readonly diagnostics: readonly DomainDiagnostic[];
  readonly questions: ReadonlyMap<string, readonly UserInputQuestion[]>;
  readonly decoderDiagnostics: readonly DomainDiagnostic[];
  readonly normalizerDiagnostics: readonly DomainDiagnostic[];
  readonly pendingBindingReply: ClaudeBindingReplyState | null;
}

export type { ClaudeIdentityState } from "./identity.js";
/** Decoder codes are renamed to adapter-neutral session diagnostics. */
export function claudeDecoderDiagnostics(
  diagnostics: readonly DomainDiagnostic[],
): DomainDiagnostic[] {
  return diagnostics.map((d) =>
    d.code === "malformed_json" ? { ...d, code: "invalid_jsonl" } : d,
  );
}
export function createClaudeState(nativeId: string): ClaudeState {
  return {
    timeline: [],
    diagnostics: [],
    questions: new Map(),
    decoderDiagnostics: [],
    normalizerDiagnostics: [],
    line: 0,
    nativeId,
    firstCwd: null,
    cwd: null,
    project: null,
    taskName: null,
    customTitle: null,
    aiTitle: null,
    firstUser: null,
    version: null,
    createdAt: null,
    updatedAt: null,
    identityConflict: false,
    pendingBindingReply: null,
  };
}

export function appendClaudeRecords(
  previous: ClaudeState,
  records: readonly DecodedRecord[],
  diagnostics: readonly DomainDiagnostic[] = [],
  onBinding?: (binding: ParsedClaudeBindingRecord) => void,
): ClaudeState {
  if (
    records.length === 0 &&
    JSON.stringify(previous.decoderDiagnostics) === JSON.stringify(diagnostics)
  )
    return previous;
  const state = {
    ...previous,
    diagnostics: [...previous.normalizerDiagnostics],
  };
  const newItems: TimelineItem[] = [];
  let pendingQuestions = previous.questions;
  const mutableQuestions = () => {
    if (pendingQuestions === previous.questions) pendingQuestions = new Map(previous.questions);
    return pendingQuestions as Map<string, readonly UserInputQuestion[]>;
  };
  type NewItem<T = TimelineItem> = T extends TimelineItem ? Omit<T, "id" | "ordinal"> : never;
  const emit = (item: NewItem) => {
    const ordinal = previous.timeline.length + newItems.length + 1;
    if (item.kind === "message")
      item = { ...item, markdown: truncateText(item.markdown, MAX_MESSAGE_CHARS).text };
    newItems.push({ ...item, id: `${state.nativeId}:${ordinal}`, ordinal } as TimelineItem);
  };
  const retainDiagnostic = (diagnostic: DomainDiagnostic) => {
    const index = state.diagnostics.findIndex(
      (existing) => (existing.ordinal ?? Infinity) > (diagnostic.ordinal ?? Infinity),
    );
    if (index >= 0) state.diagnostics.splice(index, 0, diagnostic);
    else if (state.diagnostics.length < MAX_SESSION_DIAGNOSTICS) state.diagnostics.push(diagnostic);
    state.diagnostics.length = Math.min(state.diagnostics.length, MAX_SESSION_DIAGNOSTICS);
  };

  for (const record of records) {
    const { ordinal, value: row } = record;
    state.line = ordinal;
    if (!object(row) || row.isSidechain === true || row.parent_tool_use_id != null) continue;
    // API copies and progress/subagent notifications never supply conversation or bindings.
    if (!["user", "assistant", "custom-title", "ai-title", "system"].includes(String(row.type)))
      continue;
    if (!appendClaudeIdentity(state, row, ordinal, retainDiagnostic)) continue;
    const binding = parseClaudeBindingRecord(record);
    if (binding) {
      const { attempt } = binding;
      if (attempt.valid) {
        state.project = attempt.projectDirectory ?? state.project;
        state.taskName = attempt.taskName ?? state.taskName;
      }
      state.pendingBindingReply = { messageId: null };
      onBinding?.(binding);
      continue;
    }
    const timestamp = string(row.timestamp);
    if (row.type === "custom-title") {
      state.customTitle = normalizeSessionTitle(string(row.customTitle)) || state.customTitle;
      continue;
    }
    if (row.type === "ai-title") {
      state.aiTitle = normalizeSessionTitle(string(row.aiTitle)) || state.aiTitle;
      continue;
    }
    if (row.type !== "user" && row.type !== "assistant") continue;
    if (row.isMeta === true || row.isCompactSummary === true || row.subtype === "subagent")
      continue;
    const message = row.message;
    if (!object(message) || message.role !== row.type) continue;
    const role = row.type;
    let blocks: unknown[] = [];
    if (typeof message.content === "string") blocks = [{ type: "text", text: message.content }];
    else if (Array.isArray(message.content)) blocks = message.content;
    if (role === "user") {
      if (state.pendingBindingReply !== null && !isPureContextInjectionBlocks(blocks)) {
        state.pendingBindingReply = null;
      }
    } else if (state.pendingBindingReply !== null) {
      const decision = evaluateBindingReplyRow(row, message, blocks, state.pendingBindingReply);
      state.pendingBindingReply = decision.action === "continue" ? decision.next : null;
      if (decision.action !== "release") continue;
    }
    let phase: "update" | "response" | null = null;
    if (role === "assistant") {
      if (message.stop_reason === "tool_use") phase = "update";
      else if (message.stop_reason === "end_turn") phase = "response";
    }
    let text: string[] = [];
    const flush = () => {
      const markdown = truncateText(text.join("\n\n"), MAX_MESSAGE_CHARS).text;
      text = [];
      if (!markdown.trim()) return;
      if (role === "user") state.firstUser ??= markdown;
      emit({ kind: "message", role, phase, itemType: null, markdown, timestamp });
    };
    for (const block of blocks) {
      if (!object(block)) {
        flush();
        continue;
      }
      if (block.type === "text" && typeof block.text === "string") {
        const content = block.text;
        if (
          role === "user" &&
          (isClaudeContextInjectionBlock(content) ||
            /^\s*(?:<bash-(?:input|stdout|stderr)>|<local-command-|<command-name>|<command-message>|<task-notification>|<subagent|<teammate-message|\[Request interrupted by user)/.test(
              content,
            ))
        ) {
          flush();
          continue;
        }
        text.push(content);
        continue;
      }
      flush();
      if (role === "assistant" && block.type === "tool_use" && object(block.input)) {
        const callId = string(block.id);
        if (
          block.name === "ExitPlanMode" &&
          typeof block.input.plan === "string" &&
          block.input.plan.trim()
        ) {
          emit({
            kind: "message",
            role,
            phase: "response",
            itemType: "plan",
            markdown: block.input.plan,
            timestamp,
          });
        }
        if (block.name === "AskUserQuestion" && callId && Array.isArray(block.input.questions)) {
          const questions = normalizeQuestions(callId, block.input.questions);
          mutableQuestions().set(callId, questions);
          emit({ kind: "user_input", stage: "request", callId, questions, timestamp });
        }
      }
      if (
        role === "user" &&
        block.type === "tool_result" &&
        typeof block.tool_use_id === "string"
      ) {
        const callId = block.tool_use_id;
        const questions = pendingQuestions.get(callId);
        if (!questions) continue;
        emit(
          normalizeQuestionResponse(callId, questions, block.content, row.toolUseResult, timestamp),
        );
        mutableQuestions().delete(callId);
      }
    }
    flush();
  }
  return {
    ...state,
    timeline: newItems.length ? [...previous.timeline, ...newItems] : previous.timeline,
    questions: pendingQuestions,
    decoderDiagnostics: diagnostics,
    normalizerDiagnostics: state.diagnostics,
    diagnostics: [...diagnostics, ...state.diagnostics].slice(0, MAX_SESSION_DIAGNOSTICS),
  };
}

function isPureContextInjectionBlocks(blocks: readonly unknown[]): boolean {
  return (
    blocks.length > 0 &&
    blocks.every(
      (block) =>
        object(block) &&
        block.type === "text" &&
        typeof block.text === "string" &&
        isClaudeContextInjectionBlock(block.text),
    )
  );
}

function evaluateBindingReplyRow(
  row: ObjectValue,
  message: ObjectValue,
  blocks: readonly unknown[],
  pending: ClaudeBindingReplyState,
):
  | { readonly action: "suppress" | "release" }
  | { readonly action: "continue"; readonly next: ClaudeBindingReplyState } {
  if (
    row.isApiErrorMessage === true ||
    message.model === "<synthetic>" ||
    message.stop_reason === "tool_use"
  ) {
    return { action: "release" };
  }
  const rowMessageId = string(message.id);
  const textParts: string[] = [];
  for (const block of blocks) {
    if (!object(block)) return { action: "release" };
    if (block.type === "text" && typeof block.text === "string") {
      textParts.push(block.text);
      continue;
    }
    if (block.type === "thinking" || block.type === "redacted_thinking") continue;
    return { action: "release" };
  }
  let text = textParts.join("\n\n").trim();
  if (!text) {
    // Thinking rows can carry end_turn before the text row of the same message.
    const messageId = pending.messageId ?? rowMessageId;
    return {
      action: "continue",
      next: messageId === pending.messageId ? pending : { messageId },
    };
  }
  if (pending.messageId !== null && pending.messageId !== rowMessageId) {
    return { action: "release" };
  }
  const unpunctuated = text.replace(/[.!]$/, "").trim();
  const quote = unpunctuated.charAt(0);
  if (unpunctuated.length >= 2 && ['"', "'", "`"].includes(quote) && unpunctuated.endsWith(quote)) {
    text = unpunctuated.slice(1, -1).trim();
  }
  return /^ok[.!]?$/i.test(text) ? { action: "suppress" } : { action: "release" };
}
