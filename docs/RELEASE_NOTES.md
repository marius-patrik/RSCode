# Canvas v0.1.0 — local preview

First versioned preview of the standalone RSCode Canvas development workspace.

## Features
- Workspaces with tiled, floating, and freeform panes
- Monaco editor and filesystem explorer
- tmux-backed terminal sessions (with direct-PTY fallback)
- Chromium browser panes with CDP frame streaming and navigation history
- Read-only Git repository/status/diff inspection
- Workspace persistence and customizable dark/light themes

## Release hardening
- Browser resize frames reflect encoded PNG dimensions
- Protection against cross-origin access to privileged local APIs
- JSON POST-only API, eliminating destructive actions via GET
- Existing-file creation no longer overwrites data
- Crash-resistant workspace JSON saves
- Confirmation before discarding unsaved editor drafts
- Context menus fit within small viewports and Monaco follows the active theme
- Real Chromium UI smoke tests and screenshot artifacts

## Install
Prerequisites: Bun 1.3.11+, Chromium (Playwright Chromium recommended), and optionally tmux for persistent terminals.

```bash
tar -xzf canvas-v0.1.0-source-web.tar.gz
cd canvas-v0.1.0
bun install --frozen-lockfile
bun run start
```

Open `http://127.0.0.1:4567`. For development with frontend HMR use `bun run dev`.

## Important limitations
Preview software intended for **local use only**. No external server binding or authenticated multi-user access. No native installers are included. Browser file pickers/downloads/dialogs remain basic; Git access is read-only. tmux is needed for terminal process persistence. Validate screenshots and workflows on your own system before using it for important work.
