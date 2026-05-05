# canvas PRD

## Product Role

Canvas is a standalone local UI for workspace, filesystem, terminal, browser, and git work.

## Target Users

- The platform owner doing local development and inspection.

## Core Workflows

- Browse folders and files.
- Open and edit files in managed Monaco panes.
- Open terminal panes rooted at local directories.
- Inspect readonly git status and diffs for repositories under a workspace.
- Open backend Chromium browser panes with persisted workspace profiles, navigation history, and in-page URL changes.
- Use browser back, forward, and reload controls from the pane toolbar.
- Preserve multiple workspaces with tiled and canvas pane layouts.

## In Scope

- Local filesystem tree browsing.
- Monaco editor panes.
- PTY-backed terminal panes.
- Workspace persistence.
- Tiled, floating, and canvas pane layouts.
- Readonly git repository, status, and diff panes.
- Backend browser panes with history controls.
- Local development with Rsbuild HMR and a watched Bun API process.
- `CanvasMount` as an internal embeddable Canvas API.

## Out Of Scope

- AI provider integration.
- Agent harness integration.
- Messaging.
- Reabsorbing Andromeda.
- Persisting live terminal processes or terminal scrollback across server restarts.
- Full browser embedding; browser panes are backend Chromium screenshots with input forwarding.

## Success Criteria

- A fresh clone runs locally at `http://127.0.0.1:4567`.
- Workspace layout, pane metadata, browser history, git pane selection, and terminal pane cwd persist across server restarts.
- `bun run dev` provides React HMR and Bun API watch mode.
- Existing verification commands pass before release.
