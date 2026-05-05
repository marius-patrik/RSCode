# canvas PRD

## Product Role

Canvas is the dev UI for local workspace, filesystem, terminal, browser, and git work.

## Target Users

- The platform owner doing local development and inspection.

## Core Workflows

- Browse folders and files.
- Open and edit files in managed Monaco panes.
- Open terminal panes rooted at local directories.
- Inspect readonly git status and diffs for repositories under a workspace.
- Open backend Chromium browser panes with persisted workspace profiles.
- Preserve multiple workspaces with tiled and canvas pane layouts.

## In Scope

- Local filesystem tree browsing.
- Monaco editor panes.
- Terminal panes.
- Workspace persistence.
- Tiled, floating, and canvas pane layouts.
- Readonly git repository, status, and diff panes.
- Backend browser panes.
- `CanvasMount` export for Workspace.
- Moving shared state behind Mainframe.

## Out Of Scope

- AI provider integration.
- Agent harness sessions.
- Messaging.
- Reabsorbing Andromeda.

## Success Criteria

- Canvas remains usable standalone during migration.
- Workspace can mount Canvas.
- Mainframe-backed state preserves current workspace and pane behavior.
