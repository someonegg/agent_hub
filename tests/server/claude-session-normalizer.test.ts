import { describe, expect, it } from "vitest";

import { formatClaudeBindingMessage } from "../../src/server/adapters/claude/binding-message.js";
import {
  appendClaudeRecords,
  type ClaudeState,
  createClaudeState,
} from "../../src/server/adapters/claude/session-normalizer.js";

const id = "claude-session";
const target = {
  socketPath: "/tmp/claude.sock",
  sessionName: "ahub-00000000-0000-4000-8000-000000000001",
};
const append = (state: ClaudeState, ...rows: Record<string, unknown>[]) =>
  appendClaudeRecords(
    state,
    rows.map((value, index) => ({ ordinal: state.line + index + 1, value })),
  );
const message = (
  role: "user" | "assistant",
  content: unknown,
  metadata: { id?: string; stop_reason?: string | null; model?: string } = {},
) => ({
  type: role,
  message: { role, content, ...metadata },
});
const bindingPrompt = message("user", formatClaudeBindingMessage(target, "/bound-project", null));
const timelineContent = (state: ClaudeState) =>
  state.timeline.map((item) =>
    item.kind === "message" ? `${item.role}:${item.markdown}` : item.kind,
  );
const ask = (question: string) =>
  message("assistant", [
    { type: "tool_use", name: "AskUserQuestion", id: "ask", input: { questions: [{ question }] } },
  ]);
const answer = (question: string) =>
  message("user", [
    { type: "tool_result", tool_use_id: "ask", content: { answers: { [question]: "Yes" } } },
  ]);

describe("Claude pasted user text", () => {
  const body = "第一行\n\n    indented line\n";
  const pasted = `<pasted_content id="fea8">\n${body}</pasted_content id="fea8">`;

  it("unwraps a native multiline paste for both the timeline and title fallback", () => {
    const state = append(createClaudeState(id), message("user", `\n\n${pasted}\n`));
    expect(timelineContent(state)).toEqual([`user:${body}`]);
    expect(state.firstUser).toBe(body);
  });

  it("keeps wrappers embedded in surrounding user text intact", () => {
    const embedded = `Before\n${pasted}\nAfter`;
    const state = append(
      createClaudeState(id),
      message("user", [{ type: "text", text: embedded }]),
    );
    expect(timelineContent(state)).toEqual([`user:${embedded}`]);
  });

  it("keeps assistant text and unmatched markers intact", () => {
    const unmatched = pasted.replace('</pasted_content id="fea8">', '</pasted_content id="abcd">');
    const state = append(
      createClaudeState(id),
      message("assistant", pasted),
      message("user", unmatched),
    );
    expect(timelineContent(state)).toEqual([`assistant:${pasted}`, `user:${unmatched}`]);
  });
});

