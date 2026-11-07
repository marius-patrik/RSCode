# GHC-00: Executable integrity and privacy baseline

**Repository:** `marius-patrik/GHCode` · **Issue:** #24 · **Draft PR:** #30

**Frozen production:** `534e2203425d91783111e5d02d5ec92649fec594`

**Verified implementation starting point:** `development` at `e6328672fcaca1de1cd5f916677158cda8d334e9`

The production and development blobs for `src/workspace/storage.ts`,
`src/workspace/context.tsx`, `src/workspace/model.ts` and
`src/tabs/editor-tab.tsx` are **byte-identical** at these starting SHAs.

This is a reproduction-only dispatch. Production code, schema, workflows,
protected branches and published packages are not changed.

## Test execution provenance

A newly authored GitHub Actions run was triggered by draft PR #30, not reused
from a historical green build. Execution:
`https://github.com/marius-patrik/GHCode/actions/runs/41266654507`.

Environment: GitHub-hosted Ubuntu 24.04, Bun 1.4.4, Playwright 1.55.1,
Chromium headless 140.0.7339.186. Exact local command execution was not
possible from the investigator's container (no Bun or external network, no
connected remote computer). **CI tests are CI-executed, not local tests.**

| Command / step | Result from first PR-head CI |
| --- | --- |
| `bun install --frozen-lockfile` | passed |
| `bun run format:check` | passed |
| `bun run check` (lint, TS, production build) | passed |
| `python3 .github/scripts/generate_documents.py --check` | passed |
| `python3 -m unittest discover -s .github/tests -p 'test_*.py'` | **24 passed**, including dependency graph inventory |
| `bun run acceptance` | **17 passed, 5 intentionally failing safety regressions** |
| Re-run after additional regression extensions | See latest PR checks; do not infer results from the first run |

The full source-and-browser CI is expected to remain red until the P0
integrity defects are addressed in later, separately authorized dispatches.

## Independent browser reproduction results

| ID | Classification at first CI run | Source | Observed (synthetic data only) | Required invariant |
| --- | --- | --- | --- | --- |
| A / anonymous | **VERIFIED** (browser) | `src/workspace/context.tsx:195-211,243-248`; `src/workspace/storage.ts:198-210` | After opening a synthetic private repo as A, signing out and reloading, anonymous UI still selected `acme/private` from cached recent workspace. | Private workspace must not be readable without its authorized principal. |
| A / B | **VERIFIED** (browser) | `src/workspace/model.ts:92-94`; `src/workspace/context.tsx:170-215` | B signs in successfully; mocked GitHub denies access to A's private repository, but the selected UI workspace remains `acme/private`. | Principal/resource keys must isolate A's private snapshots, overlays and blobs from B. |
| Editor close | **VERIFIED** (browser) | `src/tabs/editor-tab.tsx:134-147,237-241`; `src/workbench/shell.tsx:421-429` | Editing then closing with the 250 ms timer deferred yielded no durable overlay record. | Pending edits must survive tab closure or close must be blocked until saved. |
| IDB request/abort | **VERIFIED** (browser) | `src/workspace/storage.ts:51-69` | Injected request success followed by transaction abort; no durable overlay survived, and the UI did not report a save failure. | Promise must settle on transaction completion, reject on abort/quota/error. |
| Interrupted local commit | **VERIFIED** (browser) | `src/workspace/context.tsx:684-728`; `src/workspace/storage.ts:189-197` | Aborting the commit record transaction left a `committed` projection without corresponding durable commit or preserved staged input. | Commit/overlay/staged/committed transitions must be atomic or recoverable. |

These tests preserve correct safety assertions even while failing on the
existing implementation. Do **not** invert expectations to greenwash CI.

**Further probes added later on the same test-only branch:** anonymous/B
private-content rendering, reload before debounce, repository switching,
cross-Dockview tab transfer, and injected QuotaExceededError. Interpret those
only from the newest CI run and its artifacts.

## Persistence schema and browser keys

Actual IndexedDB database: `darkfactory-workbench`, **version 2**.

