> **Consolidated program update — 2026-11-01:** This document describes the **GHCode history-import subphase** only. The owner has selected a single final product combining **template-repo Canvas + GHCode + RSCode**, hosted in this repository and ultimately renamed to **`marius-patrik/darkfactory-web`**. The **sole canonical finite execution and acceptance plan** is [RSCode issue #31](https://github.com/marius-patrik/RSCode/issues/31). Preserve this document's verified ancestry evidence, but do not separately execute its earlier GHCode-only retirement workflow. No source repository deletion, runtime code import, or rename is authorized until the consolidated gates pass. No agent dispatches.

# GHCode → RSCode consolidation

**State:** Migration in progress; NOT accepted, not merged into `main`, GHCode repository NOT deleted.

## Decision

RSCode is the surviving application. Its local Bun runtime, terminal, Chromium stream, filesystem, workspace persistence and Git integration remain authoritative. GHCode provides distinct GitHub-native repository, PR, issue, Actions, release, specification/Factory and publication capabilities, which must be integrated through explicit contracts rather than launching a second IDE inside RSCode.

## Phase 1 — Preserve original Git ancestry

The history-import workflow brings GHCode's **original Git commit objects** from all accessible branches, original release tags and GitHub pull-request head refs into this branch's merge ancestry without squashing or rewriting author/time/commit SHA.

A provenance manifest is generated at `docs/migrations/GHCODE_GIT_HISTORY.json`. Original GHCode release tags are namespaced to `ghcode/*` to avoid RSCode collisions. A downloadable Git bundle is produced as a temporary secondary backup.

The import must not execute GHCode workflows, install GHCode dependencies, touch production branches, or enable unaudited GHCode code.

## Phase 2 — Integrate nonduplicative functionality

1. Map RSCode versus GHCode capabilities and choose a single owner for each responsibility.
2. Implement a separately authenticated GitHub provider/service adapter; preserve local filesystem and Git operations as RSCode's local provider.
3. Integrate GHCode repository/PR/issue/release/Actions views through RSCode panes and commands; no duplicate React shell or divergent workspace authority.
4. Integrate the Factory parser/assessment behind pure TypeScript contracts with provenance and evidence completeness, not another provider-owned React context.
5. Reconcile Monaco models and state ownership without copying GHCode's unsafe edit debounce or the rejected GHC-02 persistence implementation into live code.
6. Adapt necessary tests/fixtures with independent privacy, local-runtime security, document durability, Git operation and migration coverage.
7. Resolve overlapping dependencies and supply-chain checks, and ensure macOS/Windows/Linux distribution work in RSCode is not regressed.

## Phase 3 — Verified integration and retirement

- Full Git ancestry reachable from RSCode `main` *after* reviewed integration.
- All original tags mapped and GitHub PR refs/history represented.
- All source functionality evaluated (kept, integrated, retired with justification) with tests.
- RSCode existing open PRs (#23/#25/#28) and security/distribution issues reconciled before production.
- Export GHCode issues, PR discussions/reviews, release metadata and binaries, workflow artifacts, and repository settings where feasible. **Git history alone does not preserve GitHub-hosted discussions or artifacts.**
- Decide GHCode GitHub Pages legacy URL redirects/retirement and OAuth broker callback migration; verify existing users' local storage/recovery path.
- Independently review final RSCode release and verify all targeted platforms.
- Only then delete GHCode (explicit owner request), after a durable off-GitHub mirror/bundle backup and evidence that RSCode contains the complete graph.

## Release blockers from independent audit

GHCode PR #34 was rejected at `49d194f75eccd919401d10bf1ef3f0df34ca9a34`: legacy private-content export could be opened across identities, storage APIs were not principal-scoped, and remote push settlement could delete nonpushed local commits. **Preserve this branch's history but do not merge its implementation into active RSCode code.** The source report also identifies legacy backup and export fidelity limitations.

## Safety rule

Do not delete, archive, transfer, or change GHCode settings until Git reachability, hosted metadata backup, actual feature integration, tests, releases, and rollback are all verified.
