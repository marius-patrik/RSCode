# canvas PLAN

## Current Implementation State

Canvas is implemented as a Bun/React local app with source under `src/`.
It owns its local server, store, workspace persistence, filesystem API,
tmux-backed terminal WebSocket, readonly git API, live CDP streamed Chromium browser panes, and Rsbuild
frontend development server.

Development is split across two watched processes:

- `http://127.0.0.1:4567`: Rsbuild dev server with React HMR.
- `http://127.0.0.1:4568`: Bun API server running with `bun --watch`.
- Rsbuild proxies `/api`, API WebSockets, and `/health` to the Bun API.

## Decisions Locked

- Canvas is a standalone local Bun/React app.
- `CanvasMount` remains available as an internal embeddable Canvas API.
- Browser pane history and tmux-backed terminal behavior are part of the local app surface.
- Live terminal processes and scrollback survive Canvas server restarts through tmux sessions keyed by terminal pane id.

## Implemented Milestone

- Removed stale external platform dependency language from docs.
- Kept `CanvasMount` stable as the internal embeddable mount.
- Added terminal sessions with JSON input/resize WebSocket messages.
- Added browser back, forward, and reload controls.
- Added `browser.history` API.
- Persisted browser URL changes caused by in-page interactions.
- Normalized the internal blank browser page back to stored `about:blank`.
- Added focused tests for browser history and terminal WebSocket behavior.
- Added `bun run dev` orchestration for Bun API watch mode plus Rsbuild HMR.
- Replaced browser screenshots with CDP `Page.startScreencast` streaming.
- Added viewport resize, mouse, wheel, keyboard, text, and paste forwarding for browser panes.
- Replaced direct shell PTYs with tmux-backed terminal sessions and a direct PTY fallback when tmux is unavailable.
- Added focused browser stream and terminal persistence tests.

## Known Gaps

- Browser panes stream Chromium pixels over CDP; they are not native DOM embedding.
- Browser file chooser, download, and dialog handling is basic.
- Production-style `bun run start` is single-process and serves `dist/web`; frontend HMR is intentionally only in `bun run dev`.

## Verification Checklist

- `bun run verify`
- Existing workspace, pane, browser, git, and terminal tests pass.
- `bun run dev` starts the Bun API watcher and Rsbuild dev server with HMR.
- `bun run start` builds `dist/web` before serving `http://127.0.0.1:4567`.
