# Phase 0 — Tri-source capability crosswalk

**Canonical:** DarkFactory-web #31, tasks T016/T017–T045. **Status:** SOURCE REVIEW COMPLETE; target implementation and acceptance NOT STARTED.  
**Source snapshots:** DarkFactory-web main `39341ce5f8459b834c8e20b5227c25980078a87e`; GHCode development `7801784b5bb596dcc720a48b7085443fc8f9ca3f`; DarkFactory-template development `f647f7adc984db8231ba7ddf9ab19579ab340853`. Unique unmerged work is in the phase-0 inventory and history manifests.

**Prefixes:** `web:` = DarkFactory-web; `gh:` = GHCode; `template:` = DarkFactory-template. Proposed target paths are architectural destinations, **not claims that these files already exist**.

| # | Capability | Existing sources | Single target owner | Decision | Acceptance proof |
|---:|---|---|---|---|---|
| 01 | Local workspace CRUD/persistence | `web:src/server/store.ts`<br>`web:src/shared/schema.ts` | `src/server/store.ts` | **KEEP** | Local workspace CRUD, restart/corrupt-write recovery |
| 02 | Local filesystem boundary | `web:src/server/api.ts`<br>`web:src/shared/paths.ts` | `src/server/api.ts` | **KEEP/HARDEN** | Traversal, symlinks, create/read/write/delete, Windows drives |
| 03 | Local Git source control | `web:src/client/GitPanes.tsx`<br>`web:src/server/api.ts` | `src/server/api.ts + provider/local-git` | **KEEP/ADAPT** | Status/stage/commit/diff and destructive-path guard |
| 04 | Terminal/PTY | `web:src/client/TerminalNode.tsx`<br>`web:src/server/server.ts` | `src/server/server.ts` | **KEEP/HARDEN** | Terminal spawn/reconnect/Windows PTY/stop |
| 05 | Chromium/browser screencast | `web:src/server/browserService.ts`<br>`web:src/client/BrowserPane.tsx` | `src/server/browserService.ts` | **KEEP/HARDEN** | Exact-origin WS, CDP, concurrent startup, recovery |
| 06 | Native distribution | `web:scripts/distribution/** (PR #28)` | `scripts/distribution/**` | **KEEP/VERIFY** | macOS x64/arm64, Windows x64, Linux x64 acceptance |
| 07 | Workbench root and scene | `web:src/client/App.tsx`<br>`web:src/client/Canvas.tsx` | `src/client/App.tsx + one shell` | **KEEP/ADAPT** | One root, single status/toolbar, keyboard/mouse operation |
| 08 | Pane model, docking, splits | `web:src/client/Dock.tsx`<br>`gh:src/workbench/surface.tsx`<br>`template:.github/app/src/DockCanvas.tsx` | `src/client/paneLayout.ts + PanelService` | **ADAPT** | Tabs, close, split, drag, restore, no nested Dockview |
| 09 | Workspace lifecycle and resource identity | `web:src/shared/schema.ts`<br>`gh:src/workspace/identity.ts`<br>`gh:src/workspace/model.ts` | `src/shared/resource-identity.ts + WorkspaceService` | **ADAPT** | Local vs GitHub resource isolation across account/ref changes |
| 10 | Monaco editing | `web:src/client/MonacoEditor.tsx`<br>`gh:src/tabs/editor-tab.tsx`<br>`template:.github/app/src/Monaco.tsx` | `src/client/editor/* + DocumentService` | **ADAPT** | One model per resource, view sharing, undo, dirty guards |
| 11 | Document lifecycle persistence | `gh:src/workspace/storage.ts`<br>`template:.github/app/src/persistence/indexeddb.ts (PR #41)` | `src/services/document-service.ts` | **REIMPLEMENT from contracts** | Revision CAS, concurrent windows, quota, crash, no stale save |
| 12 | GitHub auth and principal | `gh:src/github/auth-controller.tsx`<br>`gh:src/github/auth.ts`<br>`gh:src/workspace/identity.ts` | `src/providers/github/auth.ts` | **ADAPT/HARDEN** | PKCE/OAuth, account switch, anonymous isolation, broker callbacks |
| 13 | GitHub API client | `gh:src/github/client.ts`<br>`gh:src/workspace/context.tsx` | `src/providers/github/client.ts` | **ADAPT** | Scoped permissions, paging, rate-limit/error, ref selection |
| 14 | Remote GitHub tree and blob | `gh:src/tabs/explorer-tab.tsx`<br>`gh:src/tabs/resource-view.tsx` | `src/providers/github/repository.ts + existing explorer` | **ADAPT** | Selected account/repository/ref, blob and binary handling |
| 15 | Remote Git staging and push queue | `gh:src/workspace/storage.ts`<br>`gh:src/tabs/source-control-tab.tsx` | `src/providers/github/working-tree.ts` | **REPAIR/ADAPT** | Nonpushed commit preservation, CAS, recoverable retry |
| 16 | GitHub Issues | `gh:src/tabs/github-issues-tabs.tsx` | `src/panes/github/issues.tsx` | **ADAPT** | Authenticated list, issue navigation, create permission gate |
| 17 | GitHub Pull Requests | `gh:src/tabs/github-pr-tabs.tsx` | `src/panes/github/pull-requests.tsx` | **ADAPT** | PR list, review details, diff, action authorization |
| 18 | GitHub workflows/runs | `gh:src/tabs/github-actions-tabs.tsx` | `src/panes/github/actions.tsx` | **ADAPT** | Run inspection/log UI, no implicit repo writes |
| 19 | GitHub projects/branches/releases/commits | `gh:src/tabs/github-repo-tabs.tsx` | `src/panes/github/repository.tsx` | **ADAPT** | Real paged repo entities, safe redirects |
| 20 | Factory desired/observed/delta | `gh:src/factory/contracts.ts`<br>`gh:src/factory/context.tsx`<br>`gh:src/factory/workspace-view.tsx` | `src/features/factory/*` | **ADAPT** | Missing vs unverified distinction, no invented evidence |
| 21 | Issue drafting / review dispatch | `gh:src/factory/contracts.ts`<br>`gh:src/factory/workspace-view.tsx` | `src/features/factory/issue-drafts.ts` | **ADAPT** | Human review before authenticated GitHub mutation |
| 22 | Source-backed repository overview | `template:.github/app/src/Canvas.tsx`<br>`template:.github/app/scripts/generate-context.mjs` | `src/features/canvas/repository-overview.tsx` | **ADAPT** | Uses current selected repo/ref, no template hardcode |
| 23 | Markdown/source relationships | `template:.github/app/src/Canvas.tsx`<br>`gh:src/renderers/registry.tsx` | `src/features/canvas/graph.tsx` | **ADAPT** | Bounded graph, relative Markdown links, file provenance |
| 24 | Source document inspector/search | `template:.github/app/src/Canvas.tsx`<br>`gh:src/tabs/search-tab.tsx` | `src/features/canvas/inspector.tsx` | **ADAPT** | Search/filter/read documents without duplicate source store |
| 25 | Document renderers (PDF/MD/media) | `gh:src/renderers/registry.tsx`<br>`gh:src/pdf-document.tsx` | `src/renderers/*` | **ADAPT** | MIME-safe loading, PDF worker, binary size bounds |
| 26 | Omnibar/command execution | `web:src/client/CommandPopover.tsx`<br>`gh:src/workbench/omnibar.tsx`<br>`template:.github/app/src/Omnibar.tsx` | `src/commands/registry.ts + one omnibar` | **ADAPT** | Keyboard, command permissions, unmounted handlers |
| 27 | Floating omnibar position | `template:.github/app/src/useFloatingOmnibar.ts` | `src/client/omnibar-position.ts` | **ADAPT** | Single surface drag, attached results, pointer perf |
| 28 | Navigation/shortcut modifiers | `template:.github/app/src/KeyboardSettings.tsx`<br>`gh:src/workbench/commands.ts` | `src/commands/keybindings.ts` | **ADAPT** | Cmd/Ctrl/system/custom, conflicts, OS |
| 29 | Theme/OLED/design tokens | `web:src/client/theme.ts`<br>`template:.github/app/src/useWorkspaceAppearance.ts`<br>`template:.github/app/src/PreferencesPanel.tsx` | `src/settings/theme.ts + one token writer` | **ADAPT** | Actual CSS token consumers, contrast/reduced motion |
| 30 | Advanced color picker | `template:.github/app/src/AccentColorPicker.tsx`<br>`template:.github/app/src/ColorEditor.tsx` | `src/settings/color-picker.tsx` | **ADAPT** | Full color control, reset, persisted palette |
| 31 | Layout preferences | `template:.github/app/src/SidebarResize.tsx`<br>`template:.github/app/src/interface.css` | `src/settings/layout.ts + PanelService` | **ADAPT** | Positions/sizing persisted without UI regressions |
| 32 | Settings / notification authority | `gh:src/settings.ts`<br>`template:.github/app/src/notifications.tsx`<br>`web:src/client/SettingsPane.tsx` | `src/settings/* + one notification provider` | **ADAPT** | One settings store, no duplicated global portal |
| 33 | Welcome, mobile, accessibility | `template:.github/app/src/views.ts`<br>`template:.github/app/src/welcome-content.css`<br>`web:src/client/Canvas.tsx` | `src/client/welcome.tsx + shared styles` | **ADAPT** | 390/1024/1440 responsive, focus, screen reader |
| 34 | Identity-scoped browser storage and migration | `gh:src/workspace/identity.ts`<br>`gh:src/workspace/storage.ts`<br>`template:.github/app/src/persistence/indexeddb.ts` | `src/persistence/*` | **REPAIR/ADAPT** | Read isolation, legacy quarantine, restore from backup |
| 35 | Publication and CI | `gh:.github/workflows/ci.yml`<br>`template:.github/workflows/canvas-pages.yml`<br>`web:.github/workflows/release.yml` | `one target CI/releases + scoped web preview` | **REPLACE** | PR cannot publish privileged/untrusted code, checksum equivalence |
| 36 | Generated docs / agent governance | `gh:.agents/**`<br>`template:.agents/**`<br>`web:docs/**` | `docs + existing target workflow` | **ADAPT** | One authoritative docs pipeline, no stale release refs |

