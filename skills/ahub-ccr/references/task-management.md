# Task Lifecycle

This lifecycle defines task records, execution, acceptance, and cleanup for goals managed through ahub-ccr.

## 1. Record or Recover

Each task represents one coherent goal and may span repositories and execution sessions. A conversation may contain multiple tasks. Tasks may run concurrently. Never reuse execution sessions across tasks.

Before starting substantive work, copy [the template](../assets/task/) to a new `~/.agent-hub/ccr/tasks/<task-id>/` directory. Resolve `~` against the current user’s home directory, never against the skill installation or current repository. Use a UTC timestamp plus a random suffix, such as `20261031T060000Z-a8c41f20`. Never overwrite an existing directory.

- `task.yaml`: current goal, constraints, acceptance criteria, absolute original repository paths, workspaces, execution sessions, status, and next action.
- `progress.md`: append-only decisions, progress, evidence, and corrections, with UTC timestamps.

Keep completed records for recovery; ordinary cleanup removes execution resources, not task history. Skill updates and removal must not delete task data. Do not migrate existing records or change their IDs without an explicit migration request.

Find tasks through `~/.agent-hub/ccr/tasks/*/task.yaml`; automatic commits and a shared index are unnecessary. Only the owning orchestration session may write records. Record its session ID in `owner_session_id`; if unavailable, use `null` and record the ownership context and limitation in `progress.md`. Verify ownership and record a transfer before resuming elsewhere; do not write concurrently.

Store necessary task-local evidence in an optional `artifacts/` directory. Record other deliverables by location instead of copying repositories, worktrees, or Hub transcripts into task storage. Never record credentials or unnecessary sensitive personal information.

Record the resolved Hub origin in `hub_url` and use it consistently, including during recovery.

Use `task.yaml.id` as the stable Hub task name (`--task`) for every execution session in this task, across repositories.

Update records and `updated_at` at delegation, startup, status changes, significant decisions, acceptance, merges, and closure:

- Record delegation intent before startup and actual identifiers immediately afterward.
- Use `null` for unavailable identifiers and state what needs verification.

When scope changes, update the goal, constraints, and acceptance criteria. Give each criterion a stable ID and description; update its status and evidence as results arrive, including the checked commit or artifact version. Record deliverable locations in `result.deliverables` and validation evidence; finalize them at acceptance or closure.

On recovery:

1. Read both files and verify sessions, worktrees, branches, and merge states.
2. Query `ahub-cli session list --task <task-id> --json`, reconcile sessions with local records, and continue existing sessions before creating replacements.
3. Mark unknown facts and the next verification step. Append corrections; do not delete history.

## 2. Start Isolated Execution

Use the `ahub-control` skill to create execution sessions. Omit `--agent` unless the user or project specifies an Agent.

For repository modifications, create an isolated worktree for the first execution session:

```sh
ahub-cli session create --project <repository-directory> --task <task-id> --worktree --permission-mode auto --json
```

Later stages use separate sessions in the same worktree. Keep the original project association and pass the existing worktree as the working directory:

```sh
ahub-cli session create --project <repository-directory> --task <task-id> --cwd <existing-worktree-directory> --permission-mode auto --json
```

Before authorizing modifications, verify the session's actual working directory and give the agent the isolated path. Follow the project's branch conventions; if Git isolation is unavailable, mark the task blocked. Do not initialize Git without authorization.

After startup, record the workspace and session:

- Add each workspace once to task-level `workspaces`, with a stable task-local `id`, `project_id`, `working_directory`, branch, and HEAD. For detached HEAD, set branch to `null`. Record the actual target branch when merging is required.
- Add each session to `execution_sessions`, using `workspace_ids` to reference existing workspace records.
- If startup has an uncertain result, query sessions by `--task` and reconcile the records before retrying.

For work that does not modify a repository, omit `--worktree`. Record the reason and actual working directory, set unavailable Git fields to `null`, and use merge status `not_required` when no merge applies. Exclude the original directory from task-owned cleanup resources.

## 3. Track and Accept

| Task status | Meaning                                             |
| ----------- | --------------------------------------------------- |
| `planned`   | Recorded, not started                               |
| `running`   | Execution, corrections, or fixes in progress        |
| `blocked`   | Cannot proceed; set `blocker` and `next_action`     |
| `reviewing` | Results reported; acceptance or merges in progress  |
| `completed` | Acceptance passed and all required merges completed |
| `cancelled` | User cancelled or terminated the task; record why   |

Normal flow: `planned` → `running` → `reviewing` → `completed`.

- Any nonterminal state may become `blocked` or `cancelled`.
- After unblocking, return to the actual stage. After failed acceptance, return to `running`.
- To reopen a terminal task, record the reason and new acceptance criteria, then return to `running`.

Track session status separately. `reported_done` is an agent report; `unknown` requires verification before reassignment.

Acceptance passes only when all criteria pass across the task-level workspaces. Reverify affected criteria when the checked commit or artifact version changes.

Update each workspace’s merge and cleanup state as sessions report changes. Merge status:

- `pending`: merge outstanding.
- `merged`: record evidence that the delivered changes reached the target.
- `not_required`: record the user's instruction or a concrete reason, such as no changes or branch-only delivery.

Follow each project's commit, PR, and merge process. If another repository fails, preserve successful merge evidence; do not claim overall completion or automatically roll back partial merges.

## 4. Close and Clean Up

On completion or cancellation:

1. Save `result`, deliverables, validation, limitations, session IDs, and workspace recovery information.
2. Query sessions by `--task` and reconcile local records. Run `ahub-cli session exit <id>` for every execution session created for this task. Verify exit, set session status to `stopped`, and record `exited_at`. Record failures and the retry needed.
3. Clean up remaining worktrees and temporary branches only after the entire task succeeds with all changes merged or no changes made. Process each task-level workspace once, after all sessions referencing it have exited, and update its cleanup state. Otherwise retain them and record the reason and next step.

Exit only execution sessions created for this task, keeping the user conversation and other tasks' sessions intact. Exit sessions before deleting them.

Before cleanup, verify:

- Sessions have exited.
- Merge evidence is recorded.
- Resources belong to this task.
- No unpreserved uncommitted, untracked, or ignored work remains.

If verification fails, retain resources; do not force deletion. Never remove original repositories or target branches.

Respect project automation: verify completed merges and cleanup without repeating them. Record delivery and cleanup outcomes separately, preserving accepted delivery status if cleanup fails.
