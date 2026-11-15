# Architecture decisions

ADRs explain the choices and accepted costs behind the current architecture.
Use the [technical reference](../technical-reference.md) for schemas, protocols,
limits, and exact runtime behavior.

## Reading paths

| Question                                                               | Start here                                                            |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Who owns native formats, identities, and auxiliary-session filtering?  | [ADR-101](0101-use-source-owned-session-adapters.md)                  |
| Why use bounded probes rather than reread or authenticate all history? | [ADR-102](0102-use-immutable-incremental-session-snapshots.md)        |
| How do Agent names differ from Runtime and session identity?           | [ADR-103](0103-separate-agent-identity-from-runtime.md)               |
| Why send a complete catalog but allow stale ordering times?            | [ADR-104](0104-long-poll-complete-catalog-structure.md)               |
| Why do advisory title edits wake clients?                              | [ADR-105](0105-resolve-display-titles-on-the-server.md)               |
| Why can some historical message rewrites remain undetected?            | [ADR-106](0106-read-conversations-by-ordinal.md)                      |
| Why use automatic HTTP long polling?                                   | [ADR-107](0107-use-bounded-polling-for-automatic-updates.md)          |
| Why keep navigation and reading in one application?                    | [ADR-108](0108-use-a-unified-project-hub.md)                          |
| Why cannot old bindings regain control after deletion or rereads?      | [ADR-109](0109-retain-binding-ownership-until-explicit-transfer.md)   |
| Why can a submitted operation finish unknown?                          | [ADR-110](0110-observe-management-operations-on-the-server.md)        |
| Why can launch location differ from project association?               | [ADR-111](0111-separate-launch-directory-from-project-association.md) |
| Why can Exit close an entire tmux session?                             | [ADR-112](0112-separate-exit-from-history-management.md)              |
| Why does Normal or disconnected not authorize Resume?                  | [ADR-113](0113-separate-runtime-status-from-resume-permission.md)     |
| Why share runtime evidence within a reader response?                   | [ADR-114](0114-share-runtime-observations-per-reader-response.md)     |
| Why can a replaced excluded Codex file remain hidden?                  | [ADR-115](0115-retain-codex-path-exclusions.md)                       |

## Decision index

| Decision                                                                                                                          | Status   |
| --------------------------------------------------------------------------------------------------------------------------------- | -------- |
| [ADR-101: Use source-owned session adapters](0101-use-source-owned-session-adapters.md)                                           | accepted |
| [ADR-102: Use immutable incremental session snapshots](0102-use-immutable-incremental-session-snapshots.md)                       | accepted |
| [ADR-103: Separate Agent identity from Runtime](0103-separate-agent-identity-from-runtime.md)                                     | accepted |
| [ADR-104: Long-poll complete catalog structure with advisory timestamps](0104-long-poll-complete-catalog-structure.md)            | accepted |
| [ADR-105: Resolve display titles on the server](0105-resolve-display-titles-on-the-server.md)                                     | accepted |
| [ADR-106: Read conversations by ordinal](0106-read-conversations-by-ordinal.md)                                                   | accepted |
| [ADR-107: Use bounded polling for automatic updates](0107-use-bounded-polling-for-automatic-updates.md)                           | accepted |
| [ADR-108: Use a unified project hub](0108-use-a-unified-project-hub.md)                                                           | accepted |
| [ADR-109: Retain binding ownership until explicit transfer](0109-retain-binding-ownership-until-explicit-transfer.md)             | accepted |
| [ADR-110: Observe management operations on the server](0110-observe-management-operations-on-the-server.md)                       | accepted |
| [ADR-111: Separate launch working directory from project association](0111-separate-launch-directory-from-project-association.md) | accepted |
| [ADR-112: Separate exit from history management](0112-separate-exit-from-history-management.md)                                   | accepted |
| [ADR-113: Separate runtime status from resume permission](0113-separate-runtime-status-from-resume-permission.md)                 | accepted |
| [ADR-114: Share runtime observations within each reader response](0114-share-runtime-observations-per-reader-response.md)         | accepted |
| [ADR-115: Retain Codex path exclusions until disappearance](0115-retain-codex-path-exclusions.md)                                 | accepted |

## Provenance and maintenance

ADR-101 through ADR-115 reconstruct existing, implemented decisions as of
2026-11-15. Their `date` is the reconstruction date, not the original decision or
acceptance date. This consolidation introduces no runtime behavior changes.
Each record links its evidence and identifies material gaps; alternatives are
listed only where supported by surviving records. Current implementation verifies
behavior, but does not by itself prove which alternatives were historically considered.

The [legacy index](legacy-index.md) preserves all 26 old numbers, original titles,
commit-pinned source links, and their mapping to the current set. The old records
are available in Git rather than duplicated in this directory. References to
ADR-0001 through ADR-0026 always mean those frozen records, never the new set.

- Use `ADR-116` next, with filename `0116-<slug>.md`; never reuse numbers.
- Record one independently changeable choice, including its boundary and accepted
  costs. Keep implementation detail in the technical reference.
- Use `proposed` until acceptance is established. For a full replacement, mark the
  prior record `superseded by ADR-NNN` and link both records. For partial changes,
  keep its status and identify the changed scope and successor explicitly.
- Preserve decision context and dates. Later evolution belongs in a dated scope
  note or a successor, not an unmarked rewrite of the original rationale.
- Keep the index aligned with titles and statuses, and check file links, section
  anchors, unique numbers, and replacement targets when changing records.
