---
status: accepted
date: 2026-11-15
---

# Separate launch working directory from project association

## Context and Problem Statement

A session may execute outside its associated project, especially in worktrees.
Conflating the launch directory with association moves sessions between projects
or makes resume depend on an unrelated client-selected directory.

## Decision Outcome

Create and resume are modes of one launch operation. Worktree and permission mode
are launch options, not independent operations. Identity validation, directory
resolution, and exit steps remain supporting adapter contracts.

Creation defaults the working directory to the selected project directory but
accepts another explicit working directory while retaining project association.
Validate both through the owning adapter; do not impose a Git relationship.

Resume resolves the original session's available working directory, falling back
to its project directory for missing/non-directory paths, and retains the original
project association, including worktree sessions. Reject client overrides of
Agent, project, working directory, and worktree on resume. Confirm launch identity,
operation marker, target, and association through the owning adapter.

## Consequences

- Execution location can vary without changing navigation or project grouping.
- Both directories participate in creation idempotency and confirmation logic.
- An unavailable original directory can prevent resume; permission and unexpected
  errors are not silently converted into a different launch location.

## Evidence and Scope

Reconstructed on the date above from legacy [0017](legacy-index.md#adr-0017),
[0023](legacy-index.md#adr-0023), repository adapter-boundary rules, and the
[directory separation change](https://github.com/someonegg/agent_hub/commit/7d6ac832e9baca796d6ac4167d95776e2ff099c5).
The evidence establishes the current boundary but does not preserve a complete
historical comparison of directory policies. No new launch behavior is proposed.
See [execution contracts](../technical-reference.md#execution-and-confirmation)
and [runtime permission](0113-separate-runtime-status-from-resume-permission.md).
