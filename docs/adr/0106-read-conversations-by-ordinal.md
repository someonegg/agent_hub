---
status: accepted
date: 2026-11-15
---

# Read conversations by ordinal

## Context and Problem Statement

Web's signed cursors, prefix indexes, event inspection, and lazy details duplicated
CLI conversation reading and required substantial consistency machinery.

## Considered Options

- Retain event inspection and parallel Web/CLI read protocols.
- Share ordinal conversation pages (chosen).
- Add history generations or content fingerprints to ordinal pages.

## Decision Outcome

Use one messages endpoint for Web and CLI, publishing conversation messages and
user-input requests/responses. Preserve original ordinal gaps and return the next
consumed boundary. Web begins at zero; CLI can begin with the latest messages.

Remove signed timeline cursors, prefix validation, tool/directive/internal detail
APIs, and the separate update endpoint without compatibility support. Runtime
parsing for bindings and identity remains internal. An out-of-range ordinal
triggers one reload from zero; other historical rewrites are not automatically
detected. State revisions describe public state, not message-history integrity.

## Consequences

- Web and CLI share a bounded read protocol and compact conversation model.
- Appends continue without historical-prefix authentication or migration.
- Advanced event inspection and old API consumers are unsupported.
- Rewrites keeping ordinals in range may leave loaded history stale until reload.

## Evidence and Scope

Reconstructed on the date above from legacy [0025](legacy-index.md#adr-0025).
The retired chain [0004](legacy-index.md#adr-0004),
[0006](legacy-index.md#adr-0006), and [0009](legacy-index.md#adr-0009)
explains the stronger continuity guarantee intentionally given up.
See [reader contracts](../technical-reference.md#conversation-reads),
[incremental loading](0102-use-immutable-incremental-session-snapshots.md), and
[automatic updates](0107-use-bounded-polling-for-automatic-updates.md).
