# Canvas v0.1.0 readiness audit

Date: 2026-10-30  
Target: RSCode `main` following browser-fix PR #17  
Scope: existing local Bun/React application, not the unrelated static repository Canvas

## Evidence and method

Source inspection: `src/client/{Canvas,App,Dock,ActionsMenu,BrowserPane,FilePanes,MonacoEditor,TerminalNode}.tsx`, `src/client/paneLayout.ts`, `src/server/{server,store,browserService}.ts`, and existing Bun tests. Focused integration checks are added under `src/tests/` and run on GitHub-hosted Chromium. Screenshots are uploaded as workflow artifacts.

**Limit:** Source inspection and browser smoke assertions are not a substitute for human review of the captured interface. No desktop device or interactive cloud-browser session was available for a manual visual walkthrough.

## Findings and status

| Priority | Surface | Observed problem | Resolution |
| --- | --- | --- | --- |
| Critical | Loopback HTTP/WebSocket API | Wildcard CORS and a GET parameter path could invoke mutating API actions from untrusted web origins or embedded resources | Reject non-loopback Origin/Host, remove wildcard CORS, require JSON POST for all `/api/*` actions; integration tests |
| High | File explorer | `createFsFile` used default truncating file writes, silently replacing an existing file | Use exclusive create (`wx`); preservation regression test |
| High | Workspace persistence | JSON workspace/index writes truncated files in place; crashes could corrupt saved state | Write unique sibling temporary file then atomically rename |
| High | Editor pane | Closing a dirty editor immediately removed its unsaved draft | Require explicit destructive confirmation before closing |
| Medium | Context menu | At small window sizes menu coordinates could become negative and menu could escape viewport | Clamp to viewport; responsive maximum size; keyboard-friendly dialog semantics |
| Medium | Monaco | Editor always forced `vs-dark` despite light workspace themes | Synchronize editor theme with applied workspace theme |
| Medium | Browser frame | Resized frame metadata did not necessarily match PNG pixels | Fixed in PR #17 and verified by Chromium regressions |
| Medium | Visual regression coverage | Previous suite checked APIs but never launched the actual desktop UI | New Playwright Chromium startup/navigation smoke + desktop/mobile snapshots |
| Deferred | Browser | Basic file picker, download and native dialog support | Documented product limitation; requires separate feature scope |
| Deferred | Terminal | tmux unavailable falls back to a nonpersistent direct PTY | Explicitly documented and surfaced as a warning |
| Deferred | Git | Repository inspection is read-only | Deliberately scoped limitation |
| Deferred | Native packaging | No installers for macOS/Windows/Linux yet | v0.1.0 releases source plus prebuilt web assets, not native installers |

## First-release gates

- `bun run verify`: typecheck, Biome, Rsbuild, Bun unit/integration and real Chromium tests
- GitHub `Verify` and DarkFactory governed checks must succeed on the readiness PR
- Visual smoke artifacts generated for both desktop and 390px viewport
- Existing Canvas features preserved; no dependency on the unmerged DarkFactory PR #16
- Initial release must be tagged to the validated `main` SHA and identified as a **preview**, not an independently security-audited network service
- Release page must include run instructions and limitations

## Required manual follow-up before a stable production claim

Review screenshots, navigate Explorer/editor/browser/terminal with pointer and keyboard on an actual development machine, inspect accidental filesystem mutations and browser download workflows, test macOS/Windows packaging, and exercise process restarts. GitHub CI tests only its runner environment and cannot prove every device-specific behavior.
