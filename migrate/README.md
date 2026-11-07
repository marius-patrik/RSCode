# Tri-source migration baseline — review candidate

**Scope:** source reference preservation only. This is **not** a completed application integration, executable release, or security acceptance.

The canonical root `src/`, `package.json`, `bun.lock`, runtime and existing GitHub workflows are retained from DarkFactory-web `main@39341ce5f8459b834c8e20b5227c25980078a87e`. The intentional root safety/config additions are: `bunfig.toml` to exclude migration nested suites from root Bun autodiscovery; `biome.json` ignoring only the inert `migrate/` subtree during root formatting/lint; a precise quality-matrix filter in existing `.github/workflows/darkfactory-control.yml` to prevent automatic DarkFactory quality jobs from treating the reference apps as live root packages; and **PR-only, read-only** `.github/workflows/migration-source-verification.yml` which **does** execute independent full source acceptance jobs. No existing root quality jobs are suppressed. These changes alter test/CI discovery only, not the shipped runtime or deployment. The Bun configuration excludes `migrate/**` from **root-only** Bun test autodiscovery: otherwise `bun test` erroneously runs historical GHCode and nested RSCode suites with wrong dependencies and mismatched dev-server origins (first exact-head Verify run 41509068173 failed). This configuration does not disable any existing root `src` tests. The source-only merge commit has the history checkpoint `53a2e71f1771179139724dadde6f675fea0713b8` as a second parent; historical original Git SHAs remain exact, but historical reachability is **not** functional acceptance.

## Layout

- `rscode/`: full original main Bun/React workbench source with RSC-03 security/RSC-04 single-flight files and tests overlaid from verified preexisting integration, plus native-packaging source from RSC-05 PR #28. **Windows packaging remains failing/unaccepted.**
- `ghcode/`: original full `development@7801784` source with GHC-01 identity isolation; `evidence/ghc00-historical-tests/` holds the separate original regression suite. **GHC-02 unsafe historical v3 is excluded; W02-R now contains a provisional transaction-acknowledged push journal and a DocumentService integrated into Monaco, not yet accepted as complete lifecycle protection.** Historical rejected source is still reachable in the retained Git DAG.
- `canvas/`: source and app-specific tests from Canvas PR #41. The original relative structure `.github/app/` and `.github/tests/` is deliberately retained so the generator/test harness resolves source paths. `.agents/` and `repo.dfconfig` are **reference content fixtures**, not active governance for DarkFactory-web. No Canvas workflow or site publishing is imported.

GitHub Actions only discovers workflow files from the repository's top-level `.github/workflows/`. The nested historical workflows within `migrate/rscode/` and `migrate/ghcode/` cannot be selected as root workflows. The dedicated top-level verification workflow has **no push/main trigger, no write permissions and no release/Pages jobs**. GHCode's historical `.darkfactory` gitlink and `.gitmodules` are retained only in the original immutable Git DAG, not copied as an unresolvable nested submodule. No migration source is imported from the active root runtime.

## Reproducible review commands

Run `python3 migrate/verify.py` on the proposed PR checkout with Git history. This checks strict subtree Git hashes, historical-tip reachability, root source isolation, suspicious paths and protected source trees. For independent backup restoration, add `--bundle /path/to/verified.bundle` once the off-GitHub backup is available.

