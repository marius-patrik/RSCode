# Canvas v0.2.0 — local preview

This release builds on the v0.1.0 source/web preview without converting the local workspace into an internet-facing application.

## New functionality

- Interactive Canvas viewport with panning, anchored 25%–400% zoom, world-space dragging and resizing, and reset view.
- Local Git stage, unstage and commit actions directly from Source Control, with path validation and regression tests.
- Browser JavaScript dialog handling, native host file selection (8 MB total), and downloaded-file persistence.
- Deterministic initial PNG capture for Chromium pages that do not repaint.
- Debounced Canvas viewport persistence and isolated Chromium tests for reliability.

## Existing functionality

Monaco editing, workspace persistence, tiled/floating/canvas panes, tmux-backed terminals with direct PTY fallback, Chromium streaming and browser history, local filesystem exploration, and customizable themes.

## Install

Prerequisites: Bun 1.3.11+, Playwright Chromium, and optional tmux for process persistence.

```sh
tar -xzf canvas-v0.2.0-source-web.tar.gz
cd canvas-v0.2.0
bun install --frozen-lockfile
bun run start
```

Open `http://127.0.0.1:4567`.

## Limitations

Local-only preview; no multi-user authentication or remote deployment. The browser pane uses the host file picker with an 8 MB upload limit. No signed native installers are included. Terminal persistence requires tmux. Review the UX audit and test on your target OS before critical work.
