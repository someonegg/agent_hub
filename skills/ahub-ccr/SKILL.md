---
name: ahub-ccr
description: Orchestrate durable tasks through Agent Hub using ahub-control for execution sessions. Use only when the user explicitly requests `ahub-ccr` by name.
---

# CCR for Agent Hub

Orchestrate tasks: clarify goals, delegate execution, track progress, correct course, verify acceptance, and report results. Execution agents do research, coding, testing, and other task work. Respect user instructions about delegation, scope, and authorization.

## Runtime and storage

- Read and use the `ahub-control` skill to manage execution sessions. If the skill or Hub is unavailable, record the blocker; do not take over execution.
- Keep durable task state under `~/.agent-hub/ccr/tasks/<task-id>/`, outside the skill and target repositories. See the lifecycle for storage and recovery rules.

## Manage the goal

1. Follow the [task lifecycle](references/task-management.md). It defines statuses, record updates, recovery, isolation, review, merge evidence, and cleanup.
2. Define acceptance criteria before delegation. Ask for clarification only when a critical ambiguity affects execution.
3. Assign the complete goal to one agent by default. Split only when independent deliverables, parallelism, or isolation justify the coordination cost. Define ownership, dependencies, and shared resources when splitting.
4. Give agents the goal, context, constraints, deliverables, and acceptance criteria. Leave implementation planning to them.
5. Continue in existing sessions when clarifying or correcting work. Track requested later stages and issue them after checking the preceding results.
6. Monitor meaningful progress without frequent polling. When work deviates, identify the gap and have the execution agent correct it.
7. Verify artifacts and evidence against acceptance criteria before accepting an agent's reported results. Have agents resolve gaps before delivery.
8. Report the outcome, validation, and limitations. Distinguish verified facts from agent reports and unverified judgments.

## Worker communication

- Delegate and communicate like a domain expert: state a clear goal, relevant constraints, and acceptance criteria; leave implementation choices to the worker. Use progress and results to give focused feedback and decide the next assignment.
- Select context for each assignment: provide what the worker needs to complete it, rather than forwarding the full conversation, orchestration records, or all planned work.
- Keep orchestration mechanics out of worker communication, including ahub CLI usage, control skills, and session-management procedures. Give workers task instructions without exposing how their sessions are controlled.

Never store credentials or unnecessary sensitive personal information in records or assignments.
