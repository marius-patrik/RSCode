# canvas PLAN

## Current Implementation State

Canvas is implemented as a Bun/React local app with source under `src/`.
It currently owns its local server, store, workspace persistence, filesystem
API, terminal websocket, readonly git API, and backend browser panes.

## Decisions Locked

- Canvas is the dev UI.
- Andromeda remains separate as the harness app.
- Workspace will wrap Canvas as an app surface.
- Shared backend state should move behind Mainframe.

## Next Milestone

Polish the workspace pane shell and keep `CanvasMount` stable for Workspace.

## Implementation Phases

1. Preserve and verify current Canvas WIP.
2. Keep `CanvasMount` export stable.
3. Separate UI state from local server/store calls.
4. Add Mainframe-backed client integration for workspaces, filesystem, panes,
   browser sessions, git metadata, and terminal metadata.
5. Keep standalone dev mode as a thin client where useful.

## Verification Checklist

- `bun run verify`
- Existing workspace, pane, browser, git, and terminal tests pass.
- `CanvasMount` renders inside Workspace.
- Mainframe-backed workspace persistence matches current behavior.
