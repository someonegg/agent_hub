---
status: accepted
date: 2026-11-15
---

# Use immutable incremental session snapshots

## Context and Problem Statement

Active JSONL sessions grow through small appends. Whole-file rereads make refresh
cost grow with history, while mutable caches can expose inconsistent reads.

## Considered Options

- Reread and normalize the entire changed file.
- Validate the complete historical prefix before incremental decoding.
- Validate bounded probes and incrementally derive appended records (chosen).

## Decision Outcome

Keep process-local decoder checkpoints and validate bounded regions at the start
and previous end of a growing file. Decode complete appended records, retaining
unfinished tails. Rebuild when truncation, replacement evidence, parser changes,
or uncertain derivation prevent safe reuse.

Publish immutable source values and aggregate snapshots through serialized,
coalesced refresh. Reference reuse is an optimization, not a requirement.
Binding events are published only after successful aggregate publication.
Successfully loaded archives reuse cached content until restart or restoration;
discovery, removals, advisory titles, and failed-load retries continue.

## Consequences

- Ordinary append I/O avoids scanning the entire historical prefix.
- Earlier snapshots remain coherent while sources advance.
- Bounded probes are heuristic: a middle rewrite preserving the probes and then
  appending can escape detection. This is not a historical-content proof.
- Loaded archived content may remain stale after in-place edits.
- Checkpoints add recovery complexity; restart requires rebuilding caches.

## Evidence and Scope

Reconstructed on the date above from legacy
[0001](legacy-index.md#adr-0001) and [0012](legacy-index.md#adr-0012), including
their later archive-cache scope notes. No runtime behavior changes.
See [cache contracts](../technical-reference.md#discovery-and-caching) and
[ordinal reading](0106-read-conversations-by-ordinal.md); snapshot publication
does not restore the retired signed-prefix reader guarantee.
