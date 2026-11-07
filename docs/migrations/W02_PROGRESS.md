# W02-R recovery and implementation checkpoint — 2026-11-03

**Decision: CHANGES REQUIRED.** This source-reconciliation branch remains a **draft**, is not M007-accepted, and has not modified production `main`.

## Recovery and commits

Original W01 source baseline: `d091a26eaa7ab7b814056e2c48ddc922ecebb3ac`. W02 recovery HEAD: `3d4eecfb54174fbc49e29f01fdb657f24a95f181`. All seven W02 commits (`8123bc55`, `f10d40c6`, `dab537ae`, `0a004c65`, `9cad0598`, `50c02134`, `3d4eecfb`) were preserved. W02-R continues linearly with `d7c811ea`, `d32ec65f`, `5b07d9d6`, `8e2bc144`, `f0ce46b0`, `fb5f7661`, `b6920b4c`, `a2cef27d`, `2d38fec5`, `6d09e825`, `05016825`, and `11f260e6`. These are actual remote branch commits, not work in a local draft.

## Implemented source repairs (provisional)

- GHCode: IndexedDB version 3 adds an authorized `pushOperations` journal, persists the exact target before remote GitHub ref mutation, validates remote ref on retries, and completes local cleanup in one transaction only after confirmation. Ambiguous outcomes retain local commits. A remote ref update is not remote compare-and-swap, so external races still require manual reconciliation.
- GHCode: storage checks ownership after awaited reads and aborts tracked write transactions on principal switch. Unit and actual Chromium IndexedDB cases cover A/B/anonymous isolation, invalid principals, interrupted push journal, reload, phase CAS, atomic stage/commit, injected transaction/quota failures.
- GHCode: a new `DocumentService` uses the existing IndexedDB workspace writer, keeps one in-memory authoritative model/resource, serializes revision-acknowledged Monaco saves, exposes retryable failure, and blocks basic tab close, signout, repository/ref switch and browser unload while bytes are unacknowledged. Model ownership is shared across views. It is a partial GHC-03 implementation, not complete Dockview group/drag and conflict acceptance.
- Canvas: frozen Bun 1.3.11 lockfile from W02 remains unchanged. A new source-provenanced, deterministic, bounded parser rejects invalid/oversized paths, duplicates, conflicting immutable repository IDs and unsafe graph links; the existing standalone UI uses it for source documents and relationships. Five active Bun contract tests run from Canvas `check`.
- Root: existing release push path restrictions and isolated `migrate/**` source testing remain. No release or Pages publication has occurred.

## Latest source fingerprints after W02-R fixes

| Source | Original immutable source SHA | Reconciled candidate subtree Git SHA |
| --- | --- | --- |
| RSCode | `39341ce5f8459b834c8e20b5227c25980078a87e` | `d3588b5ea1f3c4184728f6036a40da3b174dbd09` |
| GHCode | `7801784b5bb596dcc720a48b7085443fc8f9ca3f` | `d5438d3751cd6dbb5c7920d7f635ca3557a74078` |
| Canvas | `5f462ea6e73c570e483149d6846dcc9190c09d51` | `1e99bf067ace6d0af37cf447662b822137a5f481` |

These are Git *tree* SHA-1 values, not SHA-256 hashes of ZIPs. The old originals, imported original PR branch refs and tags are kept in the merge ancestry.

## Executed CI evidence (precise limits)

