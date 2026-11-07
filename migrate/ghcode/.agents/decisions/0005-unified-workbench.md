---
status: accepted
---
# Unified workspace and GitHub Pages publication

## Decision

One WorkspaceProvider and workbench shell own GitHub identity, file tree, source changes, Dockview tabs and status. FactoryProvider derives contract/architecture views and discrepancies; the native Explorer projects desired, observed or changed paths. Each perspective is a native Dockview tab type rendered inside the existing main surface, sharing the tab bar with editors and other tabs. The activity rail activates those same tabs. Persisted layouts without perspective tabs are migrated by adding native tabs; there is no overlay or second root.

Only validated `main` builds are uploaded as GitHub Pages Actions artifacts and deployed with `actions/deploy-pages`. No `gh-pages` staging branch is used. PR previews are intentionally disabled on the production origin: hosting untrusted PR JavaScript alongside authenticated browser state would expose origin-wide credentials and IndexedDB data. Separate-origin previews require an explicitly provisioned isolated host.

## Machine-readable architecture

```json
{
  "kind": "ghcode-architecture",
  "schema_version": "1.0.0",
  "scope": [
    "components"
  ],
  "components": [
    {
      "id": "CMP-001",
      "title": "Native workbench shell",
      "path": "src/workbench/shell.tsx"
    },
    {
      "id": "CMP-002",
      "title": "Project source state",
      "path": "src/workspace/context.tsx"
    },
    {
      "id": "CMP-003",
      "title": "Global desired/observed/delta state",
      "path": "src/factory/context.tsx"
    },
    {
      "id": "CMP-004",
      "title": "Central perspective",
      "path": "src/factory/workspace-view.tsx"
    },
    {
      "id": "CMP-005",
      "title": "Native Explorer",
      "path": "src/tabs/explorer-tab.tsx"
    },
    {
      "id": "CMP-006",
      "title": "Contract engine",
      "path": "src/factory/contracts.ts"
    }
  ],
  "policy": {
    "file_tree_complete": false
  }
}
```

## Consequences

No redundant project selectors, nested tab implementations, status bars or implementation runtime. All major main-area views are native Dockview tabs. The contract parser consumes the generated .agents docs, which compile from approved source records. Missing documentation is not evidence of missing code.