## Critical import blockers and precedence

1. **One shell only:** preserve DarkFactory-web's Bun/React app entry and user workflows; do not mount GHCode's `WorkbenchApp` or template's standalone `App` as peers.
2. **Identity before remote editing:** GHCode principal isolation is not optional. Principal/repo/ref identity must be validated by storage APIs, not just React providers.
3. **Existing GHCode GHC-02 PR #34 was independently rejected** for unscoped storage/private-data export and push-queue settlement. Preserve its Git history and tests; correct semantics before enabling source.
4. **Canvas PR #41** passed 15 domain + 23 real browser IndexedDB tests but is not wired into Canvas React or compatible with GHCode's account-specific database naming. Reuse tests and safe algorithms, not another active DB.
5. **RSC-03 PR #25** is the proposed successor to PR #23; its exact-origin and strict loopback security boundaries must precede remote GitHub integration.
6. **Native distributions PR #28** has passing Linux/macOS acceptance but Windows path/terminal/Chromium blockers. No distribution release until those are corrected.
7. **Factory vs graph:** Factory evidence/contract validation and Canvas source graph are distinct views over shared repositories; do not mix speculative desired state with observed repository evidence.
8. **Static vs privileged:** GitHub Pages can serve browser-only features. Local terminal, filesystem, Git and Chromium/CDP require the authorized local Bun service. A GitHub account never implicitly obtains that local authority.
9. **Legacy data:** GHCode and Canvas browser storage cannot be read from the new local origin without a user-mediated, integrity-checked export/import; do not silently reattribute unauthenticated records.
10. **License gate:** Both GHCode and DarkFactory-template contain GNU GPL-3.0 LICENSE files; DarkFactory-web current main has no root LICENSE. See `PHASE0_LICENSE_REVIEW.md`.

## Migration proof model

Each row remains **NOT IMPLEMENTED IN TARGET** until its mapped provider or feature exists and a test exercises real data through the unified shell. A checked history preservation task does not mark application integration complete. Reconcile each line against issue #31 in P2, with one code owner and one tested user flow.
