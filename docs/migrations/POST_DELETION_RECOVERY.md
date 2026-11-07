# Post-deletion source recovery — 2026-11-02

**Scope:** documented GitHub source evidence, not a fresh independent offline backup certification.

The original `marius-patrik/GHCode` remote was deleted by the owner before W01. Never recreate it or rely on its endpoints. The source is preserved through the DarkFactory-web Git DAG, namespaced refs, and previously backed-up bundles/hosted metadata.

## Previously verified evidence

- The GHCode source manifest contains **6 branches, 15 pull-heads, 9 tags**: 30 ref records, 25 distinct commit tips.
- Canvas/template source manifest contains **6 branches, 29 pull-heads, 12 tags**: 47 ref records, 43 distinct commit tips.
- Multi-parent history checkpoint: `53a2e71f1771179139724dadde6f675fea0713b8`.
- Original GHCode source development commit `7801784b5bb596dcc720a48b7085443fc8f9ca3f`, main `534e2203425d91783111e5d02d5ec92649fec594`.
- Independent historical restoration was reported successful in Actions run [41363832152](https://github.com/marius-patrik/DarkFactory-web/actions/runs/41363832152) **before the deletion**.
- Original source backup ZIP: SHA-256 `e81c2d09601111b63432309751234fe9a96161a8c6834a48c79ef1ecf9d8b8f3`, 58,381,826 bytes, archived off GitHub.
- Original hosted-metadata ZIP: SHA-256 `8d8e84844bb6f43a0c60890190cd2fb4dea4068e1a6e0a873ec7acf8d9d2e29a`, 8,452,450 bytes, archived off GitHub.
- Historical Git tips tested by GitHub compare API against checkpoint `53a2e71f...` this wave: GHCode development, main, GHC-00, GHC-02; template development and Canvas #41, all returned `ahead` with `behind_by=0`. Additionally the new PR-only workflow at commit `fa5ab4c2d430dcc1ee8b4c6ca487873a3c656352` verified **all 30 GHCode ref records and 47 Canvas ref records as genuine commit objects and ancestors of HEAD**, along with the strict three subtree hashes and source file-count floors. See Actions run [41510178576](https://github.com/marius-patrik/DarkFactory-web/actions/runs/41510178576); the overall job failed because of a faulty bootstrap assertion and a metadata-note type bug *after* the ancestry checks passed. Both verifier defects have been corrected on the subsequent branch commit; a fresh PASS must be observed before M001 is closed. This does **not** independently certify restored backups.

## W01 certification limits

The W01 environment cannot clone GitHub or download and rehash the private backups; no Desktop Commander device was connected. Therefore **fresh post-deletion restoration: BLOCKED**. Online Git ancestry checks of 77/77 original ref records have passed at the above exact head, but the independent bundle recovery requirement remains separate. Original backup checksum readback was conducted in the earlier T012/T013 workflow, not repeated here. No claim of 68/68 newly reverified commit tips is made.

The proposed migration source commit includes the original preservation checkpoint as an **additional Git parent** while retaining `main` as the first parent, so its tracked production tree is not taken from the former integration branch.

Run `python3 migrate/verify.py` on an unrestricted Git checkout to validate all manifest tip objects with `git merge-base --is-ancestor`, then run with `--bundle <file>` to certify a fresh isolated restore. Compare the exact ZIP checksums above before extracting backup files. Do not declare M001 PASS until that post-deletion procedure is independently evidenced.

## W02 evidence reconciliation (2026-11-03)

The W01 PR #39 description states that the two private Drive ZIPs and an embedded bundle were downloaded, hash-verified, and restored after deletion. It reports embedded bundle SHA-256 `a315d67f07af523b7ba3540c2d18457df8d11c252e776fb6fb5c7c18f1f8de45`, `git bundle verify`, `git clone --mirror`, and `git fsck --full --strict`. However, this committed file historically said W01 could not perform that readback, and the publicly inspectable exact-head CI [41511237804](https://github.com/marius-patrik/DarkFactory-web/actions/runs/41511237804) did not supply `--bundle`. This document preserves the discrepancy; the PR narrative alone is **not** independent executable certification.

W02 does not have access to the private archives. A new post-deletion restore, ZIP SHA-256 recheck, and original PR/tag refs from an isolated bundle are **NOT RUN in W02**. The original backup hashes in the section above are expected values, not hashes remeasured now. The verifier now supports `--bundle /path/to/archive.bundle --bundle-sha256 a315d67f07af523b7ba3540c2d18457df8d11c252e776fb6fb5c7c18f1f8de45` and runs `git bundle verify` before offline clone/fsck/tip checks. Treat M001 as pending until an independent operator runs it with the private bundle and records output.
