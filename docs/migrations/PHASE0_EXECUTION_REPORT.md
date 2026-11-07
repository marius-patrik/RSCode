# DarkFactory-web — Phase 0 execution and evidence

**Owner:** sole integration orchestrator · **Snapshot:** 2026-11-02 Europe/Prague · **Canonical:** [#31](https://github.com/marius-patrik/DarkFactory-web/issues/31)  
**Disposition:** IMPLEMENTED IN INTEGRATION BRANCH, **P0 GATE CONDITIONAL / NOT CLOSED** until the release-license decision and remaining source/production acceptance boundaries are resolved.

## Proven changes and exact-head verification

| Task | Disposition | Proof |
|---|---|---|
| T005 | **PASS — exact inventory** | `PHASE0_REPOSITORY_INVENTORY.json` captures named branch SHAs, open/closed PRs/issues and release/asset inventory for all three repositories. |
| T006 | **PASS — integrated into prototype branch** | RSC-03 PR #25 `65331558418c108f889910c05e7ed7f746e108e1` includes and supersedes RSC-01 PR #23 (ancestor). Original final-head Verify `41301494485` and DarkFactory checks green. Merged six security source/test files into integration ancestry at `45266cb399ad1a81fbe22c8992daa167b5f044d8`, preserving the original PR-head commit as a second parent. Full integration Verify `41363993190` passed. **No main/release mutation.** |
| T007 | **PASS — integrated and tested** | Replaced prematurely set `screencastStarted` flag with a shared awaited startup promise; added simultaneous subscriber, failure/retry and shutdown-during-start tests. Final code revision `2d26ffd8f0bdee64a2940b08b658ea68ba5f9842`; full Verify `41364262749` passed. |
| T008 | **TRIAGED; distribution acceptance pending P4** | RSC-05 PR #28 `6ed334bcad6e89a1837c299937c4c50207904541` has real Linux/macOS ARM64/macOS x64 acceptance; Windows x64 native run `41304766239` remains red for drive paths, PTY/shutdown and Chromium probe. Issues #27/#29/#30 retained. No unsafe release. |
| T009 | **PASS for source config / production rollout pending** | Corrected renamed repository identity in `repo.dfconfig` and matching `.darkfactory/installation.json` receipt on integration branch. Recomputed repo config SHA-256 `6f22da946696dfbf471e9a35829895b09edee558fe4871993d3baaecc3a96383`. Added automated receipt owner/source/ref/filehash verification; `Verify` run `41364591620` **SUCCESS** on `a27d1d51bb4ef0b944223aa8119a3f7be069e0f0`. Existing legacy board target `RSCode` deliberately left unchanged pending actual Project migration; main remains unchanged. |
| T010 | **PASS — Git ancestry verified** | GitHub Actions `41363832152` verified all 25 distinct GHCode original tip objects reachable, matching 30 original ref records (6 branches, 15 PR heads, 9 tags). |
| T011 | **PASS — full template history preserved** | Source `DarkFactory-template` manifest `TEMPLATE_GIT_HISTORY.json` preserves 47 refs (6 branches, 29 PR heads, 12 tags), 43 distinct source commit tips, including Canvas PR #41 `bf17d45c...` and D02 PR #42 `5f462ea6...`. Multi-parent history-only commit `53a2e71f1771179139724dadde6f675fea0713b8`; no original SHA rewritten and no source code activated. |
| T012 | **PASS — independent backup** | GitHub Actions `41363832152` produced a Git bundle and proved `git bundle verify`, a fresh `git clone --mirror`, SHA reachability for **68** GHCode+template original tip objects and `git fsck --connectivity-only`. ZIP artifact ID `13106985033`, 58,381,826 bytes, ZIP SHA-256 `e81c2d09601111b63432309751234fe9a96161a8c6834a48c79ef1ecf9d8b8f3`. Uploaded off GitHub to private Google Drive: [three-source Git backup](https://drive.google.com/file/d/1bemv__OtVyKoDVCAO1NllB8406G1JtYx/view). Drive metadata and full raw-file download readback verified exact ZIP SHA-256 against the GitHub Actions archive; ZIP integrity passed. The original Git bundle, its checksum, and additional manifests are **inside** the ZIP. |
| T013 | **PASS — independently stored hosted records** | Exported public source issues, PR review and conversation comments, branches, releases, available Actions metadata and **all nine GHCode downloadable release assets**; zero API/asset errors in workflow `41363832152`. ZIP artifact ID `13106581237`, 8,452,450 bytes, ZIP SHA-256 `8d8e84844bb6f43a0c60890190cd2fb4dea4068e1a6e0a873ec7acf8d9d2e29a`. Uploaded off GitHub: [source metadata and release backup](https://drive.google.com/file/d/1gOQCTq5GFQBi1TY1kD4uBwYXQiuiZGIC/view); Full raw-file Google Drive download readback SHA-256 matched the original Actions ZIP; ZIP integrity passed. Historical expired Actions artifacts and administrator-only settings are separately identified as unavailable. |
| T014 | **BLOCKED — explicit distribution decision required** | Both GHCode and DarkFactory-template include GNU GPL v3 LICENSE texts. DarkFactory-web's inspected main root has no LICENSE. `PHASE0_LICENSE_REVIEW.md` records compatibility, attribution, source-offer and dependency SBOM gates. Do not ship combined GPL-covered code or claim dependency SPDX review complete until final license/rights decision. |
| T015 | **PASS for feature/PR publication isolation** | DarkFactory-template PR #42 final SHA `5f462ea6e73c570e483149d6846dcc9190c09d51`, exact-head CI passed. Fast-forwarded source `development` to this commit; GitHub automatically recognized PR #42 as **merged**. The active Canvas quality workflow now has **no Pages deploy job and no Pages/OIDC write scope**. The historical site remains public and must be retired when the successor passes acceptance. |
| T016 | **PASS — source crosswalk, target implementation pending** | `TRI_SOURCE_CAPABILITY_CROSSWALK.md` inventories 36 capabilities, original source paths, proposed sole target owners, keep/adapt/replace status, acceptance tests and security precedence. These are **proposals**, not already-implemented modules. |

## Integration/release truth

- **Integrated prototype target:** `integration/ghcode-consolidation` latest verified at `a27d1d51bb4ef0b944223aa8119a3f7be069e0f0`, full Verify PASS at `41364591620`. GHCode history and template history are in ancestry; RSC-03 security and RSC-04 screencast fixes are in the **tree**.
- **Production `main` is unchanged:** `39341ce5f8459b834c8e20b5227c25980078a87e`. No final distribution, Pages publication or GHCode deletion was performed.
- **PR #25/23 and #28 remain open:** preserve original review and distribution evidence until target integration/release acceptance. GHCode source PR #34 is independently security-rejected; its history is preserved, not activated.
- **Template PR #42 merged into development:** production Pages release still requires separate security verification and eventual retirement.
- **Neither GitHub source repository has been deleted**, and no user browser state has been silently migrated.

## Additional operational blocker: pinned DarkFactory agent workflows

**Observed on production main (not caused by the integration branch):** `DarkFactory Runtime` issue-comment run `41364986240` is **FAILURE**, even though the isolated integration `Verify` workflow is green.

- `governed / approvals / on-approval`: failed **Install the pipeline runtime** because the pinned DarkFactory `9ec623964a4d441097bbc85fe8366a9447b82b93` dependency's `bun.lock` has `lockfileVersion: 2` but the reusable workflow installs Bun `1.3.11`; the frozen install reports `UnknownLockfileVersion`.
- `governed / agent / run-agent`: failed **Delegate to Central DarkFactory** with GitHub API `HTTP 403 Resource not accessible by integration`, using a repository token without central repo `repository_dispatch` permission. Logs also show `HAS_APP_KEY: false`. Do not claim issue-label dispatches executed or agents completed anything.
- Repeated issue comments can create additional failing Actions runs. Agent `Request` labels were removed from bounded issue #34/#35/#36 after manual work; #34/#35 are closed, #36 remains a licensing blocker.
- Corrective owner: upstream DarkFactory release/toolchain compatibility, central dispatch credential/installation permissions and the existing project governance issue #32. Do not weaken GitHub token boundaries, use broad PATs, or silently bump a pinned pipeline revision without verifying its controls.

**P0 release implication:** Direct repository integration and source-historical preservation are verified. **Automated DarkFactory agent dispatch and approval jobs are currently NOT OPERATIONAL**, and that operational defect remains explicitly open until its owner fixes and verifies the latest pinned workflow. This is independent of `T014` licensing blocker.

## Remaining Phase 0 exit blockers / ownership

1. **T014:** decide target license/redistribution terms for combining the two GPL-3.0 source projects, audit final dependency closure and required attribution. Technical assessment exists; no false legal green-light.
2. **T008:** Windows native package remains release-blocked by issues #29/#30, owned for later P4. Phase 0 triage is complete; it must not be called a passing native distribution.
3. **T009:** rename identity is repaired on the isolated integration branch and verified; final main/config and external Projects board transition follow P4.
4. **T015:** prevent reintroduction of legacy Pages publishing from the old template before retirement; current development isolation is verified, but release/main workflows and actual browser-origin transition are later P3/P5 work.
5. **Historical retention:** Drive backups independently exist. They must not be publicly shared or deleted before a future verified release; periodic refreshed backups are needed if source branches advance.

**P0 decision:** proceed to the canonical architecture contract (P1) for integration design, but do **not** claim entire Phase 0 complete or distribute GPL-source-derived binaries until T014 is resolved. No extra agent wave has been launched.