- **PASS**: `3d4eecfb` W02 exact-head [Verify 41596969237](https://github.com/marius-patrik/DarkFactory-web/actions/runs/41596969237), [Runtime 41596969679](https://github.com/marius-patrik/DarkFactory-web/actions/runs/41596969679), and [source 41596969230](https://github.com/marius-patrik/DarkFactory-web/actions/runs/41596969230) with all four source jobs.
- **PASS**: `5b07d9d6` GHCode source job [41626641160](https://github.com/marius-patrik/DarkFactory-web/actions/runs/41626641160) with 30 Chromium cases (includes 4 new real-IDB cases); Root [Verify 41626641384](https://github.com/marius-patrik/DarkFactory-web/actions/runs/41626641384) and [Runtime 41626642096](https://github.com/marius-patrik/DarkFactory-web/actions/runs/41626642096). Full source workflow **FAIL** because the manifest still pinned the prior GHCode tree.
- **PASS**: `05016825` [Root Verify 41629332115](https://github.com/marius-patrik/DarkFactory-web/actions/runs/41629332115), [Runtime 41629332522](https://github.com/marius-patrik/DarkFactory-web/actions/runs/41629332522), and Canvas and RSCode source jobs in [41629332020](https://github.com/marius-patrik/DarkFactory-web/actions/runs/41629332020). Canvas included frozen install, `check`, five context contract tests, 23 Chromium IndexedDB scenarios and UI smoke. The same source run **FAIL** overall: manifest tree mismatch; GHCode's new quota/save UI test failed on an ambiguous alert selector. That assertion was corrected at `11f260e6`.
- **FAIL (intermittent, unresolved)**: `d32ec65f` [Root Verify 41626375049](https://github.com/marius-patrik/DarkFactory-web/actions/runs/41626375049), Chromium initial blank-frame timeout. Earlier [41596379238](https://github.com/marius-patrik/DarkFactory-web/actions/runs/41596379238) also contained Chromium-frame and Git status timeout. Subsequent green runs are not fixes.
- **NOT RUN**: fresh off-GitHub backup ZIP SHA-256 verification and isolated `git bundle verify` / restoration. Prior independent pre-deletion source restore remains separately documented in `POST_DELETION_RECOVERY.md`. No false offline recovery claim.
- **NOT RUN**: Windows x64, Linux native distribution archive outside checkout, macOS ARM64/x64 native archives and installer tests, native PTY stress, transitive-license/SBOM clearance, repository-template retirement.
- **PASS:** exact-head isolated source CI at \`0c596f59\` passed all four jobs; this is candidate test acceptance, not final GHC-02/GHC-03/native acceptance.

## Unfinished acceptance gates

1. Complete GHC-02 resource-level ownership, immutable revisions and CAS, non-destructive owner-safe v3 legacy migration, authorization across exports/imports, quota capacity and cross-tab conflict tests. The rejected historical GHC-02 implementation remains excluded.
2. Complete GHC-03 Monaco/Dockview group close, pane transfer, workspace/ref/account transitions and concurrent editor durability; explicitly distinguish acknowledged bytes from unacknowledged drafts.
3. Strengthen the remote-ref push boundary (GitHub conditional update cannot currently guarantee CAS) and provide user-visible uncertain-push reconciliation.
4. Fix reproducible RSCode Chromium-frame/readiness and Git/PTTY race conditions; build/check actual four-platform native artifacts on hosted OS runners.
5. Provide a runtime selected-repository context source for Canvas, complete UI/graph/mobile acceptance and preserve its standalone browser IDB regression suite.
6. Certify historical source-only merge readiness, online ancestry/manifest and independent offline bundle restoration separately; verify source-only paths cannot publish.
7. Create a source-backed SPDX/SBOM/license and asset notice inventory, obtain owner licensing authorization before distribution. Template website retirement remains gated; **do not delete DarkFactory-template**.

This progress checkpoint reports implementation and evidence, not a fully accepted release.

### 483fd508 real-UI regression and accessibility correction

[Migration source run 41630037042](https://github.com/marius-patrik/DarkFactory-web/actions/runs/41630037042) confirmed **PASS** for history/77 ref preservation, Canvas, and RSCode, and **FAIL** for the GHCode browser job. GHCode had **30/31 Playwright cases passing**; the new real save-failure test reached the retry state, but the Monaco minimap overlaid its button because an additional alert had broken the grid's two-row layout. Commit \`3895da4e\` moves notices and the Monaco body into one bounded flex/grid content cell so the control is actually clickable, rather than bypassing interaction in the test. That correction awaits independent CI. No release acceptance is inferred.

## Full exact-head CI after accessibility and fingerprint corrections

**PASS**, tested revision \`0c596f59451ee0e337526c90c1d6cf43cd45c209\`:

- [Root Verify 41630736068](https://github.com/marius-patrik/DarkFactory-web/actions/runs/41630736068): PASS.
- [DarkFactory Runtime 41630736821](https://github.com/marius-patrik/DarkFactory-web/actions/runs/41630736821): PASS.
- [Migration source verification 41630736085](https://github.com/marius-patrik/DarkFactory-web/actions/runs/41630736085): **all four jobs PASS** — source history/root isolation, RSCode, Canvas, GHCode.
- GHCode source job: \`bun run check\` PASS; **10 Bun unit tests PASS** across storage and DocumentService; **31/31 real Chromium Playwright tests PASS**, including the retryable save-failure scenario that previously failed on the Monaco canvas intercept.
- Canvas source job: frozen Bun installation, TypeScript/Biome/build with **five source-context tests**, **23 Chromium IndexedDB tests**, and UI smoke PASS.
- RSCode: Ubuntu source suite PASS; no Windows/macOS native packages or repeat stress acceptance from this run.
- Source verifier: exact current three Git tree hashes, original history mapping for 77 source refs, release path guard and root isolation PASS. **No offline ZIP/bundle restore** occurred.

The exact tested source-tree hashes remain pinned in \`migrate/manifest.json\`. Later documentation-only commits change the repository HEAD but do not alter the source snapshots. Exact-head CI should still be checked on the final PR revision. **Verdict stays CHANGES REQUIRED** because critical security, native, licensing, and unified-app acceptance is unfinished.
