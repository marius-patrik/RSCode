# canvas PRD

## Product Role

Canvas is a standalone local UI for workspace, filesystem, terminal, browser, and git work.

## Target Users

- The platform owner doing local development and inspection.

## Core Workflows

- Browse folders and files.
- Open and edit files in managed Monaco panes.
- Open tmux-backed terminal panes rooted at local directories.
- Inspect readonly git status and diffs for repositories under a workspace.
- Open live CDP streamed Chromium browser panes with persisted workspace profiles, navigation history, and in-page URL changes.
- Use browser back, forward, and reload controls from the pane toolbar.
- Preserve multiple workspaces with tiled and canvas pane layouts.

## In Scope

- Local filesystem tree browsing.
- Monaco editor panes.
- Tmux-backed terminal panes with direct PTY fallback when tmux is unavailable.
- Workspace persistence.
- Tiled, floating, and canvas pane layouts.
- Readonly git repository, status, and diff panes.
- Live CDP streamed Chromium browser panes with history controls.
- Local development with Rsbuild HMR and a watched Bun API process.
- `CanvasMount` as an internal embeddable Canvas API.

## Out Of Scope

- AI provider integration.
- Agent harness integration.
- Messaging.
- Reabsorbing Andromeda.
- Native DOM browser embedding; browser panes are streamed Chromium pixels.
- Advanced browser file chooser, download, and dialog handling.

## Success Criteria

- A fresh clone runs locally at `http://127.0.0.1:4567`.
- Workspace layout, pane metadata, browser history, git pane selection, terminal pane cwd, and tmux-backed terminal sessions persist across Canvas server restarts.
- `bun run dev` provides React HMR and Bun API watch mode.
- Existing verification commands pass before release.
