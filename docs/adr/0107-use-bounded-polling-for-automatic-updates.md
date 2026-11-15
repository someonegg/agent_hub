---
status: accepted
date: 2026-11-15
---

# Use bounded polling for automatic updates

## Context and Problem Statement

An interactive reader needs new messages and runtime changes without manual
refresh. Filesystem changes still need adapter normalization and coherent
repository publication before they can become public updates.

## Considered Options

- Fixed-interval browser polling.
- Repository-probed bounded HTTP long polling (chosen).
- Server-Sent Events, WebSockets, or direct filesystem watcher notifications.
- A tab-scoped automatic-update preference, or default automatic updates (chosen).

## Decision Outcome

Enable automatic updates for unarchived sessions without a stored toggle. Use
bounded repository probes through the messages endpoint: return backlog
immediately, otherwise wait for messages or public state changes. Public state
revisions exclude `updatedAt`; timestamps alone do not wake reader waits.

Bound duration and waiter capacity, share eligible concurrent probes, and cancel
on disconnect, shutdown, hidden pages, or reader replacement. Web serializes
history paging and tail waiting so appends preserve reading position. Transient
failures use bounded retry backoff. Catalog polling has its own revision scope.

## Consequences

- Ordinary HTTP supports automatic updates without a subscription transport.
- Open readers hold connections and generate periodic server probes.
- Cancellation, capacity handling, retries, and stale-response handling remain
  necessary; this is not event-driven, immediate change notification.

## Evidence and Scope

Reconstructed on the date above from legacy [0011](legacy-index.md#adr-0011),
[0014](legacy-index.md#adr-0014), [0019](legacy-index.md#adr-0019), and
[0025](legacy-index.md#adr-0025), plus the
[timestamp revision change](https://github.com/someonegg/agent_hub/commit/8c79416b5dd02065b83172196d2f08dabdd15190).
This records existing policy; the old separate update endpoint and completed
connection-result cache do not survive. See
[reader limits](../technical-reference.md#reader-and-automatic-updates) and
[catalog polling](0104-long-poll-complete-catalog-structure.md).
