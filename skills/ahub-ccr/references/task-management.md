# Task Lifecycle

Each task represents one coherent goal and may span repositories and execution sessions. A conversation may contain concurrent tasks; never share execution sessions across tasks.

## 1. Create or Recover the Record

Before substantive work, copy [the template](../assets/task/) to `~/.agent-hub/ccr/tasks/<task-id>/`. Resolve `~` against the current user's home directory. Use a UTC timestamp plus a random suffix, such as `20261031T060000Z-a8c41f20`; never overwrite an existing directory.

- `task.yaml` holds current state. Follow its field definitions and use absolute paths for original repositories and workspaces.
- `progress.md` holds append-only decisions, progress, evidence, and corrections with UTC timestamps.
- Optional `artifacts/` holds necessary task-local evidence. Link to other deliverables rather than copying repositories, worktrees, or Hub transcripts. Never record credentials or unnecessary sensitive personal information.

Preserve task history through cleanup, skill updates, and skill removal. Do not migrate records or change their IDs without an explicit migration request.

Record the resolved Hub origin in `hub_url` and reuse it throughout the task. Use `task.yaml.id` as `--task` for every execution session, across repositories.

To recover a task, find its record through `~/.agent-hub/ccr/tasks/*/task.yaml`, read both files, and verify workspaces, branches, and merge states.

On recovery, before retrying an uncertain startup, and before closure, reconcile Hub sessions with the record:

```sh
ahub-cli session list --task <task-id> --json
```

Continue existing sessions before creating replacements. Mark unknown facts and their next verification step; append corrections to history.

## 2. Start Isolated Execution

Use the `ahub-control` skill to manage execution sessions. Omit `--agent` unless the user or project specifies an Agent.

Record the assignment before startup and actual identifiers immediately afterward. Add each workspace once to `workspaces`, and reference it from sessions through `workspace_ids`. Record actual paths and Git state, including the target branch when merging is required; use `null` for unavailable values and note what needs verification.

For repository modifications, create an isolated worktree for the first execution session:

```sh
ahub-cli session create --project <repository-directory> --task <task-id> --worktree --permission-mode auto --json
```

Continue in existing sessions for clarification and corrections. When a later stage requires a separate session, reuse the existing worktree while preserving the original project association:

```sh
ahub-cli session create --project <repository-directory> --task <task-id> --cwd <existing-worktree-directory> --permission-mode auto --json
```

Before authorizing modifications, verify the session's actual working directory and give the agent the isolated path. Follow project branch conventions. If Git isolation is unavailable, mark the task blocked; do not initialize Git without authorization.

For work that does not modify a repository, omit `--worktree` and record the reason and actual working directory. Use merge status `not_required` when no merge applies. Original directories are never task-owned cleanup resources.

## 3. Track, Validate, and Merge

At delegation, startup, status changes, significant decisions, acceptance, merges, and closure, update `task.yaml` and `updated_at`, and append progress to `progress.md`. When scope changes, revise the goal, constraints, and acceptance criteria.

| Task status | Meaning                                             |
| ----------- | --------------------------------------------------- |
| `planned`   | Recorded, not started                               |
| `running`   | Execution, corrections, or fixes in progress        |
| `blocked`   | Cannot proceed; set `blocker` and `next_action`     |
| `reviewing` | Results reported; acceptance or merges in progress  |
| `completed` | Acceptance passed and all required merges completed |
| `cancelled` | User cancelled or terminated the task; record why   |

Any nonterminal state may become `blocked` or `cancelled`. After unblocking, return to the actual stage; after failed acceptance, return to `running`. To reopen a terminal task, record the reason and new acceptance criteria, then return to `running`.

Track session status separately: `reported_done` is an agent report, and `unknown` requires verification before reassignment.

Give acceptance criteria stable IDs and descriptions. Update their status and evidence against the checked commit or artifact version; reverify affected criteria when that version changes. Acceptance requires all criteria to pass across the task's workspaces. Record deliverable locations in `result.deliverables` and validation evidence in `result.validation_evidence`.

Track merge status per workspace:

- `pending`: merge outstanding.
- `merged`: evidence confirms the delivered changes reached the target.
- `not_required`: record the user's instruction or a concrete reason, such as no changes or branch-only delivery.

Follow each project's commit, PR, and merge process. If another repository fails, preserve successful merge evidence; do not claim overall completion or automatically roll back partial merges. Verify merges and cleanup already performed by project automation rather than repeating them.

## 4. Close and Release Resources

On completion or cancellation:

1. Finalize `result` with deliverables, validation, and limitations. Preserve session IDs and workspace information needed for recovery.
2. Reconcile Hub sessions with the record, then run `ahub-cli session exit <id>` for every execution session created for this task. Verify exit before setting `stopped` and `exited_at`; record failures and the next retry. Keep the user conversation and other tasks' sessions intact. Exit sessions before deleting them.
3. Clean up each remaining task-owned worktree and temporary branch once, only when all conditions below hold. Otherwise retain resources and record the reason and next step.

Cleanup requires:

- The entire task succeeded, and all changes were merged or no changes were made. Record evidence of either outcome.
- All sessions referencing the workspace have exited.
- Resources belong to this task and contain no unpreserved uncommitted, untracked, or ignored work.

Never force deletion or remove original repositories or target branches. Update workspace cleanup state separately from delivery status; cleanup failure does not invalidate accepted delivery.
