---
status: accepted
date: 2026-11-14
---

# Filter non-primary rollouts in adapters

## Context and Problem Statement

The hub catalogs independently usable sessions. Codex stores subagent rollouts in
its session roots, while Claude stores auxiliary records and files alongside
conversations. Native provenance belongs to the owning adapter rather than the
shared session model, repository, API, browser, or CLI.

## Considered Options

- Publish parent/child identities and relationships through shared layers.
- Filter non-primary rollouts inside adapters before publishing sessions.

## Decision Outcome

Adapters publish independent sessions without subagent identity or parent/child
relationship fields. Keep session-level task associations. Claude continues to
filter native auxiliary records and clean up associated files on deletion.

Before fully decoding a new Codex rollout, read at most 64 KiB and structurally
parse only complete JSONL lines. A valid `session_meta.payload` identifies a
non-primary rollout through non-empty `parent_thread_id` or `parent_id`, or an
explicit `source.subagent` marker. Use the existing filename-matching, then first
metadata identity selection. Decide from the head only when that selection is
conclusive; otherwise fully decode and apply the same selection before
normalization or binding extraction. Files without a selected exclusion marker
remain ordinary sessions. I/O failures retain diagnostics and retry behavior.
Probe reads contribute to source I/O telemetry.

Keep an in-memory exclusion cache by source-relative path, distinguishing
non-primary rollouts from duplicate native identities. Preserve first selection
and previously accepted path precedence. Once excluded, do not open a path again
because its size or modification time changes, or because the accepted original
disappears. Remove an exclusion only when discovery observes the path absent.
Reconstructing the source starts with an empty cache; exclusions are not persisted
and contain neither conversation data nor normalized sessions. Ordinary sessions
retain fingerprints, checkpoints, and incremental decoding.

## Consequences

- Shared services and clients operate on one independent-session model.
- Large non-primary rollouts with conclusive head metadata need only a bounded read.
- Unusual layouts can require a complete decode before filtering.
- A process restart repeats identification.
- Replacing a file at a continuously present excluded path does not admit it.
- A duplicate remains excluded after its accepted original disappears; observing
  its own path disappear or creating a new source permits identification again.
