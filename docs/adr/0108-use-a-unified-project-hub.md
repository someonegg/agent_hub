---
status: accepted
date: 2026-11-15
---

# Use a unified project hub

## Context and Problem Statement

Separate catalog and reader documents isolated their lifecycles but split project
navigation, conversation reading, and management across pages.

## Considered Options

- Separate catalog and reader entries in a multi-page application.
- One HTML/React entry with History API navigation (chosen).

## Decision Outcome

Keep project/session navigation beside the reader in one application. Serve root
and direct session URLs through the same entry. History API navigation supports
refresh and back/forward without a routing dependency. Keep the catalog mounted
while reader work follows the selected session.

Restore tab-local navigation state and show unarchived sessions by default.
Archive filtering is a client concern; archived sessions remain directly
accessible. Keep catalog and reader cancellation independent.

## Consequences

- Reading and management retain project context across session selection.
- Responsive layout and direct links share one application lifecycle.
- URL/selection synchronization, independent failures, and navigation restoration
  become application responsibilities rather than document boundaries.

## Evidence and Scope

Reconstructed on the date above from legacy [0020](legacy-index.md#adr-0020),
which replaced the MPA choice in [0008](legacy-index.md#adr-0008) and the
paginated filtering workflow in [0013](legacy-index.md#adr-0013).
No navigation or storage migration is introduced. Current storage fields and
responsive behavior belong to [usage](../usage.md#read-conversations) and
[browser state](../technical-reference.md#browser-state).
