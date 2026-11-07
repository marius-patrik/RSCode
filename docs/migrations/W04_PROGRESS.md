# W04 — Source convergence, native acceptance and conditional-main gate ledger

**Verdict: CHANGES REQUIRED — NOT MERGED.** This ledger records implementation and evidence at W04 checkpoints; it is not an authorization to ship the successor product. PR #39 stays draft. Root production `main` remains `39341ce5f8459b834c8e20b5227c25980078a87e` at the checked baseline.

## A. Canonical repository and isolation

- Repository: `marius-patrik/Wrkbench`, original GitHub ID `1357326589` (renamed, not replaced).
- Existing source integration: PR #39, `integration/tri-source-migration-baseline`; W04 started at `e2029ee90118c06f061c2493830ba851ab669acc`.
- Source snapshots remain inert under `migrate/rscode`, `migrate/ghcode`, `migrate/canvas`. Original source ancestry and 77 historical refs remain under the preservation DAG.
- Independent root-reliability work is isolated in **draft PR #40** against `main`. Do not import its runtime changes into PR #39 or claim they are live.
- Owner-deleted GHCode is not recreated. `DarkFactory-template` is retained.

## B. PR #25 security capability crosswalk

Every original PR #25 changed file was compared byte-for-byte against the selected RSCode source snapshot at W04 start. Identical blob hashes establish exact file equivalence; divergent files were reviewed for behavior rather than overwritten.

| Capability | Historical PR #25 path | Reconciled path | Status / evidence |
| --- | --- | --- | --- |
| API own-property lookup preventing prototype traversal | `src/server/api.ts` | `migrate/rscode/src/server/api.ts` | **Source accepted** — identical Git blob `3f3efd0c`; source CI |
| Host/origin, HTTP+WS guard, local CLI trust | `src/server/server.ts` | `migrate/rscode/src/server/server.ts` | **Source accepted** — identical blob `ae9d237d`; runtime security regressions |
| Browser error sanitization, task exception capture and context ceiling | `src/server/browserService.ts` | `migrate/rscode/src/server/browserService.ts` | **Source accepted, later improved** — historical blob `47477b6b` differs because migrated source adds a single-flight `screencastStarting` state, startup cleanup and shutdown cancellation; source CI |
| Browser allocation tests | `src/tests/browserService.test.ts` | `migrate/rscode/src/tests/browserService.test.ts` | **Source accepted, later improved** — migrated test adds three concurrent-start/failure/close scenarios |
| Real dev server proxy and Origin matrix | `src/tests/devServer.test.ts` | `migrate/rscode/src/tests/devServer.test.ts` | **Source accepted** — identical blob `c1f4ff44` |
| Negative privileged runtime matrix | `src/tests/runtimeSecurity.test.ts` | `migrate/rscode/src/tests/runtimeSecurity.test.ts` | **Source accepted** — identical blob `aaffd821` |

**Nonclaim:** PR #25 commit ancestry by itself proves neither behavior nor root deployment. This is source reconciliation, not a production security-release verdict.

## C. PR #28 native capability crosswalk

| Historical capability | Historical PR #28 path | Reconciled path | Status |
| --- | --- | --- | --- |
| Native distribution design and known gaps | `docs/NATIVE_DISTRIBUTION.md` | `migrate/rscode/docs/NATIVE_DISTRIBUTION.md` | **Preserved**, identical original blob |
| Real extracted acceptance | `scripts/distribution/accept.py` | `migrate/rscode/scripts/distribution/accept.py` | **Preserved; diagnostics extended in W04** |
| Deterministic archive and checksums | `scripts/distribution/archive.py` | `migrate/rscode/scripts/distribution/archive.py` | **Preserved**, identical original blob |
| Installed Chromium/profile probe | `scripts/distribution/browser-probe.ts` | `migrate/rscode/scripts/distribution/browser-probe.ts` | **Preserved; diagnostics extended in W04** |
| Build/run provenance | `scripts/distribution/build.ts` | `migrate/rscode/scripts/distribution/build.ts` | **Preserved; W04 adds exact PR-head source SHA override** |
| Bun+browser installed entrypoint | `scripts/distribution/launch.ts` | `migrate/rscode/scripts/distribution/launch.ts` | **Preserved**, identical original blob |
| Real PTY sentinel | `scripts/distribution/terminal-probe.ts` | `migrate/rscode/scripts/distribution/terminal-probe.ts` | **Preserved**, identical original blob |
| OS matrix trigger | `.github/workflows/native-distribution.yml` | `.github/workflows/migration-native-distribution.yml` | **Intentionally adapted** to top-level, PR-only, read-only, no release/deploy and exact migratory subtree. The original workflow was not imported as a competing active release path. |

