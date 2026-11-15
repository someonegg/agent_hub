---
status: accepted
date: 2026-11-15
---

# Separate Agent identity from Runtime

## Context and Problem Statement

Multiple configured agents can use the same runtime and have overlapping native
session IDs. Public names should be useful for routing without exposing private
configuration paths or changing session URLs when a nickname changes.

## Decision Outcome

An Agent owns configuration, Skills, memory, and model settings; Codex and Claude
Code are Runtimes. Route public requests by configured Agent nickname. Namespace
Hub session IDs by private source instance key and source-local identity.

Configured absolute paths provide the private namespace. Renaming or reordering
agents preserves session IDs; moving their configuration changes the namespace.
Management uses the owning Agent's runtime executable and environment. Projects
merge by directory across agents rather than by runtime or nickname.

## Consequences

- Native identities from separate agents do not collide, and public origins can
  describe both Agent and Runtime without revealing configuration paths.
- Agent moves change session IDs and invalidate old URLs.
- Routing configuration and private identity must remain distinct.

## Evidence and Scope

Reconstructed on the date above from legacy [0003](legacy-index.md#adr-0003),
the [terminology change](https://github.com/someonegg/agent_hub/commit/a3af3c553d675d5ccde7112e61797583d9444108),
and current [Agent routing](../technical-reference.md#agent-identity-and-routing).
The surviving material establishes the implemented choice but not a complete
historical comparison of naming and namespace alternatives; none is invented here.
No new identity migration is introduced.
