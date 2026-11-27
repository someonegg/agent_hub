# Session JSONL processing

The [Codex](../src/server/adapters/codex/),
[Claude Code](../src/server/adapters/claude/), and
[Antigravity](../src/server/adapters/agy/) adapters decode complete JSONL lines
and publish only conversation messages and user input. Metadata,
pane bindings, and runtime facts are extracted independently of conversation
publication. See the [technical reference](technical-reference.md#conversation-reads)
for pagination and long polling, and [loading guarantees](technical-reference.md#discovery-and-caching)
for checkpoints, probe validation, and archive caching.

## Shared decoding and limits

Empty lines are ignored. Malformed JSON, non-object records, and lines above
8 MiB produce bounded diagnostics. Only newline-terminated records commit;
unterminated tails are reread after the next append. Decoder ordinals count
physical lines.

Message text is capped at 1,000,000 UTF-16 code units. Truncation avoids splitting
surrogate pairs.

Each adapter retains at most 50 diagnostics per session, with decoder diagnostics
taking priority over separately retained normalizer diagnostics. Final source
diagnostics are also capped at 50 while valid files continue to be processed. Identity
conflicts remain explicit state even when diagnostics are full. Diagnostics
appear in logs only.

## Codex

`user_message` and `agent_message` events publish nonempty message text.
Completed `UserMessage` accepts `text` parts; `AgentMessage` accepts `Text` parts;
`Plan` accepts `item.text` and publishes an assistant response with `itemType: plan`.
Parts join with blank lines. `commentary` maps to `update`; `final` and
`final_answer` map to `response`. Other phases remain null.

`request_user_input` calls retain questions/options; matched outputs retain exact
answers, an aborted result, or a safe unavailable fallback. Matching by `call_id`
continues across incremental batches. Unavailable answer summaries are capped at
256 UTF-16 code units. Browser cards combine loaded requests and responses; API
records retain their original ordinals.

Ordinals retain raw adapter positions, including gaps; visible messages are never
renumbered.

## Antigravity

The adapter reads `transcript_full.jsonl` because the compact transcript truncates
content. It accepts a new file when the first explicit user input is a valid
Agent Hub binding within the first 64 KiB. The decision is cached by path across
rewrites and replacements until a refresh observes the file missing or Agent Hub
restarts. Files below 64 KiB that have no explicit user input are rechecked when
their size or mtime changes.

User messages use the text inside `<USER_REQUEST>` when present. The first
visible user message supplies the title. Assistant messages come from
`PLANNER_RESPONSE` content and use phase `update` with tool calls or `response`
otherwise. Thinking, `SYSTEM_MESSAGE`, and tool records are skipped.

## Claude Code

Main records with auxiliary provenance, API copies, thinking, ordinary
tool calls/results, local commands, interruption notices and shell wrappers are
excluded from conversation output. Human mid-turn `attachment` records with
`attachment.type === "queued_command"` (`commandMode: "prompt"`) are published
as ordinary user messages; other `attachment` records are excluded. Ordinary
assistant text is retained regardless of model. Each complete JSONL line is
processed independently without message-ID aggregation; block order determines
consecutive item ordinals/IDs starting at 1. `parentUuid` links native messages.

Assistant phase uses only that row's `message.stop_reason`: `tool_use` → `update`,
`end_turn` → `response`, all other values → `null`. `ExitPlanMode.input.plan`
produces an assistant plan response; external plan files are never read.
`AskUserQuestion` emits independent request/result items keyed by tool call ID,
with question IDs `<callId>:<index>`. Structured answers take precedence; explicit
rejection is `aborted`, uninterpretable results are `unavailable`. No approval UI,
permission-mode, annotations or multi-select domain fields are synthesized.

Identity checks prefer the transcript’s `sessionId` and fall back to `session_id`
when it is absent. Claude can retain the earlier `session_id` after `/clear` in a
resumed pane.

Project association falls back to the first valid `cwd` when no binding supplies
one; execution uses the latest valid `cwd` (see the
[binding protocol](technical-reference.md#binding-format-and-ownership)).

Titles prefer the latest nonempty `custom-title`, then `ai-title`, then first
ordinary user text; otherwise the title is `Untitled session`, matching Codex.
Explicit titles use the first nonempty trimmed line (up to 80 characters); user
titles share Markdown heading extraction.

The timeline and first-user title fallback unwrap native `<pasted_content>`
only when it wraps the entire user text block. Embedded wrappers stay intact.

Main-session `ahub-bind` prompts (even with context-injection blocks) are
omitted from the timeline and first-user title fallback, along with any
immediate plain-text `OK` acknowledgment (including across preceding
thinking-only rows even when they carry `end_turn`). API errors, tool uses, and
other replies follow ordinary timeline rules.

See the native [stop reasons](https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons)
for assistant phase inputs.
