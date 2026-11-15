---
status: accepted
date: 2026-11-15
---

# Resolve display titles on the server

## Context and Problem Statement

Codex stores thread names separately from authoritative rollout content. Clients
need consistent titles, and title edits should become visible without creating
sessions or modifying conversation history.

## Considered Options

- Merge advisory names into normalized source sessions.
- Expose a separate nickname and resolve precedence in every client.
- Resolve advisory titles at the server API boundary (chosen).

## Decision Outcome

The owning adapter reads its advisory title index. Server mapping prefers a valid
advisory name and otherwise uses the rollout-derived title. All catalog and reader
responses expose the resolved title consistently.

Title changes participate in catalog and reader state revisions. The index is
best effort and cannot create sessions or establish native identity. Its refresh
does not require a filesystem watcher.

## Consequences

- Web and CLI share one title policy; an open reader can observe title-only changes.
- Bad or missing advisory data falls back to the authoritative session title.
- Advisory edits now wake subscribers, accepting work that the original nickname
  design deliberately avoided.
- The API no longer supplies the historical separate session nickname field.

## Evidence and Scope

Reconstructed on the date above from legacy [0015](legacy-index.md#adr-0015)
and the [server title unification](https://github.com/someonegg/agent_hub/commit/463339c3cd5fc7a135466af537ccdfe359d83ba1).
The original choice was client-side nickname precedence with nickname excluded
from update revisions; that choice was subsequently reversed. This record
consolidates the implemented successor, without changing behavior.
See [catalog titles](../technical-reference.md#catalog) and
[reader revisions](../technical-reference.md#conversation-reads).