| Object store | KeyPath | Purpose |
| --- | --- | --- |
| `workspaces` | `id` | `WorkspaceSnapshot` |
| `blobs` | `key` | Cached GitHub blob content |
| `overlays` | `key` | Working-file modifications |
| `staged` | `key` | Staged working files |
| `committed` | `key` | Locally committed file projection |
| `commits` | `id` | Local commit log |

Workspace identity is `fullName@ref` (no account identity). Blob keys
are `workspaceId:sha`; file keys are `workspaceId:path`. Recent
snapshots are not partitioned by principal.

LocalStorage keys observed in source:
`workbench-recent-workspaces-v1`, `workbench-layout-v2`,
`workbench-layout-v1` (legacy read), `workbench-theme`,
`ghcode-concern`.

SessionStorage keys:
`workbench-github-token`,
`workbench-github-auth-transaction`,
`workbench-github-auth-result`.

Migration example `.github/tests/fixtures/ghc00-synthetic-v2.json`
contains only synthetic A/B identities and inert repo/blob/file records;
it intentionally contains **no credentials**.

## Dependency graph and state ownership

The read-only `.github/tests/test_ghc00_dependency_graph.py` captures
actual source imports on each CI run. First run: **54 source modules,
152 internal import edges, zero strongly connected import cycles.**

That does not establish state ownership correctness. Critical ownership
crossings:

- `src/workspace/context.tsx` owns authenticated user, current repository,
  in-memory overlays/staged/committed state, GitHub reads/writes, and commits.
- `src/workspace/storage.ts` independently persists v2 snapshots, blobs,
  file layers and commit records; storage operations lack account ownership
  and atomic transaction coordination.
- `src/tabs/editor-tab.tsx` owns an additional unsaved local `value`
  with an independent 250 ms async write, while workspace context owns the
  canonical overlay state. Closing/moving/disposal clears timers.
- `src/workbench/shell.tsx` owns Dockview panel/tab lifecycle and layout;
  `src/workbench/persistence.ts` owns layout serialization. Neither
  mediates unsaved-editor close.
- `src/github/auth.ts` owns the session token, but sign-out does not clear
  or invalidate account-owned workspace/content caches.
- `src/factory/context.tsx` owns current factory concern with a separate
  localStorage preference `ghcode-concern`.

**Actual placeholders:** `src/tabs/problems-tab.tsx` displays only
"No diagnostics"; `src/tabs/output-tab.tsx` displays only "No output yet".
These are not test evidence of a functioning diagnostics or output service.
`src/tabs/document-tab.tsx` is a thin wrapper over the editor.

## Migration preconditions (not implementation authorization)

1. Define a principal/account identity policy and safely classify preexisting
   anonymous v2 records without exposing private records across principals.
2. Define resource ownership boundaries for repository, ref, blob, overlay,
   document, staged state, commit log and layout references.
3. Introduce transaction-completion acknowledgments and atomic or journaled
   multi-store transitions with interrupted-operation recovery.
4. Introduce a single durable document owner and explicit close, move,
   switch, unmount, reload and write-failure semantics.
5. Validate v2-to-next-schema migration using only sanitized fixtures.
   Do not clear actual customer data to make tests pass.

## Remaining limits

- Browser regressions execute against isolated Playwright contexts and
  synthetic GitHub API fixtures; no real private credentials/data are used.
- Browser behavior beyond Chromium and the tested UI paths remains unknown.
- Repository/API errors, constraint failures, true disk-quota exhaustion,
  browser crash mid-commit and concurrent multi-tab edits need further
  specialized fixtures before declaring these cases verified.
- Tests distinguish a reported P0 from a deployable correction: **no
  production fix has been made in GHC-00**.

**Handoff:** draft PR #30 targets `development`; orchestrator controls
subsequent contract approval and migration work.


## GHC-A04 — historical freeze and future-compatible acceptance