The W01 candidate was **actually exercised** at exact head `d091a26eaa7ab7b814056e2c48ddc922ecebb3ac`: [source verification](https://github.com/marius-patrik/DarkFactory-web/actions/runs/41511237804) passed the history/isolation, RSCode, GHCode, and Canvas jobs; [root Verify](https://github.com/marius-patrik/DarkFactory-web/actions/runs/41511237736) and [managed quality](https://github.com/marius-patrik/DarkFactory-web/actions/runs/41511238882) also passed. This evidence applies to the original W01 snapshot, **not automatically to revised W02 code**. Native distribution and offline bundle restoration were not exercised by those jobs.

Run these commands to reproduce and independently reaccept **the current W02 candidates**:

```sh
cd migrate/rscode
bun install --frozen-lockfile
bun run verify

cd ../ghcode
bun install --frozen-lockfile
bun run check
bun test .github/unit/storage-unit.test.ts .github/unit/document-service.test.ts
bun run acceptance

cd ../canvas/.github/app
bun install --frozen-lockfile
bun run check
cd ../../..
node migrate/canvas/.github/tests/persistence/canvas-persistence.mjs
```

**W02 release safety:** `.github/workflows/release.yml` now requires an active root application path on `main` pushes; the source-only baseline, provenance documentation, and verifier changes alone do not match this filter. Existing manual dispatch behavior and version-tag checks are unchanged. The verifier checks the exact allowed release modification against the original `main` copy. The existing release has `contents: write`; do not merge until GitHub confirms the path filter and exact-head CI.

**Caveats:** the Canvas app has a Bun 1.3.11 lockfile accepted by frozen Ubuntu CI; Canvas now validates selected-repository context via a bounded contract, but its standalone generator remains build-time fixture-driven; native packaging needs real OS runners and real Chromium; archived GHCode historical tests are not yet behaviorally reconciled. An environment unable to run these tests must report **NOT RUN**, never PASS.

## Provenance and licensing

`manifest.json` records the complete 77 source branch/PR/tag mappings (30 GHCode, 47 template), original SHAs, selected source tree hashes and explicit accepted/rejected/provisional code disposition. Detailed original export reports are retained at `docs/migrations/`.

Both GHCode and Canvas derive from GPL-3.0 sources. DarkFactory-web has no chosen root LICENSE at this checkpoint. The T014 source/asset/dependency-rights decision is **release-blocking**. No GPL-derived code from this snapshot may be shipped as an integrated production binary until legal and supply-chain obligations are resolved.

## Reviewer gate

Do **not** merge until the source tests, provenance verification, security failures, Windows distribution issues, Canvas build, and upstream template-retirement preconditions have been independently dispositioned. Do not delete DarkFactory-template; retire its standalone website in a separate gated PR only after the snapshot is accepted.

### Historical W01 source-verification run evidence

PR-only exact-head source verification [run 41510751170](https://github.com/marius-patrik/DarkFactory-web/actions/runs/41510751170) at commit `34140810d74218661666a646eb67c9a4db270dff` passed all four jobs: immutable Git ancestry & 77 refs, RSCode, GHCode (Bun 1.4.0 required for historical v2 bun.lock), Canvas. This proves source tests only; does not certify Windows or post-deletion offline bundle restore. Prior root Verification [41510178278](https://github.com/marius-patrik/DarkFactory-web/actions/runs/41510178278) passed on `fa5ab4c2`. Managed DarkFactory quality detection at that head failed because it incorrectly discovered nested reference apps; the managed quality matrix is now restricted to active root jobs while dedicated migration suite covers all nested apps. Retest the final head before merging.

## W02-R continuation evidence (2026-11-03)

The interrupted W02 commits were recovered without reset. W02-R adds a durable GHCode push journal (prepared → ready → remote-confirmed → completed), principal-bound transaction revocation, real Chromium IndexedDB adversarial tests, and a first integrated DocumentService with single-writer revision acknowledgments and basic guarded Monaco/Dockview transitions. It also introduces a bounded source context contract in Canvas, with five active Bun contract scenarios. These are **provisional source implementations**, not GHC-02/GHC-03 full acceptance, an integrated unified application, or production releases.

Exact subtree hashes are pinned in `manifest.json`. Ubuntu Canvas and RSCode source tests passed at `050168252a4eb9c5b95aa93ac4ade10b782bde09` in [run 41629332020](https://github.com/marius-patrik/DarkFactory-web/actions/runs/41629332020), but the same source run failed because the GHCode browser assertion selector was ambiguous and source hashes were stale. Both have been corrected; verify the new exact head rather than inferring acceptance from partial prior runs. The original backup ZIPs were not available and no fresh offline restoration or cross-platform native archives were tested.

### W02-R verified source checkpoint

At \`0c596f59451ee0e337526c90c1d6cf43cd45c209\`, [source run 41630736085](https://github.com/marius-patrik/DarkFactory-web/actions/runs/41630736085) passed all four migration jobs. GHCode passed 10 Bun unit tests and 31 Chromium acceptance tests, including the DocumentService save-failure UI; Canvas passed frozen installation, five source-context tests, 23 browser IndexedDB scenarios and smoke; RSCode passed Ubuntu source tests. [Root Verify 41630736068](https://github.com/marius-patrik/DarkFactory-web/actions/runs/41630736068) and [Runtime 41630736821](https://github.com/marius-patrik/DarkFactory-web/actions/runs/41630736821) also passed. This is **source-candidate CI**, not certification of full GHC-02 migration, every Dockview path, remote GitHub CAS, native installers, offline bundle recovery, licensing, or unified application.
