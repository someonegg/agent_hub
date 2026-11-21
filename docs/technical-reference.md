# Technical reference

Contracts, limits, and runtime guarantees. For workflows, see [Usage](usage.md);
for contributor setup, see [Development](development.md). Detailed parsing rules
live in [JSONL processing](session-jsonl-filtering.md), decision rationale in
[ADRs](adr/README.md), and exact response types in
[api-contract.ts](../src/shared/api-contract.ts).

IDs and revisions are opaque strings. Message positions are nonnegative ordinals;
use each returned `nextAfter` as the next request's `after`.

- [Sources and identity](#sources-and-identity)
- [Conversation model](#conversation-model), [catalog](#catalog), and [reads](#conversation-reads)
- [Runtime binding and ownership](#runtime-binding-and-ownership)
- [Tmux interaction](#tmux-interaction) and [Terminal Preview](#terminal-preview)
- [Asynchronous management](#asynchronous-management), including [runtime CLI compatibility](#runtime-cli-compatibility)
- [Session CLI](#session-cli)
- [File uploads](#file-uploads)
- [Optional hosting](#optional-hosting)
- [Browser state](#browser-state)

## Sources and identity

### Discovery and caching

| Runtime | Sources                                                                                                  |
| ------- | -------------------------------------------------------------------------------------------------------- |
| Codex   | `rollout-*.jsonl` under `sessions/` and `archived_sessions/`; advisory titles from `session_index.jsonl` |
| Claude  | `projects/<project>/<UUID>.jsonl`; main sessions only, excluding native shell commands/output            |

Codex follows trusted-directory symlinks through depth 8 (root = 0), without
cycle detection or real-path deduplication. Logical paths determine order/cache keys.
Reading does not modify native history. Parsing rules live in
[JSONL processing](session-jsonl-filtering.md).

Ordinary sessions cache by relative path, size, and `mtimeMs`; unchanged keys
(including permission-only changes) skip reads. Growth reuses decoded prefixes
when SHA-256 probes match the first 4 KiB and up to 4 KiB before the previous EOF.
One handle reads to observed EOF from the last committed newline. Restart,
truncation, detected same-size changes, or probe mismatch force full decoding.
Checkpoints are process-local; middle rewrites preserving probes can escape detection
([ADR-102](adr/0102-use-immutable-incremental-session-snapshots.md)). Loaded archives
remain cached until restart/restoration; discovery, removal, metadata refresh,
and failed-load retries continue.

Codex excludes auxiliary rollouts before normalization/binding extraction. The
shared decoder checks up to 64 KiB of complete records, continuing on the same
handle/parser to observed EOF as needed. Auxiliary/duplicate exclusions persist
by relative path until observed removal or source rebuild; edits or loss of the
accepted original do not clear them
([ADR-115](adr/0115-retain-codex-path-exclusions.md)).

### Session identity

Native IDs are agent-scoped. Adapters publish nonempty native IDs; management
format validation belongs to the owning adapter (both current adapters require
UUIDs). Codex rollouts with missing or blank IDs are skipped with a bounded source
warning and retried on every refresh.

Duplicates retain the accepted readable rollout, otherwise the first fully
readable candidate in logical path order. Codex caches confirmed duplicate
exclusions as described above. Claude identifies candidates by filename before
decoding and reloads changed candidates and replacements; missing paths leave
its caches.

### Adapter publication and diagnostics

Adapters publish deeply immutable snapshots with source-local unique IDs;
aggregation asserts uniqueness only in `development`/`test`. Unchanged source
signatures return the same snapshot; reused references mean unchanged content.
Binding events describe the decoded batch; project/task metadata accumulates.
Registration requires independently unique, nonempty `instanceKey` and `agent`.
See [adapter types](../src/server/domain/session-domain.ts).

Diagnostics are log-only: deduplicated, bounded, skipped on cache hits, and unable
to interrupt work. Refresh telemetry has no HTTP API. `ENOENT`, `EACCES`, `EPERM`,
`ESTALE`, `EISDIR`, `ENOTDIR`, and `ELOOP` skip/diagnose unreadable portions;
missing scan roots are normal, other errors propagate. Successful snapshots do
not guarantee complete filesystem coverage.

HTTP session IDs use `[A-Za-z0-9_-]{20,100}`, distinct from native IDs;
[path validation](../src/server/http/session-path.ts) also checks ordinal bounds.

### Agent identity and routing

An Agent owns configuration, Skills, memory, and model settings; Codex and Claude
Code are Runtimes. Catalog agents expose `nickname`, `runtimeName`, and management
capabilities; session origins expose `agent`, `runtimeName`, nullable
`runtimeVersion`, and no `formatVersion`.

Public nicknames route requests; configured absolute paths namespace identities.
Renaming/reordering preserves session IDs; moving agent directories changes them.
Projects merge by directory across agents; agent paths remain private.

Defaults configure both `codex=~/.codex` and `claude=~/.claude`, Codex first unless
`~/.codex` is absent. Explicit agents replace defaults in argument order; nickname
`default` has no special meaning. Creation uses the first nickname when omitted;
unknown nicknames return `400`, request-ID reuse across agents `409`.
Operations use the owning CLI/environment: `CODEX_HOME` or `CLAUDE_CONFIG_DIR`.
See [Multiple agents](usage.md#multiple-agents).

## Conversation model

Adapters publish immutable `NormalizedSession` metadata, ordered `timeline`, and
optional interaction configuration. HTTP `SessionSummary`/`SessionDetail` combine
source facts with observed runtime status and resume availability.

`TimelineItem` is shared by adapters and HTTP reads. Every item has `id`, `ordinal`,
and `timestamp`:

- `message`: `role` (`user | assistant`), `phase` (`update | response | null`),
  `itemType` (`plan | null`), and `markdown`. Plans are assistant responses.
- `user_input`: `callId`, `stage`, and either request questions (IDs, headers,
  text, options) or response `outcome`: `answered` (question-scoped answers),
  `aborted`, or `unavailable` (summary). The browser pairs cards by `callId`.

See [domain types](../src/shared/domain.ts) and
[JSONL processing](session-jsonl-filtering.md).

## Catalog

`GET /api/v1/sessions` returns a complete catalog snapshot:
`{ revision, agents, projects, sessions }`. Clients filter and group sessions locally.

| Collection | Fields                                                                                 |
| ---------- | -------------------------------------------------------------------------------------- |
| `agents`   | `nickname`, `runtimeName`, and `management: { archive }`, including empty agents       |
| `projects` | `directory`                                                                            |
| `sessions` | `id`, `agent`, `title`, `projectDirectory`, optional `taskName`, `status`, `updatedAt` |

Catalog reads resolve titles from the owning agent’s valid `thread_name`, falling
back to the original title. Missing directories yield `projectDirectory: null`.

Only `after` (43-character base64url revision) is accepted; invalid/extra queries return `400`.

| Condition                                   | Result                   |
| ------------------------------------------- | ------------------------ |
| No `after`, or different revision           | Immediate `200` snapshot |
| Matching revision changes within 25 seconds | `200` snapshot           |
| Unchanged after 25 seconds                  | Bodyless `204`           |
| Over 100 waiters                            | `429`, `Retry-After: 2`  |

Waiters share a 1.5-second probe that stops when idle; disconnect or shutdown
releases waiters. Revisions cover agents, titles, projects, task associations, and
effective runtime status. Timestamps, conversation content, and diagnostics are excluded.

Status is `normal | live | archived`: archive wins; Live requires an observed
living, owned tmux session. Normal does not authorize Resume. Runtime checks coalesce
concurrent observations and bound socket concurrency; errors revoke Live and resume.

## Conversation reads

`GET /api/v1/sessions/:id/messages` is the single conversation read endpoint.
Queries: `after` (nonnegative ordinal), `limit` (1–300, default 10), `wait`
(boolean, default false), and optional `stateRevision` (43-character base64url).
It returns `session`, `interaction`, `items`, `nextAfter`, `hasMore`, and
`stateRevision`. `GET /api/v1/sessions/:id` returns
`{ session, interaction, stateRevision }` and accepts no query parameters.

Without `after`, reads return the latest messages in original order.
Ordinals retain adapter order and may have gaps.
`nextAfter` is the consumed boundary; `hasMore` indicates remaining messages.
Pages use binary search and an approximately 4 MiB item budget; the first item
always returns to guarantee progress, even if oversized.

With `wait=true`, backlog returns immediately. At the end, a missing revision
returns a baseline snapshot; a changed public session/interaction state also
returns immediately. Matching state and no messages wait up to 25 seconds before
bodyless `204`. Probes run every 1.5 seconds with capacity 100/process and
10/session; overflow returns `429` and `Retry-After: 2`. Disconnect, timeout, and
shutdown release capacity. Concurrent same-session probes share immutable source
and runtime observations; pagination remains request-specific. Each response
uses the same runtime observation for status and interaction.

`SessionReadService` assembles public responses using an injected interaction
describer. Interaction effects read internal facts through `InteractionSessionReader`
over the same catalog and revalidate observations before acting.

`stateRevision` covers `session` except `updatedAt`, plus all of `interaction`;
it does not validate history. Out-of-range ordinals return `400 after_out_of_range`
(browser retries once from `after=0`); other rewrites may require page reload.
Terminal Preview has an independent revision protocol.

Resume availability is `session.resume: { allowed, reason }`.

## Runtime binding and ownership

### Binding format and ownership

Both adapters bind using `printf` and shell environment expansion without tmux
queries, allowing binding under Claude's worktree isolation checks.

Codex and Claude emit and recognize six-line `AHUB_TMUX_BIND_V3` records:
marker, absolute socket path, `ahub-<UUID>` session name, optional operation UUID,
optional project directory, and JSON task name or `null` (empty fields retain lines).
Codex accepts user-message `<user_shell_command>` output; Claude accepts native
main-user `<bash-stdout>` output. Unknown markers produce no binding events.
Invalid required V3 fields produce an invalid binding event.
An invalid latest binding attempt never falls back.

A process-wide manager tracks each session’s latest binding attempt and valid claims
to socket/session pairs across agents. Attempts, including appends, are ordered by
timestamp (invalid = zero), global session ID, ordinal, then position. New claims
retain claims on other sessions. Takeover makes former owners `superseded`, revoking effects and
attach. `supersededBySessionId` names a readable replacement (including archived),
otherwise null. Claims survive archive, deletion, rereads, and Hub close for the
process lifetime; later explicit binds can reclaim them. See [binding manager](../src/server/interaction/pane-binding-manager.ts).

### Project directory

Latest valid bind overrides Working Directory: absolute project path without
NUL/CR/LF; no filesystem/Git checks. Invalid/empty fields preserve earlier project
paths and do not invalidate pane bindings.

### Task association

Create accepts optional `taskName`; resume retains it and rejects overrides.
Names are trimmed, case-sensitive, and shared across agents/projects;
`<`, `>`, NUL, CR and LF are rejected. Unassigned responses omit the field.

Latest valid bind overrides the task. Empty, invalid, null, or missing fields
preserve it without invalidating bindings; there is no clear operation.

## Tmux interaction

| Endpoint                                         | Contract                                   |
| ------------------------------------------------ | ------------------------------------------ |
| `POST /api/v1/sessions/:id/messages`             | `{ message, requireIdle? }` → `204`        |
| `POST /api/v1/sessions/:id/keys`                 | `{ keys, requireIdle? }` → `204`           |
| `POST /api/v1/sessions/:id/handoff-pane-binding` | `{}` → `204`; later bind confirms handoff  |
| `GET /api/v1/sessions/:id/terminal`              | Fresh `{ content, capturedAt, truncated }` |
| `WS /api/v1/sessions/:id/terminal-preview`       | Snapshot/delta/error frames                |

[interaction.ts](../src/shared/interaction.ts) defines keys/message limits.
Supported responses include `state`, `activity`, `supersededBySessionId`,
`attachCommand`; unsupported responses contain `supported: false`, `attachCommand`.
States: `unbound`, `disconnected`, `connected`, `unknown`, `superseded`.

Effects require current-user socket ownership, session liveness, and binding ownership.
Targets use a required absolute `socketPath` and `sessionName` matching `ahub-<UUID>`.
Each session must have exactly one window and one pane. Users must not rename,
move, link, or add windows/panes; Hub validates names but does not inspect or repair topology.

Liveness matches session names exactly. Concurrent checks coalesce without caching
completed results. Missing sockets, stopped servers, and absent sessions establish
exit; permissions, timeouts, and query errors do not. Binding changes during awaits
fail closed. Input and captures serialize per target and revalidate liveness and
ownership before effects; uncertain writes are never retried. Socket/session reuse
has no process-identity check. See [runtime](../src/server/interaction/session-runtime.ts)
and [tmux service](../src/server/interaction/tmux-service.ts).

HTTP message sends observe terminal text before pasting and wait up to two seconds
for a change before sending Enter. If no change is observed, the request fails with
`message_not_submitted` without sending Enter or retrying; this confirms terminal
echo, not agent acceptance. Direct service callers opt into this confirmation explicitly.

`requireIdle: true` rejects non-idle input at transaction entry without waiting
or retry; browser calls omit this restriction. Interrupt cannot require idle.
Connection, ownership, and management occupancy checks still apply.
Handoff sends the adapter binding command; success confirms delivery, not binding.

### Activity observation

Activity is null unless connected. Output within five monotonic seconds means
`working`, otherwise `idle`; initial/failed observations mean `unknown`.
`%output`/`%extended-output` subscriptions retry on the next read. Reader/interaction
reads renew a 30-minute lease. Activity shares preview control clients without
capturing frames. Transitions affect reader revisions, repeated working output
does not; catalog excludes activity.

### Terminal Preview

Preview is plain-text current screen, without scrollback/emulation. It retains
the last 256,000 UTF-8 bytes at character boundaries, marking removed prefixes
`truncated`. HTTP captures once without listeners/cached WebSocket content; both
transports share binding checks and capture limits.

WebSocket inherits TLS/mTLS, rejects queries/cross-origin browser requests, and
accepts no application messages. Ordinary HTTP returns `426`.

| Frame `type` | Fields                                                              |
| ------------ | ------------------------------------------------------------------- |
| `snapshot`   | `revision`, `content`, `truncated`, `capturedAt`                    |
| `delta`      | `baseRevision`, `revision`, `operations`, `truncated`, `capturedAt` |
| `error`      | `code`, `message`, `retryable`                                      |

Connections start with snapshots. Delta operations (`startLine`, `deleteCount`,
`lines`) use preceding-frame indices in descending, nonoverlapping order.
Split/join on `"\n"` preserves blank/trailing lines; truncation-only changes may
have no operations. Oversized, expensive, or non-smaller deltas become snapshots.
Invalid frames require reconnect without clearing display. Errors close with `1013`
if retryable, otherwise `1008`.

Shared listeners/captures never resize/change terminal environments. Output merges
over 350 ms; only content/truncation changes publish. Capacity is 100/process,
10/session including initialization; overflow returns retryable
`preview_capacity_exceeded`. Identical valid binds preserve subscriptions;
ownership loss, invalid binds, changed targets, or listener failure close them
permanently, even if ownership returns.

## Asynchronous management

| Endpoint                              | Body / result                                                                                                                                                                        |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /api/v1/sessions`               | New: `{ agent?, projectDirectory, workingDirectory?, taskName?, worktree, permissionMode?, requestId }`; resume: `{ resumeSessionId, permissionMode?, requestId }` → `202` operation |
| `POST /api/v1/sessions/:id/exit`      | `{}` → `202` operation                                                                                                                                                               |
| `POST /api/v1/sessions/:id/archive`   | `{}` → `202` operation                                                                                                                                                               |
| `DELETE /api/v1/sessions/:id`         | `{}` → `202` operation                                                                                                                                                               |
| `GET /api/v1/operations/:operationId` | Current operation                                                                                                                                                                    |

Creation requires `projectDirectory`; optional `workingDirectory` defaults to it.
The adapter validates both as absolute existing local directories and resolves
symlinks, without checking Git relationships. The working directory controls
process launch; the project directory controls binding and association checks.
Idempotency includes both directories, normalized task name, and launch options;
omitted working directory equals an explicit project directory. `worktree` is
an independent agent launch option.

### Operation model

Operations include `operationId`, `type`, `status`, `createdAt`, `updatedAt`,
nullable `sessionId`, `error`, `phase`, `attachCommand`, optional
`target: { socketPath, sessionName }`, and launch `mode: new | resume`.
Types: `create`, `exit`, `archive`, `delete`; statuses: `pending`, `succeeded`,
`failed`, `unknown`. Exit phases are `sending_exit`, `waiting_exit`; archive adds
`archiving`, `confirming_archive`; delete adds `deleting`, `confirming_delete`.

### Idempotency and conflicts

Request IDs: 8–128 letters/digits/underscores/hyphens. Identical launch IDs/arguments
coalesce through execution and 30-minute terminal retention; changed arguments
return `409`. Different IDs permit concurrent project creation. Resume/lifecycle
share session occupancy: identical lifecycle operations coalesce, conflicts return
`409` without queuing. Different IDs cannot concurrently resume one session.

### Execution and confirmation

Delete is required; archive is optional. Public agent archive capability derives from
method presence; Codex supports archive and Claude does not. Unsupported archive
HTTP requests return `409 operation_not_supported`; lifecycle execution repeats
the check before resolving targets, exiting, or invoking native effects.

#### Create and resume

Create and resume use the same launch flow; equal directory inputs share resolution.
Confirmation requires the operation marker, expected target and project, and a
live owned binding within 60 seconds after launch.
Resume additionally requires the original unarchived, valid native identity.

Resume permits no binding, confirmed exit, or explicit transfer; invalid or
uncertain bindings deny it. It occupies the session, refreshes the source once,
records a binding baseline, and evaluates runtime once. Prelaunch rechecks
binding/operation validity without another external scan or filesystem/tmux atomicity.
Working Directory is tried before Project Directory: invalid paths are skipped;
fallback is allowed only for missing/non-directory paths. Launch retains the
original project association and rejects agent/projectDirectory/workingDirectory/worktree
overrides. Unbound sessions require the original process to have exited.

Codex launches `ahub-<operationId>` with the runtime flags below and an initial
native `! printf ...` binding command; its recorded output supplies the marker and
project/task association. Claude's handshake is specified below.
Attach becomes available after 30 seconds using the known target or configured
socket/deterministic session name, and survives timeout. Confirmed no-launch tmux
errors produce `failed`; launch timeout, malformed success, and post-launch errors
produce `unknown`, without retry or teardown.

#### Exit

Exit validates the latest binding and controls the whole tmux session, including
manual binds, while retaining history. Unbound succeeds; missing fails; archived
sessions use the same checks. Query errors or ownership changes produce `unknown`.

Both adapters send Ctrl-C at 0, 200, 2600, and 2800 ms, Ctrl-D at 6 seconds, then
one targeted `kill-session` at 15 seconds if still running. Each step checks
cancellation and ownership/state; natural exit stops further input. Forced close
still requires absence confirmation within the 30-second exit budget.
See [ADR-112](adr/0112-separate-exit-from-history-management.md).

#### Archive and delete

Archive refreshes the source; already archived succeeds. Otherwise it validates
native identity, exits, invokes native archive once (25-second command limit),
and confirms archive state within 30 seconds.

Delete runs Exit validation and sequence, then permanently removes history through
the owning adapter (Codex: `codex delete <UUID> --force`; Claude: remove session
JSONL and associated per-session directory). Exit, deletion, and same-source
absence confirmation have separate 30-, 25-, and 30-second budgets. Initially
absent in a successful snapshot succeeds. Successful snapshots may skip unreadable
data and confirm absence; thrown reads cannot.

Occupancy blocks ordinary input/handoff with `409 session_busy`; archive/delete
hold it through confirmation. Native identity validation, directory resolution,
history effects, and exit steps belong to the owning adapter. The
[coordinator](../src/server/management/operation-service.ts) owns idempotency,
occupancy, deadlines, retention, and cleanup; executors validate, invoke adapters,
and confirm results. Shutdown reuses the exit service.

### Runtime CLI compatibility

Adapters require authenticated runtime CLIs on `PATH`:

| Runtime     | Create and resume                                                                      | Launch options                                                                       | History management                                                                            |
| ----------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Codex       | Interactive `codex` and `codex resume <UUID>`, both with `--no-daemon --no-alt-screen` | `--worktree`; Auto: `--approve-for-me`; YOLO: `--yolo`                               | `codex archive <UUID>` and `codex delete <UUID> --force`                                      |
| Claude Code | Interactive `claude` and `claude --resume <UUID>`                                      | `--worktree`; Auto: `--permission-mode auto`; YOLO: `--dangerously-skip-permissions` | The adapter deletes local session files directly; no native archive/delete command is invoked |

Implementations: [Codex](../src/server/adapters/codex/session-manager.ts),
[Claude](../src/server/adapters/claude/session-manager.ts).

### Claude launch readiness

Claude captures the native prompt for up to 15 seconds, retrying unsuccessful
checks every second. One matching empty prompt with the cursor in the allowed
rectangle permits one binding-command send. Create/resume interrupts once after
confirmed binding; handoff does not. Interrupt is Ctrl-U, 100 ms, Escape.
Capture, delivery, interrupt, or readiness failures produce `unknown` with target/attach.

Global `--claude-ready-script <path>` replaces the predicate for every Claude agent:

| Contract         | Value                                                                                                           |
| ---------------- | --------------------------------------------------------------------------------------------------------------- |
| Execution        | Direct executable with shebang; relative paths resolve from Hub startup directory                               |
| stdin            | `{ "current": { "content": "...", "cursorX": 2, "cursorY": 1 }, "context": "" }`; zero-based coordinates        |
| stdout           | `{ "ready": false, "context": "opaque text" }`; output limit 1 MiB                                              |
| Context          | Empty per launch; returned context is passed unchanged to the next check                                        |
| Missing snapshot | Skip execution, preserve context, retry after one second                                                        |
| Failure          | Nonzero exit, invalid output, or remaining 15-second deadline exceeded: send no binding input, return `unknown` |

Diagnostics use stderr. Claude treats `!`-prefixed input as ordinary model input
(verified with 2.1.318; recheck on upgrade) and records the binding. See [implementation](../src/server/adapters/claude/session-manager.ts).

### Tracking and recovery

Tracking continues without clients. Timeout produces `unknown` without undoing
commands. Immutable terminal results release execution/occupancy and retain launch
deduplication for 30 minutes. Hung observations cannot block cleanup; late
continuations check activity. Restart loses tracking, leaving tmux running.
Unknown launches retain target/attach; same request ID retrieves retained results.
A new ID can launch after normal checks even if the earlier launch still runs.

## Session CLI

### CLI output contract

Business commands default to human-readable stdout; diagnostics use stderr.
`--json` emits one compact result or `{ "error": { "code", "message" } }` plus
newline; help stays text. Argument/validation/dispatch errors use `invalid_arguments`;
other resource failures use `command_failed`. Session connection errors use
`query_failed`; local validation fails before requests.

### Client behavior and results

`ahub-cli session` is a stateless HTTP client, without native-history access,
direct tmux control, server discovery/startup, or persisted recovery state.
URL precedence: `--url`, `AGENT_HUB_URL`, `http://127.0.0.1:4173`.
HTTP/HTTPS are supported; HTTPS uses Node.js verification and `NODE_EXTRA_CA_CERTS`.

One `--timeout` deadline covers stdin, HTTP, operation polling, and readiness:
15 seconds by default, 45 for create/resume/exit/archive/delete. Follow uses
[per-request deadlines](#cli-continuous-inspection). Lifecycle commands have no
CLI confirmation prompt and await management; create/resume additionally wait
for live, connected, idle state. Input success confirms neither task completion
nor answer correctness.

| Exit code | Meaning                                                       |
| --------- | ------------------------------------------------------------- |
| `0`       | Success                                                       |
| `1`       | Definite failure, including queries                           |
| `2`       | Submitted write may have taken effect but remains unconfirmed |

Interruptions, disconnects, deadlines, polling failures, and unknown results
never resubmit or cancel mutations.

### Public session CLI results

CLI output uses explicit whitelists independent of HTTP response types. It omits
operation/request IDs and attach commands. Inspect exposes the owned tmux target.
Launch errors retain `sessionId` and `tmux` inside `error` (unknown values are null),
including readiness timeouts. Exact fields and text formatting live in
[session-output.ts](../src/server/cli/session-output.ts).

| Command       | Result                                                                              |
| ------------- | ----------------------------------------------------------------------------------- |
| `list`        | `{ sessions }`: identity, title, status, agent, project, update time, optional task |
| `inspect`     | `{ session, interaction, items, nextAfter, hasMore }`                               |
| `terminal`    | `{ content, truncated, capturedAt }`                                                |
| Input/handoff | `{ sessionId, status: "sent" }`                                                     |
| Lifecycle     | `{ sessionId, status: "succeeded" }`; create/resume also include `tmux`             |

`--project` filters project association, not launch/worktree location. Explicit IDs
go directly to endpoints without catalog lookup. Nullable metadata remains
null; absent task names remain omitted. Inspect includes the owning agent's nickname
and current interaction, with `tmux: { socketPath, sessionName } | null`.

Items retain message Markdown and user-input content. Plans and input requests
include `inputHint`; answered responses flatten selections into `answers: string[]`
in question/answer order. Text output preserves full content, flattening whitespace
only in summaries/tables. See [ahub-control](../skills/ahub-control/SKILL.md#choose-actions-by-session-state)
for the input workflow.

### CLI continuous inspection

`inspect --follow` reads immediately, drains pages sequentially, then long-polls.
`--count` requires follow and counts rounds, including empty/`204` rounds; the last
round drains all pages. Otherwise it runs until canceled, including idle or
disconnected periods. `--timeout` is per request (default 30 seconds), with no
overall deadline; stopping observation does not stop the session.

The first result prints unconditionally; later results require new visible items
or changed session/interaction state excluding `updatedAt`. Position-only advances
are silent. JSON is NDJSON using the inspect shape with each page's incremental
items. Nonadvancing pagination, API/network errors, or request timeouts exit `1`
without retry; Ctrl+C cancels reads/timers and exits normally.

### Input policy

`send` rejects a leading `/` unless `--force`: both `--message` and `--stdin`
check only the first character, without trimming or checking subsequent lines.
This guard does not apply to HTTP.

Messages and ordinary keys default to `requireIdle: true`; `--force` disables it.
Interrupt and handoff skip the idle requirement. Ordinary keys use the
non-interrupt whitelist; all operations retain connection, ownership, and
management occupancy checks.

## File uploads

| Endpoint                                                          | Contract                                         |
| ----------------------------------------------------------------- | ------------------------------------------------ |
| `POST /api/v1/uploads?sessionId=<Hub ID>&filename=<encoded name>` | Raw binary, ≤20 MiB; existing session required   |
| `GET /api/v1/sessions/:id/uploads`                                | `{ items }`, newest first, unpaginated           |
| `GET /api/v1/sessions/:id/uploads/:attachmentId/content`          | Raster preview; `?download=1` downloads          |
| `GET /api/v1/sessions/:id/uploads/:attachmentId/thumbnail`        | Cached WebP thumbnail; unavailable returns `404` |
| `DELETE /api/v1/sessions/:id/uploads/:attachmentId`               | Delete content/registration; idempotent          |

Upload returns `201` with `path`, `id`, `sessionId`, `filename`, `size`, `type`,
and `uploadedAt`; unique paths prevent overwrites. Oversize is `413`, storage
failure `500`. Mutations reject cross-origin requests. Content/deletion are
session-scoped; non-preview types (including HTML/SVG) download. Originals use
`nosniff`, sandbox CSP, and `no-store`.

PNG/JPEG/GIF/WebP/AVIF thumbnails are static, auto-oriented WebP, at most
360 × 280 without enlargement (40-million-pixel input limit). Generation runs
serially in the background, coalesces same-thumbnail work, and never delays/fails
upload. Older uploads generate on demand; decode failures return `404`. BMP skips
thumbnails. History loads thumbnails lazily, originals only on expansion; failed
thumbnails never trigger automatic original loads. Thumbnail files are atomic,
beside originals, with `private, max-age=86400` caching.

Storage is `<home-dir>/uploads/<Hub session ID>/` with absolute content paths and
atomic metadata replacement. HTTP/storage validate Hub IDs, UUID-v4 attachment IDs,
metadata identity, and direct filenames/extensions. Reads/deletion/recovery reject
corrupt metadata and symlink escapes using real locations. Invalid IDs return `400`;
missing files retain not-found/idempotent-delete semantics.

Deletion tombstones metadata before content removal, retrying failed cleanup on
delete/startup. Startup clears interrupted uploads and orphan thumbnails without
blocking service. Confirmed session deletion schedules cleanup; exit, archive,
and unconfirmed deletion retain uploads.

Attachment messages prepend absolute paths as Markdown list items, separated from
optional text by a blank line; paths count toward message limits. Failed sends
retain drafts; success clears unchanged drafts. Removing draft attachments retains
stored files. See [Usage](usage.md#file-uploads).

## Optional hosting

`--hosting` enables adapter-independent storage/endpoints;
`GET /api/v1/capabilities` reports `{ hosting: boolean }`. Disabled hosting creates
no storage and resource routes return `404`. Offline CLI uses `--home-dir`/`--json`;
HTTP resources inherit configured HTTPS/mTLS/proxy authentication.

Malformed URLs/encodings return `400`, missing resources `404`, unexpected
storage/metadata/deletion errors `500 internal_error` with `requestId`. Logs
correlate method/path/error without bodies; post-header failures terminate responses.
Publish/delete share an atomic-rename lock; recovery requires OS-confirmed PID
absence. Tombstones protect new locks; live PID reuse prevents reclamation.

### Web pages

| Endpoint                       | Contract                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------- |
| `GET /api/v1/artifacts`        | Rescan projects: `{ projects: [{ directory, artifacts }] }`; skip/diagnose invalid metadata       |
| `DELETE /api/v1/artifacts/:id` | Remove all snapshots                                                                              |
| `/web/:id/`                    | `302` to `/web/:id/:snapshotId/`                                                                  |
| `/web/:id/:snapshotId/…`       | GET/HEAD files or directory `index.html`; no listing, traversal, metadata access, or SPA fallback |

Canonical project `realpath` plus name determines identity, independent of
agents/sessions. Default name is the resolved source basename; updates retain
titles unless `--title` is supplied. Republishing retains history; moving projects
changes association. Random 32-character lowercase hex IDs identify artifacts and
snapshots. Storage is `<hosting>/artifacts/<id>/artifact.json` plus
`snapshots/<snapshot-id>/`; metadata records identity, title, project/source,
current snapshot, timestamps, and relative URL, without session/server identity.

Publication accepts regular files/directories; rejects nested symlinks, special
files, and hosting overlap. Snapshot rename precedes atomic metadata replacement,
preserving prior metadata on failure. All snapshots persist until artifact deletion,
including interrupted/unreferenced ones; no expiry/history management exists.

Serving reads disk metadata, so offline changes are visible. Responses use
`private, no-store`; redirects preserve queries and root-relative assets are not
rewritten. Pages execute trusted same-origin code with Hub authority, without the
Hub UI's restrictive CSP; external resources require connectivity/provider permission.
Session Markdown accepts canonical `/web/<id>/` links; copied URLs use browser origin.

### Temporary diffs

Each `diff publish <file>` atomically creates `<hosting>/diffs/<UUID-v4>/` under
the shared lock, containing `raw.diff` and `metadata.json` (identity, title,
creation time, URL). CLI list reads metadata; delete is idempotent and preserves
the source. Diffs have no project/session association or HTTP list endpoint.
Damaged metadata is diagnosed/treated as missing; other filesystem errors propagate.

`/diffs/<uuid>` serves the viewer. `GET /api/v1/diffs/:uuid` returns metadata and
`raw`. `HEAD` checks existence without reading the raw diff, and `DELETE`
returns `204`. Missing diffs and disabled hosting return `404`. Responses use
`private, no-store`, Hub CSP, and text rendering; Markdown links open new tabs.
The viewer supports Git unified diffs, renames, modes, binary markers, and C-quoted
paths; unsupported/incomplete input warns and retains raw-text access.

## Browser state

`ahub.preferences.v1` localStorage synchronizes same-origin preferences;
`ahub.browser-state.v1` sessionStorage holds tab-local browsing. Recovery and drafts
have independent lifecycles. Storage failures preserve in-memory behavior.

### Requests and recovery

Sorting uses best-effort `updatedAt`, retaining newer catalog/reader timestamps
in memory. Projects follow their latest visible session; IDs break ties and
invalid times sort last.

The reader starts at `after=0`, loading up to 300 items per page on scroll.
History and tail waiting share one request slot; unarchived sessions tail at EOF.
Session changes, hiding, or unmount cancel reads; appends preserve reading position.

Management polls one second after query completion. Hidden pages pause reads
while submitted writes continue. Creation tracking ends when the dialog closes.
Retrying a failed submission with the same parameters in the open dialog reuses
the request ID. Other operations recover stored IDs after reload. Terminal
results and `404` clear recovery markers. Nonretryable query errors need manual
retry.

### Interface localization

`ahub.preferences.v1.language` selects `en` (default), `zh-CN`, or `zh-TW` (Taiwan).
Invalid/missing values use English. Changes apply immediately across tabs without
resetting operations, drafts, or conversations. Dates use device time zone;
documentation captures use UTC. Locale affects presentation only; API values,
identities, native diagnostics, conversation/terminal text, paths, and commands
remain unchanged.

[Client i18n](../src/client/i18n/) owns catalogs, interpolation, and formatters.
English defines keys/parameters; Chinese catalogs must match. Missing/empty
translations fall back to English. New languages require catalog registration and
validation tests; no runtime fetch or browser-language detection exists.
Notifications retain keys until rendering; structured API errors use codes,
never English-message matching.

## Multi-node routing and TLS

A standalone Node serves `/api/v1` and optional `/web/` hosting. Single-machine
mode also serves the Web UI. A Hub configured with `--node id=origin` serves
the UI and proxies requests to its Nodes. IDs are case-sensitive and use ASCII
letters, digits, and hyphens. Origins must be HTTP or HTTPS with no credentials,
query, fragment, or path beyond the root.

### Hub routes

| Hub route                                | Behavior                                                                                               |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `GET /api/nodes`                         | Lists Node IDs in configuration order.                                                                 |
| `/api/nodes/<id>/v1/…`                   | Proxies `/api/v1/…` on the Node, including terminal WebSocket upgrades.                                |
| `/nodes/<id>/web/…`                      | Proxies `/web/…` on the Node and rewrites `/web/` redirects under the Node prefix.                     |
| `GET` or `HEAD /nodes/<id>/diffs/<uuid>` | Checks `HEAD /api/v1/diffs/<uuid>` on the Node and uses the resulting status for the Hub viewer route. |
| `/nodes/<id>/…`                          | Scopes the session list, session deep links, upload history, and Pages to the Node.                    |

The Hub root opens the first configured Node. Tabs restore each Node’s last
session list, session, or upload history URL during the current page load.
Drafts and staged attachments survive in-app Node changes within the loaded tab.
Operation IDs, tab-local navigation state, and the default Agent are scoped per
Node. Language and theme are shared.

The Hub streams HTTP bodies and WebSocket traffic. Unknown Nodes return `404`.
Upstream connection failures return `502` and timeouts return `504`. The
35-second response-header deadline starts after the Hub forwards the request
body, allowing the Node's 25-second long poll. Uploads and response streams
have a separate 35-second inactivity limit. Downstream disconnects cancel
upstream requests. The Hub never retries writes.

For proxied API and hosted requests other than `GET` and `HEAD`, and for
WebSocket upgrades, a supplied `Origin` must match the incoming socket protocol
and `Host`. The Hub sends the configured Node's `Host` upstream and strips
`Origin`.

### TLS

Each mode supports the primary `--ssl*` listener and an optional loopback-by-default
HTTP listener via `--local-port` and `--local-host`. With `--ssl-ca`, the primary
listener requires client certificates for its pages, APIs, resources and upgrades.
For HTTPS and WSS upstreams, all Nodes share the Hub's optional
`--node-client-cert` / `--node-client-key` identity. The Hub verifies the Node's
certificate and hostname with Node.js trust roots and any `NODE_EXTRA_CA_CERTS`.
The Node verifies the Hub identity using the Node's own `--ssl-ca`.

Hosted pages run in the Hub origin. Only publish content trusted to access
same-origin APIs for every configured Node. Keep snapshot resource links
relative so assets resolve below the node and snapshot prefix.