## D. W04 RSCode changes and executable evidence

### Windows source paths and privilege containment

- Fix Windows native workspace absolute-path validation (`path.isAbsolute`) rather than Unix-only `startsWith('/')`. Source: `migrate/rscode/src/server/store.ts`.
- Reject drive-root, UNC and drive-relative Git pathspecs even on POSIX. Preserve existing parent traversal/NUL checks.
- Add two source regression tests under `src/tests/store.test.ts`.
- Exact-head source workflow at `1df63b084b770d2a86be98565ef4546cf3d02413`: [Migration source #42219265951](https://github.com/marius-patrik/Wrkbench/actions/runs/42219265951) **PASS 5/5 jobs**, including **13/13 Windows store tests**; [root Verify #42219265946](https://github.com/marius-patrik/Wrkbench/actions/runs/42219265946) PASS.
- Windows source tests and correct workspace paths do **not** demonstrate the native Windows installed Chromium or ConPTY PTY works.

### Four-platform real installed native probes

At exact source commit `deeeda6cb190ae614d609cf58226e21e216340ad`, [native matrix #42220282052](https://github.com/marius-patrik/Wrkbench/actions/runs/42220282052) ran actual archives extracted outside checkout:

| Platform | Result | Archive | SHA-256 | Evidence / limitation |
| --- | --- | --- | --- | --- |
| Linux x64 | **PASS** | `RSCode-v0.2.0-linux-x64.tar.gz` | `f4fb1a0c5b2087628c526aa811b43e54cf616ae97a2400bcf2964d23f206daef` | Bun launch, health, frontend, workspace mutation, Chromium, Unix PTY, graceful stop/restart, persisted profile/workspace |
| macOS ARM64 | **PASS** | `RSCode-v0.2.0-darwin-arm64.tar.gz` | `3fc20ac3321bf43d879ef2d884f6d356ac5cef1e0e267f4fb4767f8c4f19e1bb` | Same extracted-install acceptance |
| macOS x64 | **PASS** | `RSCode-v0.2.0-darwin-x64.tar.gz` | `71578090a410f83765b570f7288b881562dabd32b717953921205edb5a9a6306` | Same extracted-install acceptance |
| Windows x64 | **FAIL** | `RSCode-v0.2.0-win32-x64.zip` | `00bee5c5721293701ce415d062ff06781d02f83265869c044405288b76b64e77` | Native executable, health, frontend and **workspace mutation PASS**; bundled Chromium probe **timed out after 70s**. Windows PTY/graceful lifecycle not reached or accepted. |

- Real archive builds are unsigned/unnotarized and **not published** by this workflow; artifacts retain only checksum/JSON evidence.
- Even Unix success does not prove complete CDP frame streaming or repeat-build bytewise reproducibility. No public native release authorization.
- W04 follow-up adds installed browser stage tracing, Playwright stderr, subprocess timeout-output retention (still **requires new exact-head CI**).

## E. Root Chromium reliability isolation

The previous W03 root Verify [#42033097197](https://github.com/marius-patrik/Wrkbench/actions/runs/42033097197) failed in `src/server/browserService.ts:336` with real Chromium **signal 11** during `launchPersistentContext`. Do not call this a JavaScript-origin/HTTP failure.

- Created independent **draft PR #40**, `fix/root-chromium-native-crash-recovery`.
- Bounded mitigation: one retry only for Playwright launch errors proving SIGSEGV, after Chromium singleton-lock cleanup. Every other launch error and repeat crash fails normally. Unit fault injection tests cover both boundaries.
- Exact-head root tests at `0f4cf355413f1a65c4fdc624a16599d97673fc5e`: [Verify #42219878075](https://github.com/marius-patrik/Wrkbench/actions/runs/42219878075) PASS and [Runtime #42219878831](https://github.com/marius-patrik/Wrkbench/actions/runs/42219878831) PASS.
- Real-browser stress [#42220940502](https://github.com/marius-patrik/Wrkbench/actions/runs/42220940502) **FAIL on all three independent runners** at the preexisting timer-triggered browser dialog test, including failures before/after initial stream. Reproduced another root reliability defect (not an acceptance pass).
- New root-only test change at `7991f78ad230ce3938ee7d5a70fe8d6342a99e6a` triggers the native confirm dialog *only after the subscriber stream is ready*, then explicitly answers before disposal; must pass new stress verification. This does not demonstrate native crash cause is repaired.
- Root application code in PR #39 remains untouched; merge PR #40 only after independent root acceptance.

## F. GHCode source reconciliation (not accepted)

| Area | Current source path | W04 disposition |
| --- | --- | --- |
| Principal ID and persisted workspace ownership | `migrate/ghcode/src/workspace/identity.ts`, `storage.ts` | **PROVISIONAL**; W03 principal generation fences, persisted proof and IDB transaction boundaries in place and tested |
| Versioned all-resource CAS, non-destructive legacy v2→v3 | `migrate/ghcode/src/workspace/storage.ts` | **BLOCKED**; no complete lossless all-record migration/repeated-abort acceptance |
| Shared Monaco model and serial acknowledged save | `migrate/ghcode/src/workspace/document-service.ts` | **PROVISIONAL**; serial writer + dirty state, multi-view tests |
| Crash-durable private draft journal | `migrate/ghcode/src/workspace/document-service.ts` | **FAIL/P0**; `suspended` is only a process-memory Map; browser crash discards draft. Must not claim durable recovery |
| Native Dockview close/move/group/transfer and multi-tab lifecycle | `migrate/ghcode/src/tabs/editor-tab.tsx`, `src/workspace/context.tsx` | **BLOCKED**; not independently accepted across destructive transitions |
| Push operation journal + GitHub GraphQL conditional ref CAS | `migrate/ghcode/src/workspace/storage.ts`, `src/workspace/context.tsx` | **PROVISIONAL**; mocked lost acknowledgment/reload and GraphQL beforeOid preserved; live protected-branch/permission matrix absent |
| Authorized import/export and quota recovery | `migrate/ghcode/src/workspace/export.ts`, `src/workspace/storage.ts` | **BLOCKED**; authenticated adversarial import/export and full capacity tests absent |

Source CI passing does not settle these P0 boundaries. Unsafe historical GHC-02 PR #34 remains excluded from active reconciled source but present in original Git ancestry. No GHCode remote is recreated.

## G. Canvas source reconciliation (not fully accepted)

| Area | Source path | W04 disposition |
| --- | --- | --- |
| Existing UI and 23 IndexedDB acceptance scenarios | `migrate/canvas/.github/app`, `migrate/canvas/.github/tests` | **SOURCE PASS** on CI; inert snapshot |
| Immutable source identity, validation, graph and search | `migrate/canvas/.github/app/src/repository-context.ts` | **SOURCE PASS** with contract/unit tests |
| Injected runtime read-only adapter and stale request cancellation | `migrate/canvas/.github/app/src/runtime-repository.tsx` | **PROVISIONAL**; five unit tests; no second persistence writer |
| Actual Chromium injected multi-repository switching and stale-leak proof | `migrate/canvas/.github/tests` | **BLOCKED**; current Chromium UI smoke tests standalone generated context, not a real injected provider lifecycle |

Do not advertise a unified application: only reference snapshots exist.

## H. Historical integrity and release safety

- Historical source DAG and manifest preservation: 77 original GHCode+Canvas ref records reached and verified in PR CI history job. Original commits are not rewritten or squashed.
- Owner's historical offsite backup: ZIP SHA-256 `e81c2d09601111b63432309751234fe9a96161a8c6834a48c79ef1ecf9d8b8f3`; embedded bundle SHA-256 `a315d67f07af523b7ba3540c2d18457df8d11c252e776fb6fb5c7c18f1f8de45`. Owner audit reported mirror restoration and strict fsck; **fresh full 77-tip independent restoration from private offsite archive NOT RUN here**, archive unavailable to this execution.
- No root `src/`, root package/lockfile or active app entrypoint changes in PR #39. Added only PR-scoped read-only native validation workflow and source verifier whitelist; root release `main` path guard remains active.
- GPL-3.0 source licenses retained in GHCode/Canvas; three partial source CycloneDX inventories are not complete asset/native license clearance. No redistribution decision made.

## I. M001–M006 conditional merge acceptance

| Gate | Verdict | Blocking evidence / minimum correction |
| --- | --- | --- |
| M001 historical preservation | **BLOCKED** | Source CI 77 refs PASS; fresh complete external ZIP/bundle restore of all original tips NOT RUN. |
| M002 RSCode convergence | **BLOCKED** | Security source reconciled; Unix native installed tests PASS, Windows installed Chromium FAIL, no complete Windows PTY/graceful lifecycle; root Chromium stress FAIL. Diagnose and repair independently. |
| M003 GHCode convergence | **FAIL** | Crash-durable private draft recovery, full all-record legacy migration/CAS, Dockview and authorized import/export missing. |
| M004 Canvas convergence | **PASS (source-only)** | Real Chromium injected provider test passed at 65527c8b: stale A rejected after B selection, forged C rejected, invalid identity revocation and recovery verified; 10 context tests and 23 IndexedDB scenarios passed. |
| M005 source snapshot integrity | **BLOCKED** | Source trees + fingerprints + licenses present; completed capability crosswalk still needs independent review and accepted/rejected asset rights disposition. |
| M006 migration isolation | **PROVISIONAL** | Root runtime/source isolation and release path guards PASS for tested heads. Full merged-main post-merge check and required root reliability acceptance unavailable until other gates pass. |

**Decision: DO NOT MERGE PR #39.** Retain draft, do not delete archived refs, do not close PRs #25/#28 as fully superseded before final accepted snapshot, do not publish native releases or replace root runtime.

## J. Remaining ordered work

1. Diagnose installed Windows Chromium timeout using W04 phase trace and OS process logs; obtain a passing real installed browser probe without treating a timeout increase as a fix.
2. Independently accept root Chromium process/crash and browser dialog reliability; complete separate root PR #40 or retain as draft with a precise blocker.
3. Implement GHCode non-destructive all-record v3 migration, principal-authorized import/export, durable private drafts, complete Dockview close/transfer and remote permission/conflict tests.
4. Add Canvas real Chromium runtime injected adapter tests with multiple immutable repository IDs and stale request cancellation.
5. Independently verify 77-tip offsite bundle restoration, full source capability reconciliation, licensing and source-only post-merge release safety.
6. Only when **every** M001–M006 gate passes, execute the separately authorized normal merge-commit of PR #39 and prove `main`'s active tree hashes remain unchanged. No unified application rebuild in this W04 wave.

## K. W04 continuation — verified runs and later source changes

The earlier A–J ledger is a checkpoint, not the final current SHA. Subsequent work and exact run IDs:

- [native OS #42222312462](https://github.com/marius-patrik/Wrkbench/actions/runs/42222312462): **Linux x64 PASS, macOS x64 PASS, macOS ARM64 PASS; Windows x64 FAIL**. Windows extracted installation additionally passed `controlled_file_create_and_modify` and `controlled_git_repository_and_status`, then Playwright bundled headless shell `chrome-headless-shell.exe` launched but never completed persistent-context CDP negotiation and failed its real **25-second** timeout. All later PTY/shutdown/restart Windows checks remained unverified. This is not cured by the earlier Python stdout-PIPE handling.
- Tested Windows browser probe change: `migrate/rscode/scripts/distribution/browser-probe.ts` now experiments with Playwright's **full Chromium** channel on Windows instead of the non-responsive headless-shell process. This is **provisional** until a full installed Windows acceptance succeeds; production `migrate/rscode/src/server/browserService.ts` has **not** been changed to rely on it.
- [source isolation #42222312434](https://github.com/marius-patrik/Wrkbench/actions/runs/42222312434) was **PASS** all five jobs at `ac3c7170`, including both Windows native source unit tests and complete GHCode/Canvas/RSCode source checks.
- Root-only [stress #42222373706](https://github.com/marius-patrik/Wrkbench/actions/runs/42222373706) **FAIL 3/3 separate runners** at `e278e964`, despite root [Verify #42222373035](https://github.com/marius-patrik/Wrkbench/actions/runs/42222373035) **PASS** and [Runtime #42222374022](https://github.com/marius-patrik/Wrkbench/actions/runs/42222374022) **PASS**. Two failing replicas hit nondeterministic dialog/blank Chromium tests. PR #40 remains draft and unmerged.

### Canvas real-browser injected adapter coverage

New test-only bundle fixture `migrate/canvas/.github/app/tests/runtime-repository-browser-harness.ts` mounts the **real** `RuntimeRepositoryProvider` under Chromium, not just a standalone build-time context. `migrate/canvas/.github/tests/runtime-repository-browser.mjs` requests rapid A→B switching, delayed A resolution, malformed identity revocation, forged provider response, and valid recovery. Production Canvas provider change advances generation and revokes the previous selection when the next identity is malformed, preventing a late private data load. This does not add another persistent writer.

Initial attempt was rejected by CI because bundling a harness outside the app couldn't resolve React package dependencies; that file was relocated under app. Subsequent source CI `42223657772` failed the **four missing HTML button types** in the harness; those were repaired without disabling any lint rule. Final Chromium-run result must be taken from the newest **exact-head** source verification, not a superseded canceled job. **M004 remains BLOCKED until the new Chromium browser test passes.**

### Root tree equality

Direct original-main vs PR39 tree SHA comparison after W04 edits established exact equal Git tree objects for:
`src/` (`4799e20e`), `scripts/` (`270dc716`), and equal blobs for `package.json` (`debb8914`), `bun.lock` (`c815a91d`), `rsbuild.config.ts` (`5040386f`), `tsconfig.json` (`a4e1ae76`). Migration safety workflows differ intentionally. The source-only PR must continue to preserve these identities through the final merge, if ever authorized.

**Final merge disposition remains CHANGES REQUIRED — NOT MERGED.** No source-only main merge, release, repository deletion, source-history rewrite, or original RSCode PR closure has been performed. No production runtime reliability fix is accepted. The new native and Canvas tests do not waive GHCode crash-durable draft or legacy migration acceptance blockers.

## L. W04 exact-head Canvas and Windows regression outcomes

### M004 upgraded to PASS (source-only)

At `65527c8b50c11cd59ad9874a33feb33566ded4be`, [source CI #42224973977](https://github.com/marius-patrik/Wrkbench/actions/runs/42224973977) reported the Canvas job **PASS**, including exact output:

`{"browser":"Chromium","adapter":"INJECTED","staleA":"REJECTED","forgedC":"REJECTED","recovery":"PASS","secondWriter":"NONE","result":"PASS"}`

The same Canvas job passed 10 unit repository-context/adapter tests, 23 real Chromium IndexedDB scenarios, standalone UI smoke and complete Biome/typecheck/build. Runtime selection invalidation now clears source context and rejects pending old results. **M004 is accepted only for the isolated Canvas source, not an activated unified successor runtime.**

### Windows native and Git reliability remain unaccepted

At the same source snapshot [native CI #42224973771](https://github.com/marius-patrik/Wrkbench/actions/runs/42224973771) again **failed Windows**. Trying Playwright's full Chromium channel launched `chromium-1217/chrome-win64/chrome.exe` but did not establish the CDP pipe session: `persistentContext: Timeout 25000ms exceeded`. This rules out the **headless-shell binary alone** as a sufficient explanation; the cause may involve Bun's Windows Playwright process/transport, runner environment or another shared interface, and remains **unproven**. Windows executable/frontend/workspace/file/Git acceptance still passed before Chromium. The channel experiment is retained as a provisional probe, not a supported production fix. No inflated timeout or bypass.

The same source run's Windows-source job had **12 PASS, 1 FAIL**: preexisting full Git discovery/status/diff integration test timed out at Bun's 5,000ms default after executing multiple child Git operations; the two newly added Windows path tests **PASS**. This intermittency was previously observed. The next source revision removes two redundant Git-config child process startups while retaining actual `.git/config` semantics; performance and behavior must be retested at exact head and the underlying reliability risk remains tracked.

**Conditional merge conclusion unchanged: CHANGES REQUIRED — NOT MERGED.** Historical and GHCode P0 gates remain blocking even though M004 has independent browser evidence.
