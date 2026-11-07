# Phase 0 — License and distribution review

**Canonical owner:** DarkFactory-web #31, task T014. **Disposition: BLOCKED pending compatibility/compliance decision, not approved for distributing source merged from GHCode or DarkFactory-template.**

## Evidence directly inspected

| Repository | Source reference | Root LICENSE | Package metadata |
|---|---|---|---|
| `marius-patrik/DarkFactory-web` | `main@39341ce5f8459b834c8e20b5227c25980078a87e` | **Absent** in inspected root tree | `package.json`, `private: true`, `name: @commonwealth/canvas`; no package license field |
| `marius-patrik/GHCode` | `development@7801784b5bb596dcc720a48b7085443fc8f9ca3f` | **GNU General Public License v3 text** | `package.json`, `private: true`, `name: ghcode`; no package license field |
| `marius-patrik/DarkFactory-template` | `development@f647f7adc984db8231ba7ddf9ab19579ab340853` | **GNU General Public License v3 text** | Canvas `.github/app/package.json`, `private: true`, `name: @canvas/workspace` |

The source snapshots and original historical references are recorded in `PHASE0_REPOSITORY_INVENTORY.json`, `GHCODE_GIT_HISTORY.json`, and `TEMPLATE_GIT_HISTORY.json`.

## Interpretation and constraints

1. **Copying GPL-covered source into a combined work is not made license-neutral by importing it as Git ancestry.** Retain original attribution, notices, copyright and any applicable GPL obligations.
2. **Git ancestry and separately distributed runtime source are different.** A history-only commit with the original projects as parents does not by itself mean the original source is executing in the target; assess obligations for the actual combined distributed application and source inclusion.
3. **Distribution is an explicit gate.** If covered GPL-3.0 code is integrated into a combined distributed application, confirm compatible distribution licensing, availability of complete corresponding source where required, relevant notices, license text, and conditions for installers/binaries.
4. **No root LICENSE file in DarkFactory-web main is not a grant of unrestricted reuse or a proprietary license.** Clarify intended target licensing and all imported contributions before release.
5. **Dependency licenses require their own audit.** The three package manifests contain React, Rsbuild, Monaco, Radix, Dockview, Motion, Playwright/Chromium, pdfjs, terminal libraries, i18n and graph dependencies with varying versions. Their SPDX metadata, transitive licenses, bundled native Chromium terms, fonts and release-notice requirements have **not** been independently enumerated or certified here.
6. **No legal conclusion about all contributors' rights is established.** Repository ownership does not alone prove every third-party asset is relicensable. Resolve this with the relevant rights holders/legal adviser when necessary.

## Executable completion requirements for T014

- [x] Inspect top-level source LICENSE texts and package identity for the three source revisions.
- [x] Record blockers and avoid falsely claiming automatic compatibility.
- [ ] Generate a lockfile-resolved dependency license/SBOM inventory for the final combined `bun.lock`; identify any incompatible or unknown license.
- [ ] Confirm provenance and license for imported assets (icons, animations, fonts, Chromium, native binaries), including transitive artifacts.
- [ ] Decide and commit the target repository's intended distribution license and required notices/attribution, with contributor rights documented.
- [ ] Verify application, source archive and native release include required license/copyright/source-offer materials.
- [ ] Independently review the final artifact and published source for the chosen obligations.

**Current T014 status: PARTIAL / RELEASE-BLOCKING.** This report is an evidence-based technical checklist, not legal advice or approval to redistribute.
