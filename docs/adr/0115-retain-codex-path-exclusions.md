---
status: accepted
date: 2026-11-15
---

# Retain Codex path exclusions until disappearance

## Context and Problem Statement

Repeatedly decoding excluded subagent rollouts wastes work as those files grow.
Duplicate native identities also require stable selection rather than switching
between competing paths on each refresh.

## Decision Outcome

Within the Codex adapter, cache confirmed auxiliary-rollout and duplicate-identity
exclusions by source-relative path. Preserve accepted-path precedence. A path
remains excluded despite size/mtime changes or disappearance of the accepted
original. Clear its exclusion only when discovery observes that path absent or
the source is reconstructed. Keep this cache process-local and free of conversation
content.

Identify conclusive auxiliary rollouts from bounded head decoding before
normalization or binding extraction. When identity selection is inconclusive,
continue decoding to apply the same selection rules. Ordinary sessions retain
their normal incremental caches.

## Consequences

- Large excluded rollouts avoid repeated decoding; duplicate selection remains
  stable rather than following incidental file changes.
- Replacing a continuously present excluded path does not admit its new content.
- A duplicate stays excluded after its accepted original disappears. Its own
  observed disappearance or source reconstruction is required to reconsider it.
- Restart repeats identification; unusual layouts can require a full initial read.

## Evidence and Scope

Reconstructed on the date above from legacy [0026](legacy-index.md#adr-0026).
The original records specify this cache policy and costs, but do not document
a separate comparison of cache invalidation alternatives; none is claimed here.
This is Codex-specific and does not impose sticky exclusions on other adapters.
See [filtering boundary](0101-use-source-owned-session-adapters.md) and
[decoder/cache details](../technical-reference.md#discovery-and-caching).
