# Goal

Deliver GHCode as one cohesive GitHub-native workbench for project definition, repository inspection, evidence-based discrepancies and reviewed issue dispatch.

## Success criteria

- Overview, Specification, Delta and Repository are first-class native Dockview tabs in a permanently visible main tab strip, never a separate factory application or overlay.
- One project selector, one shared source tree, one editor system, one status bar and one coherent neutral palette.
- Sidebar collapse/resize does not remove the central workspace; overlays, menus and dialogs have consistent stacking.
- The selected repo provides its real .agents canonical specifications and architecture; there is no hardcoded demo project.
- All tests, fixtures and mocks live in .github/tests and assert real behavior and edge cases.
- GitHub Pages is deployed directly from validated main via Actions artifacts; no production-origin PR previews or gh-pages branch.
- Versioning uses immutable SemVer tags, development is integration, main is the gated release branch, and DarkFactory is a pinned submodule.
