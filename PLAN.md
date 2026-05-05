# canvas PLAN

## Current Implementation State

Canvas is implemented as a Bun/React local app with source under `src/`.
It currently owns its local server, store, session persistence, filesystem API,
terminal websocket, and graph execution.

## Decisions Locked

- Canvas is the dev UI.
- Andromeda remains separate as the harness app.
- Workspace will wrap Canvas as an app surface.
- Shared backend state should move behind Mainframe.

## Next Milestone

Preserve current behavior, then expose a `CanvasMount` component for Workspace.

## Implementation Phases

1. Preserve and verify current Canvas WIP.
2. Add package export for `CanvasMount`.
3. Separate UI state from local server/store calls.
4. Add Mainframe-backed client integration for sessions, filesystem, graph, and
   terminal metadata.
5. Keep standalone dev mode as a thin client where useful.

## Verification Checklist

- `bun run verify`
- Existing session, panel, and graph tests pass.
- `CanvasMount` renders inside Workspace.
- Mainframe-backed session persistence matches current behavior.
