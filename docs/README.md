# canvas

Canvas is the local workspace and pane-based dev UI for Commonwealth.
It is intentionally separate from Andromeda, which owns agent harness work.

## Source Of Truth

- [PRD.md](./PRD.md) defines the product intent.
- [PLAN.md](./PLAN.md) defines the implementation plan.
- Platform context: [Commonwealth PRD](https://github.com/marius-patrik/commonwealth/blob/main/PRD.md), [PLAN](https://github.com/marius-patrik/commonwealth/blob/main/PLAN.md), [ROADMAP](https://github.com/marius-patrik/commonwealth/blob/main/ROADMAP.md).

## Role In Commonwealth

- Provides local filesystem browsing and editing.
- Provides tiled panes, canvas panes, terminals, readonly git inspection, and backend browser panes.
- Exports `CanvasMount` for Workspace.
- Moves shared backend state behind Mainframe over time.

## Current Status

Implemented Bun/React app with workspace persistence, Monaco editor panes,
terminal panes, filesystem APIs, readonly git panes, backend Chromium browser
panes, and verification scripts.

## Run

```sh
bun install
bun run dev
bun run start
```

Default URL: `http://127.0.0.1:4567`.
From the Commonwealth root, prefer `bun run dev:canvas`.

## Verify

```sh
bun run typecheck
bun run lint
bun run build:web
bun test
bun run test:browser
bun run verify
```
