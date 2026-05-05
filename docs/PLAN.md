# canvas PLAN

## Current Implementation State

Canvas is implemented as a Bun/React local app with source under `src/`.
It owns its local server, store, workspace persistence, filesystem API,
PTY terminal WebSocket, readonly git API, backend browser panes, and Rsbuild
frontend development server.

Development is split across two watched processes:

- `http://127.0.0.1:4567`: Rsbuild dev server with React HMR.
- `http://127.0.0.1:4568`: Bun API server running with `bun --watch`.
- Rsbuild proxies `/api`, API WebSockets, and `/health` to the Bun API.

## Decisions Locked

- Canvas is a standalone local Bun/React app.
- `CanvasMount` remains available as an internal embeddable Canvas API.
- Browser pane history and PTY terminal behavior are part of the local app surface.
- Live terminal processes and terminal scrollback are runtime state, not persisted workspace state.

## Implemented Milestone

- Removed stale external platform dependency language from docs.
- Kept `CanvasMount` stable as the internal embeddable mount.
- Added PTY-backed terminal sessions with JSON input/resize WebSocket messages.
- Added browser back, forward, and reload controls.
- Added `browser.history` API.
- Persisted browser URL changes caused by in-page interactions.
- Normalized the internal blank browser page back to stored `about:blank`.
- Added focused tests for browser history and PTY terminal WebSocket behavior.
- Added `bun run dev` orchestration for Bun API watch mode plus Rsbuild HMR.

## Known Gaps

- Terminal cwd and pane metadata persist, but live PTY processes and scrollback do not survive a server restart.
- Browser panes are rendered through backend Chromium screenshots and forwarded input, not a full native embedded browser.
- Production-style `bun run start` is single-process and serves `dist/web`; frontend HMR is only in `bun run dev`.

## Verification Checklist

- `bun run verify`
- Existing workspace, pane, browser, git, and terminal tests pass.
- `bun run dev` starts the Bun API watcher and Rsbuild dev server with HMR.
- `bun run start` builds `dist/web` before serving `http://127.0.0.1:4567`.
