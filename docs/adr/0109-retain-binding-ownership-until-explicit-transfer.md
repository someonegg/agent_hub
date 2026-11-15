---
status: accepted
date: 2026-11-15
---

# Retain binding ownership until explicit transfer

## Context and Problem Statement

Rollouts can claim the same tmux target. Removing or archiving a newer owner must
not accidentally restore an older session's control. A remembered successful
connection also cannot establish that a target is still available.

## Decision Outcome

Use one process-wide binding authority across agents. A later valid claim revokes
the former owner's control; retain claims for the process lifetime through
archive, deletion, and rereads. Explicit later bindings can reclaim ownership.
An invalid latest binding attempt does not fall back to an earlier valid attempt.

Adapters parse native binding records; generic transport validates socket
ownership and current tmux session liveness, serializes input, and captures
previews. Deliberate socket/session reuse is allowed without process-identity
inference. Share in-flight checks, never completed validation results. Ownership
changes during observation fail closed; queued effects revalidate before execution.

## Consequences

- Historical rereads cannot silently resurrect stale authority.
- Fresh checks permit recovery after transient disconnection but add tmux queries.
- Bindings grant control of the entire target tmux session, including manual
  binds; they are not proof of the CLI process inside it.
- Authority is process-local and reconstructed after restart. Uncertain effects
  are not automatically resent.

## Evidence and Scope

Reconstructed on the date above from legacy [0007](legacy-index.md#adr-0007),
[0018](legacy-index.md#adr-0018), and the
[named-session binding change](https://github.com/someonegg/agent_hub/commit/82d2ec11d621bf828e46cd23f5db6393a8b99bd2).
The records establish the policy and rejection of permanent caching and
process-identity inference, but not a complete historical options matrix.
See [binding contracts](../technical-reference.md#binding-format-and-ownership),
[runtime policy](0113-separate-runtime-status-from-resume-permission.md), and
[exit control](0112-separate-exit-from-history-management.md).
