# W02-R technical license and supply-chain evidence — 2026-11-03

**Status: INCOMPLETE — not a certified SBOM or license clearance.** This inventory was derived from source `package.json` and preserved license files in the GitHub repository, not an independently traversed installed dependency graph.

## Original source licensing

| Source | Root source LICENSE | Package metadata `license` | Direct runtime declarations | Direct development declarations |
| --- | --- | --- | ---: | ---: |
| DarkFactory-web root / RSCode | no root LICENSE at candidate branch | missing, package `private: true` | 14 | 6 |
| GHCode snapshot | GNU GPL v3 license text retained at `migrate/ghcode/LICENSE` | missing, package `private: true` | 19 | 9 |
| Canvas snapshot | GNU GPL v3 license text retained at `migrate/canvas/LICENSE` | missing, app package `private: true` | 27 | 12 |

The retained GPL-3.0 license texts are evidence of original code provenance, not a determination of who owns copyright or a license automatically applicable to the future combined application. Original Git ancestry and license files must remain intact. The owner must authorize a distribution-license policy and any compatible use of the inherited source before publishing an integrated product.

## Direct runtime dependency families observed

- **Root / RSCode:** React, Rsbuild, Tailwind, Monaco React wrapper, xterm and PTY frontend, Lucide, Playwright Chromium, Zod, and utility packages.
- **GHCode:** React, Monaco core/React, Dockview, PDF.js, Radix, Dagre, animated Lucide, Motion, Markdown and GFM.
- **Canvas:** React, Monaco core/React, Dockview, React Flow, Zustand, Radix, Sonner, i18n, Wouter, colord, Tailwind and animation dependencies.

These are names from declared direct dependencies, *not* a transitive inventory. No direct or transitive dependency license was verified against its installed package metadata and no SPDX expression was attested.

## Required independent release evidence (NOT RUN)

1. Install each source against committed frozen lockfiles and inspect **all resolved runtime and development packages**, including transitive variants, using their installed package.json and license files. Generate an SPDX or CycloneDX SBOM with package versions, hashes and source URLs, record the exact tested revision, and separately validate metadata ambiguities.
2. Record licenses and notices for bundled Chromium/Playwright executables, platform native components and any shipped redistributables. Check exact downloaded binary revision and archive checksums on Windows x64, Linux x64, macOS x64 and macOS ARM64.
3. Inspect asset and font files, icon packages, static brand assets, WOFF/TTF glyph licenses and third-party images; distinguish generated assets from independently authored source. Include required attribution and notices in distributions.
4. Identify missing or invalid SPDX metadata, incompatible bundling conditions and copyright holders; request owner-approved distribution policy/legal review. Do not attempt to resolve these by removing source license texts or silently relicensing the project.

**Gate:** T014 remains **BLOCKED**. No SBOM was generated in this wave. No production binary, release artifact, Pages deployment or repository deletion is authorized.
