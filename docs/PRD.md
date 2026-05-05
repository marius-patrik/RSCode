# canvas PRD

## Product Role

Canvas is the dev UI for local filesystem work and executable graph workflows.

## Target Users

- The platform owner doing local development and inspection.

## Core Workflows

- Browse folders and files.
- Open and edit files in managed Monaco panels.
- Open terminal panels rooted at local directories.
- Create and run typed graph workflows for filesystem and terminal actions.
- Preserve multiple canvas sessions.

## In Scope

- Local filesystem tree browsing.
- Monaco editor panels.
- Terminal panels.
- Session persistence.
- Graph node creation, validation, and execution.
- Future `CanvasMount` export for Workspace.
- Moving shared state behind Mainframe.

## Out Of Scope

- AI provider integration.
- Agent harness sessions.
- Messaging.
- Reabsorbing Andromeda.

## Success Criteria

- Canvas remains usable standalone during migration.
- Workspace can mount Canvas.
- Mainframe-backed state preserves current session and graph behavior.
