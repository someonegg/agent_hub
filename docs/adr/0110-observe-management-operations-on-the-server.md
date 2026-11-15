---
status: accepted
date: 2026-11-15
---

# Observe management operations on the server

## Context and Problem Statement

CLI completion does not prove that a session was created or its history changed.
Browser lifetime must not control submitted work, and uncertain effects cannot
safely be retried as though they never happened.

## Considered Options

- Wait synchronously for command completion, or track and observe operations on
  the server (chosen).

## Decision Outcome

Enable management and interaction by default within the server's network trust
boundary. Track submitted writes asynchronously, independently of clients.
The coordinator owns idempotency, session occupancy, deadlines, retention, and
cleanup; launch and lifecycle executors invoke owning adapters and confirm source
or runtime evidence. Reading operation status never advances execution.

Coalesce identical requests and reject conflicting session work. Use bounded,
process-local tracking rather than durable execution recovery. Do not retry
uncertain external effects. Unknown launches retain known targets and attach
information, then release occupancy; a new request ID may launch again if normal
checks pass, even when the earlier launch may still run.

## Consequences

- Submitted work survives page reloads; success reflects observed effects.
- Starting the server exposes write/delete authority that deployments must protect.
- Restart loses tracking without stopping tmux. Timeouts can require manual
  reconciliation, and a new launch request can duplicate an uncertain launch.
- Successful partial source snapshots can confirm absence despite skipped files;
  thrown reads cannot prove absence.

## Evidence and Scope

Reconstructed on the date above from legacy [0016](legacy-index.md#adr-0016),
[0017](legacy-index.md#adr-0017), and [0023](legacy-index.md#adr-0023).
Defaults are the operating context for the asynchronous management choice.
No new operation or retry policy is introduced. See
[management contracts](../technical-reference.md#asynchronous-management),
[launch](0111-separate-launch-directory-from-project-association.md), and
[exit](0112-separate-exit-from-history-management.md).
