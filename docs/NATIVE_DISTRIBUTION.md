# RSCode native preview distribution — issue #27

This branch builds **unsigned, non-notarized, portable extracted applications**,
not operating-system installers. The isolated workflow runs for pull requests
and manual dispatch only: it never creates a release or tag.

## Payload and native build

Each per-host-OS archive includes a native Bun executable (v1.3.11), the
frozen installed dependency tree, the Rsbuild web assets under dist/web,
the server source tree, and its own provisioned Playwright Chromium browser
under browsers/. The wrapper uses the bundled Bun, configures
PLAYWRIGHT_BROWSERS_PATH, and starts the unchanged Bun server. Users need
neither a repository clone, installed Bun, npm packages, nor browser downloads.

- macOS data: ~/Library/Application Support/RSCode
- Windows data: %APPDATA%\RSCode
- Linux data: $XDG_DATA_HOME/rscode or ~/.local/share/rscode
- CANVAS_HOME overrides the persistent data root.
- CANVAS_WORKSPACE_CWD overrides the initial workspace working directory.
- CANVAS_PORT defaults to 4567. Server is bound to 127.0.0.1 only.

Extract the archive into a writable application directory and run:

- macOS/Linux: ./canvas
- Windows: canvas.cmd

Archives are versioned by app version, operating system and architecture.
Replacing an extracted install folder does not touch the user data directory.
Do not delete the user data directory during upgrades.

macOS ARM64 and macOS x64 are separate distribution artifacts. On macOS,
Gatekeeper may block unsigned executables. Signing and notarization have
not been performed. On Windows, this is an unsigned command-driven portable
application, not an MSI, MSIX, or signed executable.

## CI acceptance and evidence

The native workflow uses Ubuntu 24.04 x64, Windows 2025 x64,
macOS 15 ARM64 and macOS 15 Intel runners. An architecture assertion
ensures each package is built on its real target platform, not merely
cross-compiled.

scripts/distribution/build.ts stages the payload. archive.py normalizes
archive metadata and emits a SHA-256 checksum. accept.py validates the
checksum, extracts to an independent temporary directory and exercises the
**installed bundled Bun**. It verifies entrypoint startup, the actual
frontend, HTTP health, real API workspace writes, Playwright Chromium launch,
a persistent Chromium profile, shutdown, restart and persisted workspace
state. A WebSocket PTY probe executes on Unix and tests actual terminal output.

Each CI job uploads the archive, checksum and detailed JSON acceptance report.
distribution.json records the exact source SHA, architecture, Bun version
and browser provision. No PASS is inferred from successful compilation.
Windows blocked capabilities are explicit in the report.

For a manual local build, set PLAYWRIGHT_BROWSERS_PATH to a fresh absolute
directory *before* installing Chromium and packaging:

    bun install --frozen-lockfile
    bunx playwright install chromium
    bun run build:web
    bun scripts/distribution/build.ts
    python3 scripts/distribution/archive.py
    python3 scripts/distribution/accept.py

Python 3.12 is required for the acceptance harness. Linux additionally
needs shared Chromium system dependencies; the Ubuntu CI runner provisions
them through the Playwright install-deps command. Other Linux distributions
are not verified by Ubuntu runner acceptance.

## Limitations and release integration

- Windows controlled workspace creation and filesystem operations are **BLOCKED**:
  src/server/store.ts safeAbsolute requires POSIX '/'-prefixed paths and rejects
  native Windows drive-letter paths. This is an integration-owned runtime fix.
- Windows terminal panes are **BLOCKED**: the existing server fallback tries
  /bin/bash and Windows Bun PTY compatibility has not been established.
- Windows shutdown is **BLOCKED** as graceful lifecycle acceptance:
  TerminateProcess is used rather than a confirmed graceful server shutdown.
- The Chromium probe starts a real packaged Chromium and opens the installed
  UI, but full application CDP streaming has not been independently verified
  by this packaging workflow.
- A SHA-256 checksum detects corruption but does not prove publisher identity
  or signing. Windows code signing and macOS notarization remain outstanding.
- No dedicated update installer, auto-update, rollback or migration engine
  has been introduced.
- Cross-run byte-for-byte reproducibility still requires controlled runner
  images, toolchain and browser binaries and an independent second build.
- Do not expose the application over a public network: it has privileged
  filesystem and terminal access, without remote-user authentication.
- This branch is based on the pre-security main SHA. Integration must include
  RSC-03 cross-origin WebSocket remediation (PR #25) and acceptance of the
  separate RSC-02 persistence work before a distributable release.

A platform is accepted only when its own uploaded evidence establishes all
required checks. A Windows build may exist but cannot be called fully verified
while terminal/lifecycle checks remain blocked.
