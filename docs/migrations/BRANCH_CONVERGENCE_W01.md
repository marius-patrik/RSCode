# Branch-convergence inventory — W01 source candidate

The machine-readable per-branch table is `migrate/manifest.json > branchConvergence` (16 tracked source branches/features); the complete original PR/tag mappings are stored in `sourceHistory`.

| Source/ref | Source selection | Code | Tests | Disposition |
|---|---|---|---|---|
| RSCode main `39341ce5` | Full initial tree | Copied unchanged then security overlays | Root tests retained | Baseline, not a production release |
| RSC-03 PR #25 `65331558` | Six exact files from `integration/ghcode-consolidation@0e797adc` | Exact-origin, loopback, path/Chromium protections | Browser security + server tests copied | Accepted **source** from previously passed integration, not newly rerun |
| RSC-04 `2d26ffd8` | Latest integration `browserService.ts` | Single-flight screencast and retry | Concurrency tests copied | Previously verified; new snapshot untested |
| RSC-05 PR #28 `6ed334bc` | `scripts/distribution/`, native docs | Preserved macOS/Linux/Windows packaging code | Packaging accept/probe scripts preserved | Windows BLOCKED, other OS not rerun |
| GHCode main `534e2203` | Historical base | Not copied as active base | Historical via Git | Superseded by development |
| GHCode development `7801784b` | **Full source tree** | GitHub/Factory/workbench + GHC-01 identity | Identity and workbench tests retained | Selected source, not complete acceptance |
| GHC-00 `7b82a9f8` | `evidence/ghc00-historical-tests/` | Historical behavior retained separately | Original tests and fixtures copied | Needs semantic test reconciliation |
| GHC-01 `6d87f1c0` | Already a parent of development | Source authorization/isolation kept | Existing identity tests | Included |
| GHC-02 `49d194f7` | Original Git objects only | **Rejected** transactional v3, no active import | Tests preserved through DAG, not active | Privacy/export/push-queue defects |
| GHCode cleanup branch | DAG + manifest only | No needed app modifications established | No new tests | Unresolved history-only |
| Canvas PR #41 `bf17d45c` | Full standalone app and app-only tests | UI, graph, commands, preferences, isolated IndexedDB module | Native Chromium persistence tests retained | Persistence writer not activated; build not rerun |
| Template development `5f462ea6` | PR #42 CI fix remains upstream | No changes to selected PR41 app subtree | Workflow security test stays upstream | Future template retirement separately gated |
| Template main + stateless branch | DAG + manifest | Original prototype superseded by later Canvas app | Historical tests archived | No automatic functional equivalence asserted |

**Unresolved implementation:** GHC-03 lifecycle, safe GHCode v3 principal-scoped persistence, Windows paths/PTTY/Chromium distribution, template Pages retirement, Canvas pinned dependency graph and source-backed migration context. The existing template must remain intact until M007 acceptance and then have web-only retirement reviewed separately.
