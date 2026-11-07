# GHC-01 — Identity isolation and temporary v2 containment

This implementation establishes the principal/resource contract in `src/workspace/identity.ts` and requires a validated numeric GitHub `/user.id` before allowing authenticated repository sessions.

## Temporary v2 containment

The `darkfactory-workbench` database remains **version 2**. No store is deleted, renamed, migrated or cleared by GHC-01. Historical v2 workspace records with `fullName@ref` IDs, older blob/overlay/staged/committed/commit records, the original `workbench-recent-workspaces-v1` list and old `workbench-layout-v1/v2` layouts are **unattributed** and are never restored, reassigned or automatically deleted. The app shows an explicit warning in the repository dialog.

New workspaces opened *after* verified identity resolution use `ghcode-owned-v2:<encoded-principal>:<session-uuid>` keys, and contain embedded immutable ownership metadata. Their recents and workbench layouts are written to distinct principal-namespaced localStorage keys. This is a temporary, compatibility-level containment of newly-created records in the existing stores, **not** a new v3 persistence engine or migration of historical data.

Remote GitHub repository authorization is required before local restoration and remote file content is fetched under the active principal. A 401/403/404 must never authorize cached fallback. Account transitions reset live workspace, cached overlays, ref lists, repository state, Dockview/editor instances and the repository-dialog form. Operations that fetch remote data and use it to update principal-scoped state are fenced by a generation token; cross-tab identity transitions trigger best-effort BroadcastChannel invalidation.

## Security and integrity boundaries

This is **application-level owner scoping**, not encryption or cryptographic isolation against arbitrary same-origin scripts. The app can still run with the inherited v2 write-acknowledgment and multi-store transaction problems: GHC-02 owns durable transaction completion, atomic stage/commit operations, revision fencing and a safe v3 recovery/migration manifest. GHC-03 owns durable editor/model flush, close guards and cross-tab edit-conflict handling. Do not interpret GHC-01 as solving either workstream.

Before the v3 cutover, historical work is intentionally inaccessible in the normal UI, **but remains physically retained** for explicit owner-verified export, quarantine and attribution; it must never be silently assigned based on the currently signed-in account. GHC-02 must account for both historical unattributed data and newly owned `ghcode-owned-v2:` records, plus old localStorage layouts, without deleting the six legacy stores.

## Required follow-up integration

- Implement v3 principal/session/resource tables and migration manifest using issue #32; do not import old v2 records automatically.
- Replace the temporary owned-v2 keys with durable versioned records after explicit migration, preserving per-principal ownership.
- Move write acknowledgments to IDB transaction completion and atomic multi-store stage/commit.
- Reconcile cross-tab revision conflicts in v3; BroadcastChannel only invalidates, not a consistency authority.
- Introduce DocumentService with durable flush and guarded close, as required by issue #27.
- Expand isolated Playwright security probes and verify executable acceptance on the final head.
