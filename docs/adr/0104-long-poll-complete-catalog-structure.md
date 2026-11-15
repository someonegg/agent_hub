---
status: accepted
date: 2026-11-15
---

# Long-poll complete catalog structure with advisory timestamps

## Context and Problem Statement

Paginated catalog refresh repeatedly transfers summaries and complicates complete
project counts. A separate activity endpoint adds another request lifecycle just
to keep ordering timestamps current.

## Considered Options

- Periodically refresh filtered, paginated summaries.
- Long-poll structure and fetch activity separately.
- Long-poll complete structure with best-effort timestamps (chosen).

## Decision Outcome

Return complete Agent, project, and session snapshots. Structural revisions cover
public identity, titles, associations, capabilities, and runtime status, excluding
timestamps, conversation content, and diagnostics. A matching revision waits for
structural change using bounded shared probes.

Clients filter and group locally. Timestamps arrive with snapshots or reader
feedback; the browser retains newer valid observations and sorts locally. There
is no independent timestamp endpoint, refresh timer, or persistent activity cache.

## Consequences

- Counts and filtering use the complete catalog; conversation appends do not
  retransmit unchanged structure.
- Initial transfer and browser memory scale with the whole catalog.
- Unopened sessions may have stale ordering times. Keeping newer observations
  can hide backwards source corrections until reload.

## Evidence and Scope

Reconstructed on the date above from legacy [0021](legacy-index.md#adr-0021),
which replaced [0005](legacy-index.md#adr-0005), [0010](legacy-index.md#adr-0010),
and the paginated context of [0013](legacy-index.md#adr-0013).
See the [current catalog contract](../technical-reference.md#catalog) and
[title policy](0105-resolve-display-titles-on-the-server.md).
No list pagination or activity channel is reintroduced.
