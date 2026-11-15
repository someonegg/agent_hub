---
status: accepted
date: 2026-11-15
---

# Share runtime observations within each reader response

## Context and Problem Statement

Runtime evaluation and interaction descriptions previously queried liveness
sequentially. In-flight coalescing could not combine them, so a response reconciled
facts from different moments and performed redundant external checks.

## Considered Options

- Keep independent observations and reconcile the results.
- Carry one request-scoped observation through response assembly (chosen).

## Decision Outcome

Reader metadata and message responses, including long-poll probes, share runtime
observation evidence for status and interaction. A common application assembler
reconciles public policy, removes internal facts, and computes the state revision.
Source archive facts, adapter validation, and binding authority retain their owners.

Evidence carries the binding and replacement owner it observed. Ownership changes
during evaluation revoke optimistic results; observation failures never prove
exit. New reads/probes make fresh observations, while concurrent checks may share
in-flight work. Effects always revalidate at execution time rather than reusing
a completed reader observation.

## Consequences

- One response avoids contradictory liveness evidence and redundant serial checks.
- Internal read contracts must carry evidence until assembly without exposing it.
- This is not an atomic filesystem/tmux transaction. Later external changes remain
  possible and are handled by fresh observation or execution-time validation.

## Evidence and Scope

Reconstructed on the date above from legacy [0024](legacy-index.md#adr-0024),
as refined by [0025](legacy-index.md#adr-0025). Old item/update paths are replaced
by messages; their names are not retained as current contracts.
See [reader assembly](../technical-reference.md#conversation-reads),
[binding ownership](0109-retain-binding-ownership-until-explicit-transfer.md), and
[runtime policy](0113-separate-runtime-status-from-resume-permission.md).
