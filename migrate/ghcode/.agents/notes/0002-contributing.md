---
status: published
---
# Contributing and architecture map

Feature PRs go to `development`; only a reviewed `development` PR can target `main`. Source requirements are in `.agents/requests/`, accepted architecture in `.agents/decisions/`, published README notes in `.agents/notes/`, and operative rules in `.agents/rules/`.

Generate the project documents with `python3 .github/scripts/generate_documents.py --write` and check with `--check`. Run `bun run check`, `bun run acceptance`, and Python test discovery for changes. All repository tests and support mocks belong below `.github/tests/`.

`src/workbench/` owns shell, tabs and layout; `src/workspace/` owns GitHub project state; `src/factory/` derives specification and difference projections; `src/tabs/` owns editor and GitHub views. `.github/workflows/` owns native deployment and release actions.
