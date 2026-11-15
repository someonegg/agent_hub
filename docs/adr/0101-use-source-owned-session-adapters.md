---
status: accepted
date: 2026-11-15
---

# Use source-owned session adapters

## Context and Problem Statement

Native session layouts, records, and lifecycle commands evolve independently.
Sharing their parsing or identity conventions would couple the repository and
management services to a particular runtime.

## Decision Outcome

Adapters discover native files and publish normalized, immutable sessions with
nonempty native identities. Native identities are opaque to shared services;
the owning adapter validates their format for management, using the same rules
in preflight and execution. Adapters also own native commands, directory
resolution, binding syntax, and exit steps.

Codex discovers sessions from rollout JSONL rather than SQLite. Advisory title
indexes cannot create sessions. Adapters filter native auxiliary/subagent data
before publication; shared services expose independent sessions without a
parent/child session model. Task association remains session metadata.

## Considered Options

- Repository-owned discovery and parsing, or a shared raw-event decoder model.
- High-level adapters publishing normalized sessions (chosen).
- For Codex discovery, retain SQLite enrichment, disable it by default, or remove
  it (chosen).
- Publish parent/child relationships through shared layers, or filter auxiliary
  rollouts in adapters (chosen).

## Consequences

- Runtime compatibility stays behind one boundary; new adapters do not require
  shared code to learn native schemas, UUID rules, or CLI arguments.
- Removing SQLite gives up database-only sessions and metadata.
- Adapters carry substantial normalization and recovery responsibilities.
  Identity mistakes can destabilize Hub IDs; incomplete source reads can omit
  sessions even when refresh succeeds.
- Auxiliary sessions are intentionally unavailable through the shared model.

## Evidence and Scope

Reconstructed on the date above from legacy
[0002](legacy-index.md#adr-0002), [0003](legacy-index.md#adr-0003),
[0026](legacy-index.md#adr-0026), and the
[adapter identity change](https://github.com/someonegg/agent_hub/commit/979205c5452a01ad2630f3108701f81e58815f4f).
This records existing behavior, not a new acceptance date for the original choices.
See [source contracts](../technical-reference.md#sources-and-identity),
[publication](0102-use-immutable-incremental-session-snapshots.md), and
[exclusion caching](0115-retain-codex-path-exclusions.md).