**Immutable original PR head:** `65d8de8e57f617560f6c027010c07668a270a3b5`.
**Original exact-head Actions run:** [41266979465](https://github.com/marius-patrik/GHCode/actions/runs/41266979465).
**Original browser outcome:** 18 passing / **8 failing** on Chromium, plus 24 passing Python tests. Formatting, typecheck/build and generated-document checks passed. Original browser acceptance was **red**; these counts are never to be reported as a passing acceptance suite.

| Original failure | Actual observed behavior | Classification of original assertion |
| --- | --- | --- |
| Anonymous after sign-out | The UI re-mounted synthetic `acme/private` and rendered its cached README. | Real identity defect; test incorrectly reopened forbidden content. |
| Account B, GitHub 404 | B re-mounted A's `acme/private` and rendered cached README. | Real identity defect; test incorrectly reopened forbidden content. |
| Editor close | Deferred 250-ms writer left no durable overlay after close. | Real data-loss defect; correctness permits a guarded, visibly unsaved close instead of immediate storage. |
| Request success / transaction abort | No committed overlay survived and no failure was shown. | Real acknowledgment/error defect; keep real IDB lifecycle. |
| Local commit abort | A committed projection survived without matching commit or retained staged input. | Real transaction atomicity defect. |
| Reload before debounce | Deliberately unpersisted text did not survive forced reload. | Invalid historical assertion for *unacknowledged* in-memory bytes; verify saved revisions and normal navigation guards separately. |
| Repository switch | Deferred private edit not in immediate overlay after changing repo. | Real lifecycle risk; correctness permits save-before-switch **or** a blocked switch with recoverable unsaved text. |
| Dockview move | Deferred edit absent in immediate overlay after tab movement. | Real lifecycle risk; verify live ownership and eventual persistence or explicit unsaved retention instead. |

### Test profile separation

- **Historical reproduction:** `.github/tests/ghc00-v018-reproduction.spec.ts`, an exact copy of the original browser probe file at the original PR head. It is excluded from default Playwright discovery. Explicit opt-in: `bunx playwright test --config=.github/tests/historical.playwright.config.ts`. It is expected red on v0.1.8; it is **not** an acceptance gate.
- **Current expected behavior:** `.github/tests/ghc00-integrity.spec.ts`; tests are phrased to pass on correct fail-closed implementation and correct document/transaction lifecycle, not on a specific store layout or a forbidden read.
- **Future migration acceptance:** `.github/tests/ghc00-migration.spec.ts`; seeds a complete synthetic v2 database and localStorage on a blank same-origin page, then checks the v3+ upgrade preserves all six legacy stores byte-for-byte and does not silently mount private legacy data. Re-entry must be idempotent. New v3 store count/names are intentionally unspecified.
- **Forensic inspector:** `.github/tests/ghc00-db-inspection.ts` opens the existing database without an explicit version; reads only finish when the real readonly transaction completes. This is raw test inspection, **not** an authorized application cache lookup or security boundary.
- **Identity fixtures:** GitHub `/user` for A and B uses stable distinct numeric IDs `10001` and `20002`; the B/anonymous test API refuses private endpoints with 404. The fixture contains no credentials.

### Acceptance and dependency classification

| Gate | Tests | Expected condition |
| --- | --- | --- |
| GHC-01 (#25) | Anonymous and B account-isolation probes; denied same-name reopen; A recovery | Must pass when principal/session scoping is integrated. |
| GHC-02 (#26) | Aborted successful request; aborted staged commit; quota exception; v2 -> v3 lossless/idempotent migration | Must pass only after transaction and migration corrections. |
| GHC-03 (#27) | Close guard / save; previously persisted reload; repository switch; Dockview transfer | Must pass after canonical document ownership and lifecycle guards. |
| Existing healthy application | Existing non-GHC browser tests and repository Python tests | Remain green; regression here is a separate defect or harness incompatibility. |

### Limitations and integration notes

Tests use one isolated Chromium browser context per case and synthetic GitHub responses; they do not prove isolation from same-origin hostile scripts, cross-tab revision fencing, true disk exhaustion, crash durability of unacknowledged memory, or a real authenticated GitHub session. The acceptance assertions reject both leaking private UI/cache reads and silently losing acknowledged work; physical existence of A's legacy data is tested separately from its accessibility by B/anonymous. For GHC-A03, align only synthetic principal IDs and app-level identity contract; do not create a competing identity service in these tests. Integrate the test PR with GHC-01/02/03 changes, preserve the historical profile, and keep default CI red until all required behavioral invariants are implemented.
