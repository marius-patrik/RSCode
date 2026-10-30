# canvas

Canvas is a standalone local workspace and pane-based dev UI.

## Source Of Truth

- [PRD.md](./PRD.md) defines the product intent.
- [PLAN.md](./PLAN.md) defines the implementation plan.

The app runs as a local Bun server with a React frontend served from `dist/web`.

## Role

- Provides local filesystem browsing and editing.
- Provides tiled panes, canvas panes, tmux-backed terminals, readonly git inspection, and live CDP streamed Chromium browser panes.
- Exports `CanvasMount` as an internal embeddable Canvas mount surface.

## Current Status

Implemented Bun/React app with workspace persistence, Monaco editor panes,
tmux-backed terminal panes, filesystem APIs, readonly git panes, live CDP streamed
Chromium browser panes with persisted history, and verification scripts.

## Run

Development uses two local processes so frontend HMR and backend watch mode both work:

```sh
bun install
bun run dev
```

- Web UI: `http://127.0.0.1:4567`
- Bun API: `http://127.0.0.1:4568`
- Rsbuild proxies `/api`, API WebSockets, and `/health` from the web server to the API server.

Production-style local serving builds `dist/web` and serves the bundle from the Bun server:

```sh
bun run start
```

The default production URL is `http://127.0.0.1:4567`.
This command intentionally does not provide frontend HMR; use `bun run dev` for hot reload.

Useful port overrides:

- `CANVAS_PORT=4570 bun run dev` moves the Rsbuild web server to `4570` and the API to `4571`.
- `CANVAS_DEV_API_PORT=4678 bun run dev` overrides only the watched API server port.

## Runtime Interfaces

- HTTP API actions are exposed under `/api/{namespace.action}`.
- `browser.history` accepts `{ workspaceId, paneId, direction: "back" | "forward" }`.
- Terminal panes connect to `/api/terminal/spawn?paneId=...&cwd=...`.
- Terminal client-to-server WebSocket messages are JSON envelopes: `{ type: "input", data }` and `{ type: "resize", cols, rows }`.
- Terminal server-to-client output is raw PTY text for xterm.
- Browser panes connect to `/api/browser/stream?workspaceId=...&paneId=...`.
- Browser client-to-server WebSocket messages include viewport resize, mouse, wheel, key, text, paste, reload, and navigation envelopes.
- Browser server-to-client WebSocket messages include live CDP screencast frames, state updates, and errors.
- Browser in-page URL changes are persisted into pane history. `about:blank` is stored as `about:blank`, not the internal blank data URL.

## Persistence

Workspace, pane layout, browser history, settings, and pane metadata persist under `CANVAS_HOME` or `~/.canvas-dev-space`.
Terminal panes persist their cwd and pane metadata. Live terminal processes and scrollback survive Canvas server restarts through tmux-backed sessions keyed by pane id.
If tmux is unavailable or disabled, terminal panes fall back to direct PTYs and show a warning that live process persistence is disabled.

## Known Limitations

- Browser panes stream Chromium pixels over CDP; they are not native DOM embedding.
- Browser file chooser, download, and dialog handling is basic.

## Verify

```sh
bun run typecheck
bun run lint
bun run build:web
bun test src
bun run test:browser
bun run verify
```

## Preview release and validation

The first release is a local-only v0.1.0 preview; it provides the source and built web UI, not native installers or an internet-facing service. See [release notes](./RELEASE_NOTES.md) and the [readiness audit](./UX-AUDIT.md).

The verification workflow runs a real Chromium startup smoke and uploads `canvas-visual-smoke` artifacts with desktop and compact-viewport screenshots. These automated captures do not replace hands-on review of editor, browser, terminal, filesystem or mobile ergonomics.

Canvas accepts privileged API requests only on loopback hosts, rejects external web origins and requires JSON POST for all `/api/*` actions. Do not reverse-proxy or expose Canvas publicly; no remote-user authentication system is implemented.

The initial `v0.1.0` release workflow verifies the entire application after a merge to `main`, then publishes an immutable preview tag and source/web bundle. Later pushes skip this one-time workflow once that tag exists.
