---
status: accepted
date: 2026-11-15
---

# Separate exit from history management

## Context and Problem Statement

Exiting a running session should not require archiving its history. Native CLI
shutdown semantics belong to adapters, while transport can observe tmux liveness
without identifying the process inside a shell.

## Considered Options

- Keep a generic interrupt/EOF sequence embedded in transport.
- Detect CLI process exit before separately closing the shell.
- Use adapter steps and bounded shutdown of the bound target (chosen).

## Decision Outcome

Provide an independent asynchronous Exit operation. Archive and delete reuse its
validation and shutdown sequence before changing history. The owning adapter
supplies CLI steps; the common exit service observes liveness, sends EOF, and can
issue one targeted `kill-session` after a grace period. Confirm target absence
before reporting success.

Binding transfers control of the entire tmux session, not just a pane or a detected
CLI process. Check ownership, cancellation, and operation activity before effects;
natural exit stops further sends. Query errors do not prove exit, and uncertain
effects are not retried. Exit itself preserves session history.

## Consequences

- Exit is reusable and runtime-specific keys stay out of generic transport.
- Interrupts and EOF can reach an outer shell. Forced shutdown can interrupt
  cleanup or other work in a manually bound tmux session.
- Grace periods bound waiting; they do not establish graceful CLI termination.

## Evidence and Scope

Reconstructed on the date above from legacy [0022](legacy-index.md#adr-0022),
the [named-session change](https://github.com/someonegg/agent_hub/commit/82d2ec11d621bf828e46cd23f5db6393a8b99bd2),
and [aligned exit steps](https://github.com/someonegg/agent_hub/commit/b19e6cdcbe8ac5b42d03c72aa064b6b39b483a39).
Legacy 0022's statement that no `kill-session` occurs contradicts its own outcome
and current implementation; that statement is not carried forward. Exact key
timings live in [execution contracts](../technical-reference.md#execution-and-confirmation).
This reconstruction changes neither the shutdown sequence nor its control scope.
