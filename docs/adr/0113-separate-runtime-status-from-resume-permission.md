---
status: accepted
date: 2026-11-15
---

# Separate runtime status from resume permission

## Context and Problem Statement

Archive state does not establish whether a session is running. Disconnection can
mean malformed binding or failed observation rather than confirmed target death;
using it as launch permission can duplicate a running session.

## Considered Options

- Infer resume permission from disconnected interaction state.
- Evaluate runtime status and resume capability from explicit evidence (chosen).

## Decision Outcome

Expose `normal`, `live`, and `archived` separately from interaction state and resume
capability. Archive wins; Live requires an observed living, owned tmux session.
Normal alone never authorizes resume.

Resume requires an unarchived session with a unique adapter-valid native identity
and usable original directory, plus no binding, confirmed target exit, or explicit
ownership transfer. Invalid bindings and unknown checks deny resume. Unbound
resume is permitted with a reminder that users must establish original process
exit themselves. Launch occupies the session before asynchronous validation.

## Consequences

- Connection presentation does not accidentally become permission to launch.
- Unbound resume accepts a duplicate-process risk the Hub cannot eliminate.
- Runtime probes add tmux work even when files do not change; failures revoke
  optimistic Live and Resume rather than preserving stale permission.

## Evidence and Scope

Reconstructed on the date above from legacy [0023](legacy-index.md#adr-0023),
including its unbound-resume refinement. Unknown launch retry semantics belong to
[operation tracking](0110-observe-management-operations-on-the-server.md), not a
separate resume reservation. No permission is broadened by this rewrite.
See [catalog status](../technical-reference.md#catalog),
[execution checks](../technical-reference.md#execution-and-confirmation), and
[shared observations](0114-share-runtime-observations-per-reader-response.md).