describe("Claude incremental allocation", () => {
  it("reuses timeline and question collections for records without display items", () => {
    const before = append(createClaudeState(id), message("user", "Hello"), ask("Continue?"));
    for (const row of [
      { type: "progress", cwd: "/ignored" },
      message("user", "<system-reminder>hidden</system-reminder>"),
      message("user", "<system-context>hidden</system-context>"),
      message("user", "<ide_opened_file>hidden</ide_opened_file>"),
      message("user", "<ide_selection>hidden</ide_selection>"),
      message("assistant", [{ type: "tool_use", name: "Read", id: "read", input: {} }]),
      message("user", [{ type: "tool_result", tool_use_id: "missing", content: "result" }]),
    ]) {
      const after = append(before, row);
      expect(after.timeline, JSON.stringify(row)).toBe(before.timeline);
      expect(after.questions, JSON.stringify(row)).toBe(before.questions);
    }
  });

  it("updates metadata and identity diagnostics while reusing collections", () => {
    const before = createClaudeState(id);
    const after = append(
      before,
      { type: "system", cwd: "/project", version: "1", timestamp: "2026-01-01T00:00:00Z" },
      { type: "custom-title", customTitle: "Title" },
      { type: "ai-title", aiTitle: "AI title" },
      { type: "system", sessionId: "conflicting" },
    );
    expect(after.timeline).toBe(before.timeline);
    expect(after.questions).toBe(before.questions);
    expect(after).toMatchObject({
      cwd: "/project",
      firstCwd: "/project",
      version: "1",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      customTitle: "Title",
      aiTitle: "AI title",
      identityConflict: true,
    });
    expect(after.diagnostics).toHaveLength(1);
    expect(before.cwd).toBeNull();
  });

  it("hides binding messages and extracts project/task metadata synchronously", () => {
    const before = createClaudeState(id);
    const after = append(
      before,
      message("user", formatClaudeBindingMessage(target, "/bound-project", "Bound task")),
    );
    expect(after.timeline).toBe(before.timeline);
    expect(after.questions).toBe(before.questions);
    expect(after).toMatchObject({
      project: "/bound-project",
      taskName: "Bound task",
      firstUser: null,
    });
  });

  it("hides immediate OK binding replies across thinking rows and incremental splits", () => {
    for (const ack of [
      "OK",
      "OK.",
      "OK!",
      "ok",
      '"OK"',
      '"OK."',
      '"OK".',
      "'OK'",
      "`OK`",
      "\n  OK  \n",
    ]) {
      const before = createClaudeState(id);
      const after = append(
        before,
        bindingPrompt,
        message("assistant", [{ type: "text", text: ack }]),
      );
      expect(after.timeline, ack).toBe(before.timeline);
      expect(after.questions, ack).toBe(before.questions);
      expect(after.pendingBindingReply, ack).toBeNull();
    }

    const rows: Record<string, unknown>[] = [
      bindingPrompt,
      { type: "progress", cwd: "/ignored" },
      { type: "system", subtype: "api_error" },
      { type: "ai-title", aiTitle: "Bound" },
      { type: "user", isMeta: true, message: { role: "user", content: "meta" } },
      message("user", "<system-reminder>hook context</system-reminder>"),
      {
        type: "assistant",
        isSidechain: true,
        message: { role: "assistant", content: "Sidechain noise" },
      },
      message("assistant", [{ type: "thinking", thinking: "Just reply OK." }], {
        id: "msg_bind_1",
        stop_reason: "end_turn",
      }),
      message("assistant", [{ type: "redacted_thinking", data: "opaque" }], {
        id: "msg_other_thinking",
        stop_reason: "end_turn",
      }),
      message("assistant", [{ type: "text", text: "OK" }], {
        id: "msg_bind_1",
        stop_reason: "end_turn",
      }),
      // A second OK without another binding message is kept.
      message("assistant", "OK"),
      bindingPrompt,
      message(
        "assistant",
        [
          { type: "thinking", thinking: "Short ack" },
          { type: "text", text: "OK." },
        ],
        { id: "msg_bind_2", stop_reason: "end_turn" },
      ),
      message("user", "Real prompt"),
      message("assistant", "OK"),
    ];
    const full = append(createClaudeState(id), ...rows);
    expect(timelineContent(full)).toEqual(["assistant:OK", "user:Real prompt", "assistant:OK"]);
    for (let split = 0; split <= rows.length; split++) {
      const partial = append(createClaudeState(id), ...rows.slice(0, split));
      const beforeTimeline = [...partial.timeline];
      const merged = append(partial, ...rows.slice(split));
      expect(merged).toEqual(full);
      expect(partial.timeline).toEqual(beforeTimeline);
    }
  });

  const okBlock = [{ type: "text", text: "OK" }];
  it.each([
    {
      name: "substantial assistant reply",
      rows: [
        message("assistant", "Native Claude integration response"),
        message("assistant", "OK"),
      ],
      expected: ["assistant:Native Claude integration response", "assistant:OK"],
    },
    {
      name: "API error marked with isApiErrorMessage",
      rows: [{ ...message("assistant", okBlock), isApiErrorMessage: true }],
    },
    {
      name: "synthetic model error",
      rows: [message("assistant", okBlock, { model: "<synthetic>" })],
    },
    {
      name: "assistant row with tool_use block",
      rows: [
        message("assistant", [...okBlock, { type: "tool_use", id: "t1", name: "Read", input: {} }]),
      ],
    },
    {
      name: "assistant row with tool_use stop_reason",
      rows: [message("assistant", okBlock, { stop_reason: "tool_use" })],
    },
    ...["msg_b", undefined].map((id) => ({
      name: `${id === undefined ? "missing" : "different"} assistant message ID after thinking row`,
      rows: [
        message("assistant", [{ type: "thinking", thinking: "hmm" }], {
          id: "msg_a",
          stop_reason: null,
        }),
        message("assistant", okBlock, { id, stop_reason: "end_turn" }),
      ],
    })),
    {
      name: "user interruption clears pending binding reply",
      rows: [message("user", "[Request interrupted by user]"), message("assistant", "OK")],
    },
    {
      name: "local command clears pending binding reply",
      rows: [message("user", "<command-name>/help</command-name>"), message("assistant", "OK")],
    },
  ])("retains visible replies after a binding ($name)", ({ rows, expected = ["assistant:OK"] }) => {
    const state = append(createClaudeState(id), bindingPrompt, ...rows);
    expect(timelineContent(state)).toEqual(expected);
  });

  it("copies the timeline only when emitting and preserves existing items", () => {
    const before = append(createClaudeState(id), message("user", "Hello"));
    const after = append(before, message("assistant", "World"));
    expect(after.timeline).not.toBe(before.timeline);
    expect(after.timeline[0]).toBe(before.timeline[0]);
    expect(before.timeline).toHaveLength(1);
    expect(after.timeline[1]).toMatchObject({ id: `${id}:2`, ordinal: 2, markdown: "World" });
    expect(after.questions).toBe(before.questions);
  });

  it("copies questions on insertion and consumption without changing old snapshots", () => {
    const empty = createClaudeState(id);
    const requested = append(empty, ask("Continue?"));
    const originalQuestions = requested.questions.get("ask");
    expect(requested.questions).not.toBe(empty.questions);
    expect(empty.questions.size).toBe(0);
    const answered = append(requested, answer("Continue?"));
    expect(answered.questions).not.toBe(requested.questions);
    expect(answered.questions.size).toBe(0);
    expect(requested.questions.get("ask")).toBe(originalQuestions);
    expect(answered.timeline[1]).toMatchObject({ outcome: "answered" });
  });

  it("uses the latest duplicate call ID and consumes questions within the same batch", () => {
    const before = append(createClaudeState(id), ask("Old?"));
    const rows = [ask("First?"), ask("Latest?"), answer("Latest?"), answer("Latest?")];
    const full = append(before, ...rows);
    expect(full.questions.size).toBe(0);
    expect(before.questions.get("ask")?.[0]?.question).toBe("Old?");
    expect(full.timeline).toHaveLength(4);
    expect(full.timeline[3]).toMatchObject({
      outcome: "answered",
      answers: [{ questionId: "ask:0", answers: ["Yes"] }],
    });
    expect(full.timeline.map(({ id: itemId, ordinal }) => [itemId, ordinal])).toEqual(
      full.timeline.map((_, index) => [`${id}:${index + 1}`, index + 1]),
    );
    for (let split = 0; split <= rows.length; split++) {
      const partial = append(before, ...rows.slice(0, split));
      const snapshot = [...partial.questions];
      expect(append(partial, ...rows.slice(split))).toEqual(full);
      expect([...partial.questions]).toEqual(snapshot);
    }
  });
});
