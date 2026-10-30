import { type ActionGroup, ActionsMenu } from "@/client/ActionsMenu";
import { BrowserPane } from "@/client/BrowserPane";
import { EditorPane, ExplorerPane, TerminalPane } from "@/client/FilePanes";
import { RepositoriesPane, SourceControlPane } from "@/client/GitPanes";
import { SettingsPane } from "@/client/SettingsPane";
import { sendTerminalInput } from "@/client/TerminalNode";
import { commandGroupsFor } from "@/client/commands";
import {
  clonePaneForSplit,
  makeBrowserPane,
  makeEditorPane,
  makeExplorerPane,
  makeRepositoriesPane,
  makeSettingsPane,
  makeSourceControlPane,
  makeTerminalPane,
} from "@/client/paneFactory";
import {
  activateLayoutTab,
  addPaneToLayoutTab,
  clampPaneRect as clampRect,
  firstPaneIdInLayout,
  insertPaneIntoLayout,
  leafPaneIds,
  maxPaneZ,
  offsetDropRect,
  removePaneFromLayout,
  splitLayoutAt,
  updateLayoutSplitRatio,
} from "@/client/paneLayout";
import {
  type WorkspaceModalRequest,
  createWorkspaceCommands,
  extensionForKind,
  findEntry,
  joinPath,
  parentPath,
} from "@/client/workspaceCommands";
import type {
  EditorPaneState,
  FsEntry,
  GitDiff,
  GitRepository,
  GitStatus,
  PaneRect,
  PaneState,
  PaneType,
  TiledLayoutNode,
  Workspace,
  WorkspaceSettings,
} from "@/shared/schema";
import { DEFAULT_WORKSPACE_SETTINGS } from "@/shared/schema";
import { cn } from "@/shared/utils";
import {
  Code2,
  Columns2,
  ExternalLink,
  Folder,
  FolderGit2,
  GitBranch,
  Globe2,
  Grid2X2,
  GripVertical,
  Maximize2,
  PanelLeft,
  Plus,
  Rows2,
  Save,
  Settings,
  Terminal as TerminalIcon,
  X,
} from "lucide-react";
import {
  type DragEvent as ReactDragEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type CanvasProps = {
  baseUrl?: string;
  workspace: Workspace;
  fileTrees: Map<string, FsEntry[]>;
  repositories: GitRepository[];
  gitStatuses: Map<string, GitStatus>;
  onWorkspaceChange: (workspace: Workspace) => void;
  onCommandGroupsChange: (groups: ActionGroup[]) => void;
  onRequestTree: (path: string) => void;
  onReadFile: (path: string) => Promise<string>;
  onWriteFile: (path: string, body: string) => Promise<void>;
  onMkdir: (path: string) => Promise<void>;
  onCreateFile: (path: string, kind: "markdown" | "json" | "yaml" | "typescript" | "plain") => Promise<void>;
  onDeleteEntry: (path: string) => Promise<void>;
  onRequestRepositories: (rootPath: string) => void;
  onRequestGitStatus: (repoPath: string) => Promise<GitStatus>;
  onRequestGitDiff: (repoPath: string, path: string) => Promise<GitDiff>;
  onBrowserNavigate: (workspaceId: string, paneId: string, url: string, replace?: boolean) => Promise<void>;
  onBrowserHistory: (workspaceId: string, paneId: string, direction: "back" | "forward") => Promise<void>;
  onBrowserSync: (workspaceId: string) => Promise<void>;
  launcherBrowserRequest: { id: number; url: string } | null;
  onLauncherBrowserRequestHandled: () => void;
  launcherPaneRequest: { id: number; kind: "file" | "folder"; path: string } | null;
  onLauncherPaneRequestHandled: () => void;
  launcherTerminalRequest: { id: number; input: string } | null;
  onLauncherTerminalRequestHandled: () => void;
};

const PANE_TAB_MIME = "application/x-canvas-pane-tab";

export function Canvas({
  baseUrl,
  workspace: incomingWorkspace,
  fileTrees,
  repositories,
  gitStatuses,
  onWorkspaceChange,
  onCommandGroupsChange,
  onRequestTree,
  onReadFile,
  onWriteFile,
  onMkdir,
  onCreateFile,
  onDeleteEntry,
  onRequestRepositories,
  onRequestGitStatus,
  onRequestGitDiff,
  onBrowserNavigate,
  onBrowserHistory,
  onBrowserSync,
  launcherBrowserRequest,
  onLauncherBrowserRequestHandled,
  launcherPaneRequest,
  onLauncherPaneRequestHandled,
  launcherTerminalRequest,
  onLauncherTerminalRequestHandled,
}: CanvasProps) {
  const workspace = incomingWorkspace;
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [modal, setModal] = useState<WorkspaceModalRequest | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const activePane = workspace.panes.find((pane) => pane.id === workspace.activePaneId) ?? null;
  const selectedEntry = selectedPath ? findEntry(fileTrees, selectedPath) : null;
  const tiledPanes = useMemo(() => workspace.panes.filter((pane) => pane.placement === "tiled"), [workspace.panes]);
  const floatingPanes = useMemo(() => workspace.panes.filter((pane) => pane.placement === "floating"), [workspace.panes]);

  const commitWorkspace = useCallback(
    (next: Workspace) => {
      onWorkspaceChange({ ...next, updatedAt: nowIso() });
    },
    [onWorkspaceChange],
  );

  const updateWorkspace = useCallback(
    (patch: Partial<Workspace>) => {
      commitWorkspace({ ...workspace, ...patch });
    },
    [commitWorkspace, workspace],
  );

  const updatePane = useCallback(
    (paneId: string, updater: (pane: PaneState) => PaneState) => {
      updateWorkspace({
        panes: workspace.panes.map((pane) => (pane.id === paneId ? { ...updater(pane), updatedAt: nowIso() } : pane)),
      });
    },
    [updateWorkspace, workspace.panes],
  );

  const focusPane = useCallback(
    (paneId: string) => {
      const target = workspace.panes.find((pane) => pane.id === paneId);
      const topZ = maxPaneZ(workspace.panes) + 1;
      updateWorkspace({
        activePaneId: paneId,
        activeView: target?.placement === "canvas" ? "canvas" : target ? "panes" : workspace.activeView,
        tiledLayout: activateLayoutTab(workspace.tiledLayout, paneId),
        panes: workspace.panes.map((pane) => (pane.id === paneId ? { ...pane, z: topZ, updatedAt: nowIso() } : pane)),
      });
    },
    [updateWorkspace, workspace.activeView, workspace.panes, workspace.tiledLayout],
  );

  const addPane = useCallback(
    (pane: PaneState) => {
      const nextPanes = [...workspace.panes, pane];
      const activeTiledPane = workspace.panes.find(
        (candidate) => candidate.id === workspace.activePaneId && candidate.placement === "tiled",
      );
      const tiledLayout =
        pane.placement === "tiled"
          ? workspace.settings.tabbedPanes && activeTiledPane
            ? addPaneToLayoutTab(workspace.tiledLayout, activeTiledPane.id, pane.id)
            : insertPaneIntoLayout(workspace.tiledLayout, activeTiledPane?.id ?? workspace.activePaneId, pane.id)
          : workspace.tiledLayout;
      commitWorkspace({
        ...workspace,
        panes: nextPanes,
        tiledLayout,
        activePaneId: pane.id,
        activeView: pane.placement === "canvas" ? "canvas" : "panes",
      });
    },
    [commitWorkspace, workspace],
  );

  const openExplorerPane = useCallback(() => {
    const existing = workspace.panes.find((pane) => pane.type === "explorer" && pane.folderPath === workspace.rootPath);
    if (existing) {
      focusPane(existing.id);
      return;
    }
    addPane(makeExplorerPane(workspace.rootPath, workspace.panes, "tiled"));
  }, [addPane, focusPane, workspace.panes, workspace.rootPath]);

  const openEditorPane = useCallback(
    async (path: string, placement: PaneState["placement"] = "tiled") => {
      const existing = workspace.panes.find((pane) => pane.type === "editor" && pane.filePath === path);
      if (existing) {
        focusPane(existing.id);
        return;
      }
      try {
        const body = await onReadFile(path);
        addPane(makeEditorPane(path, body, workspace.panes, placement));
      } catch (error) {
        setNotice(error instanceof Error ? error.message : String(error));
      }
    },
    [addPane, focusPane, onReadFile, workspace.panes],
  );

  const openTerminalPane = useCallback(
    (cwd = workspace.rootPath, placement: PaneState["placement"] = "tiled") => {
      addPane(makeTerminalPane(cwd, workspace.panes, placement));
    },
    [addPane, workspace.panes, workspace.rootPath],
  );

  const openBrowserPane = useCallback(
    (url = "about:blank", placement: PaneState["placement"] = "tiled") => {
      addPane(makeBrowserPane(url, workspace.panes, placement));
    },
    [addPane, workspace.panes],
  );

  useEffect(() => {
    if (!launcherBrowserRequest) return;
    openBrowserPane(launcherBrowserRequest.url);
    onLauncherBrowserRequestHandled();
  }, [launcherBrowserRequest, onLauncherBrowserRequestHandled, openBrowserPane]);

  useEffect(() => {
    if (!launcherPaneRequest) return;
    if (launcherPaneRequest.kind === "file") void openEditorPane(launcherPaneRequest.path);
    else addPane(makeExplorerPane(launcherPaneRequest.path, workspace.panes, "tiled"));
    onLauncherPaneRequestHandled();
  }, [addPane, launcherPaneRequest, onLauncherPaneRequestHandled, openEditorPane, workspace.panes]);

  useEffect(() => {
    if (!launcherTerminalRequest) return;
    const target =
      workspace.panes.find((pane) => pane.id === workspace.activePaneId && pane.type === "terminal") ??
      workspace.panes.find((pane) => pane.type === "terminal");
    if (target?.type === "terminal") {
      focusPane(target.id);
      sendTerminalInput(target.id, launcherTerminalRequest.input);
    } else {
      const pane = makeTerminalPane(workspace.rootPath, workspace.panes, "tiled");
      addPane(pane);
      sendTerminalInput(pane.id, launcherTerminalRequest.input);
    }
    onLauncherTerminalRequestHandled();
  }, [
    addPane,
    focusPane,
    launcherTerminalRequest,
    onLauncherTerminalRequestHandled,
    workspace.activePaneId,
    workspace.panes,
    workspace.rootPath,
  ]);

  const openSourceControlPane = useCallback(
    (repoPath: string | null = repositories[0]?.rootPath ?? null, placement: PaneState["placement"] = "tiled") => {
      addPane(makeSourceControlPane(repoPath, workspace.panes, placement));
    },
    [addPane, repositories, workspace.panes],
  );

  const openRepositoriesPane = useCallback(
    (placement: PaneState["placement"] = "tiled") => {
      addPane(makeRepositoriesPane(workspace.rootPath, workspace.panes, placement));
    },
    [addPane, workspace.panes, workspace.rootPath],
  );

  const openSettingsPane = useCallback(
    (placement: PaneState["placement"] = workspace.activeView === "canvas" ? "canvas" : "tiled") => {
      const existing = workspace.panes.find((pane) => pane.type === "settings");
      if (existing) {
        if (existing.placement !== placement) {
          const panes = workspace.panes.map((pane) =>
            pane.id === existing.id ? { ...pane, placement, updatedAt: nowIso() } : pane,
          );
          const tiledLayout =
            placement === "tiled"
              ? insertPaneIntoLayout(workspace.tiledLayout, workspace.activePaneId, existing.id)
              : removePaneFromLayout(workspace.tiledLayout, existing.id);
          updateWorkspace({
            panes,
            tiledLayout,
            activePaneId: existing.id,
            activeView: placement === "canvas" ? "canvas" : "panes",
          });
          return;
        }
        focusPane(existing.id);
        return;
      }
      addPane(makeSettingsPane(workspace.panes, placement));
    },
    [
      addPane,
      focusPane,
      updateWorkspace,
      workspace.activePaneId,
      workspace.activeView,
      workspace.panes,
      workspace.tiledLayout,
    ],
  );

  const closePaneNow = useCallback(
    (paneId: string) => {
      const nextPanes = workspace.panes.filter((pane) => pane.id !== paneId);
      const tiledLayout = removePaneFromLayout(workspace.tiledLayout, paneId);
      updateWorkspace({
        panes: nextPanes,
        tiledLayout,
        activePaneId:
          workspace.activePaneId === paneId
            ? (firstPaneIdInLayout(tiledLayout) ?? nextPanes.at(-1)?.id ?? null)
            : workspace.activePaneId,
      });
    },
    [updateWorkspace, workspace.activePaneId, workspace.panes, workspace.tiledLayout],
  );

  const closePane = useCallback(
    (paneId: string) => {
      const pane = workspace.panes.find((candidate) => candidate.id === paneId);
      if (pane?.type === "editor" && pane.dirty) {
        setModal({
          kind: "confirm",
          title: "Discard unsaved changes?",
          message: `Your edits to ${pane.title} have not been saved to disk.`,
          confirmLabel: "Discard changes",
          destructive: true,
          onConfirm: () => closePaneNow(paneId),
        });
        return;
      }
      closePaneNow(paneId);
    },
    [closePaneNow, workspace.panes],
  );

  const addPaneTab = useCallback(
    (paneId: string) => {
      const pane = workspace.panes.find((candidate) => candidate.id === paneId);
      if (!pane || pane.placement !== "tiled") return;
      const clone = clonePaneForSplit(pane, workspace.panes);
      updateWorkspace({
        panes: [...workspace.panes, clone],
        tiledLayout: addPaneToLayoutTab(workspace.tiledLayout, paneId, clone.id),
        activePaneId: clone.id,
      });
    },
    [updateWorkspace, workspace.panes, workspace.tiledLayout],
  );

  const movePaneTab = useCallback(
    (sourcePaneId: string, targetPaneId: string, targetPlacement: PaneState["placement"]) => {
      if (sourcePaneId === targetPaneId) return;
      const sourcePane = workspace.panes.find((candidate) => candidate.id === sourcePaneId);
      const targetPane = workspace.panes.find((candidate) => candidate.id === targetPaneId);
      if (!sourcePane || !targetPane) return;
      const nextPlacement = targetPlacement;
      const topZ = maxPaneZ(workspace.panes) + 1;
      const nextPanes = workspace.panes.map((pane) => {
        if (pane.id !== sourcePane.id) return pane;
        const rect = nextPlacement === "tiled" ? pane.rect : offsetDropRect(targetPane.rect, pane.rect);
        return {
          ...pane,
          placement: nextPlacement,
          rect,
          z: nextPlacement === "tiled" ? pane.z : topZ,
          updatedAt: nowIso(),
        };
      });
      const tiledLayout =
        nextPlacement === "tiled"
          ? addPaneToLayoutTab(removePaneFromLayout(workspace.tiledLayout, sourcePane.id), targetPane.id, sourcePane.id)
          : removePaneFromLayout(workspace.tiledLayout, sourcePane.id);
      updateWorkspace({
        panes: nextPanes,
        tiledLayout,
        activePaneId: sourcePane.id,
        activeView: nextPlacement === "canvas" ? "canvas" : workspace.activeView,
      });
    },
    [updateWorkspace, workspace.activeView, workspace.panes, workspace.tiledLayout],
  );

  const updateSettings = useCallback(
    (patch: Partial<WorkspaceSettings>) => {
      const settings = { ...DEFAULT_WORKSPACE_SETTINGS, ...workspace.settings, ...patch };
      updateWorkspace({
        settings,
        activeView: patch.defaultView ?? workspace.activeView,
      });
    },
    [updateWorkspace, workspace.activeView, workspace.settings],
  );

  const splitPane = useCallback(
    (paneId: string, direction: "horizontal" | "vertical" = "horizontal") => {
      const pane = workspace.panes.find((candidate) => candidate.id === paneId);
      if (!pane) return;
      const clone = clonePaneForSplit(pane, workspace.panes);
      updateWorkspace({
        panes: [...workspace.panes, clone],
        tiledLayout: splitLayoutAt(workspace.tiledLayout, paneId, clone.id, direction),
        activePaneId: clone.id,
      });
    },
    [updateWorkspace, workspace.panes, workspace.tiledLayout],
  );

  const setPanePlacement = useCallback(
    (paneId: string, placement: PaneState["placement"]) => {
      const pane = workspace.panes.find((candidate) => candidate.id === paneId);
      if (!pane) return;
      const panes = workspace.panes.map((candidate) =>
        candidate.id === paneId ? { ...candidate, placement, updatedAt: nowIso() } : candidate,
      );
      const tiledLayout =
        placement === "tiled"
          ? insertPaneIntoLayout(workspace.tiledLayout, workspace.activePaneId, paneId)
          : removePaneFromLayout(workspace.tiledLayout, paneId);
      updateWorkspace({
        panes,
        tiledLayout,
        activePaneId: paneId,
        activeView: placement === "canvas" ? "canvas" : workspace.activeView,
      });
    },
    [updateWorkspace, workspace.activePaneId, workspace.activeView, workspace.panes, workspace.tiledLayout],
  );

  const updateSplitRatio = useCallback(
    (splitId: string, ratio: number) => {
      updateWorkspace({ tiledLayout: updateLayoutSplitRatio(workspace.tiledLayout, splitId, ratio) });
    },
    [updateWorkspace, workspace.tiledLayout],
  );

  const saveEditorPane = useCallback(
    async (pane: EditorPaneState) => {
      await onWriteFile(pane.filePath, pane.draftBody);
      updatePane(pane.id, (candidate) => (candidate.type === "editor" ? { ...candidate, dirty: false } : candidate));
      setNotice(`saved ${pane.filePath}`);
    },
    [onWriteFile, updatePane],
  );

  useEffect(() => {
    for (const pane of workspace.panes) {
      if (pane.type !== "explorer") continue;
      if (!fileTrees.has(pane.folderPath)) onRequestTree(pane.folderPath);
      for (const path of pane.expandedPaths) {
        if (!fileTrees.has(path)) onRequestTree(path);
      }
    }
  }, [fileTrees, onRequestTree, workspace.panes]);

  useEffect(() => {
    if (workspace.panes.some((pane) => pane.type === "repositories" || pane.type === "sourceControl")) {
      onRequestRepositories(workspace.rootPath);
    }
  }, [onRequestRepositories, workspace.panes, workspace.rootPath]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 3_000);
    return () => clearTimeout(timer);
  }, [notice]);

  const commands = useMemo(
    () =>
      createWorkspaceCommands({
        workspace,
        activePane,
        selectedEntry,
        selectedPath,
        repositories,
        setModal,
        openExplorerPane,
        openEditorPane,
        openTerminalPane,
        openBrowserPane,
        openSourceControlPane,
        openRepositoriesPane,
        openSettingsPane,
        closePane,
        splitPane,
        addPaneTab,
        setPanePlacement,
        saveEditorPane,
        setView: (activeView) => updateWorkspace({ activeView }),
        refreshExplorer: () => {
          for (const pane of workspace.panes) {
            if (pane.type === "explorer") onRequestTree(pane.folderPath);
          }
          onRequestRepositories(workspace.rootPath);
        },
        mkdir: (parentPath) => {
          setModal({
            kind: "prompt",
            title: "New Folder",
            message: parentPath,
            defaultValue: "new-folder",
            confirmLabel: "Create",
            onSubmit: (name) => {
              const child = joinPath(parentPath, name);
              void onMkdir(child).then(() => onRequestTree(parentPath));
            },
          });
        },
        createFile: (parentPath, kind) => {
          const ext = extensionForKind(kind);
          setModal({
            kind: "prompt",
            title: `New ${kind} file`,
            message: parentPath,
            defaultValue: `untitled.${ext}`,
            confirmLabel: "Create",
            onSubmit: (name) => {
              const child = joinPath(parentPath, name);
              void onCreateFile(child, kind).then(() => {
                onRequestTree(parentPath);
                void openEditorPane(child);
              });
            },
          });
        },
        deleteEntry: (path) => {
          setModal({
            kind: "confirm",
            title: "Delete Entry",
            message: path,
            confirmLabel: "Delete",
            destructive: true,
            onConfirm: () => {
              void onDeleteEntry(path).then(() => onRequestTree(parentPath(path)));
            },
          });
        },
      }),
    [
      activePane,
      closePane,
      onCreateFile,
      onDeleteEntry,
      onMkdir,
      onRequestRepositories,
      onRequestTree,
      openBrowserPane,
      openEditorPane,
      openExplorerPane,
      openRepositoriesPane,
      openSettingsPane,
      openSourceControlPane,
      openTerminalPane,
      repositories,
      saveEditorPane,
      selectedEntry,
      selectedPath,
      addPaneTab,
      setPanePlacement,
      splitPane,
      updateWorkspace,
      workspace,
    ],
  );

  const commandGroups = useMemo(() => commandGroupsFor(commands), [commands]);

  useEffect(() => {
    onCommandGroupsChange(commandGroups);
  }, [commandGroups, onCommandGroupsChange]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target?.matches("input, textarea, [contenteditable]")) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") {
        setMenu(null);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  useEffect(() => {
    if (!menu) return;
    function handlePointer(e: PointerEvent) {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("[data-context-menu]")) return;
      setMenu(null);
    }
    window.addEventListener("pointerdown", handlePointer, true);
    return () => window.removeEventListener("pointerdown", handlePointer, true);
  }, [menu]);

  return (
    <div
      data-background={workspace.settings.backgroundStyle}
      className="workspace-bg relative h-full min-h-0 w-full overflow-hidden text-foreground"
      onContextMenu={(event) => {
        event.preventDefault();
        setMenu({ x: event.clientX, y: event.clientY });
      }}
    >
      {workspace.activeView === "panes" ? (
        <>
          <TiledWorkspace
            layout={workspace.tiledLayout}
            baseUrl={baseUrl}
            panes={tiledPanes}
            activePaneId={workspace.activePaneId}
            workspace={workspace}
            fileTrees={fileTrees}
            repositories={repositories}
            gitStatuses={gitStatuses}
            selectedPath={selectedPath}
            onSelectPath={setSelectedPath}
            onFocusPane={focusPane}
            onUpdatePane={updatePane}
            onClosePane={closePane}
            onSplitPane={splitPane}
            onAddPaneTab={addPaneTab}
            onMovePaneTab={movePaneTab}
            onSetPanePlacement={setPanePlacement}
            onUpdateSettings={updateSettings}
            onUpdateSplitRatio={updateSplitRatio}
            onOpenEditor={openEditorPane}
            onOpenTerminal={openTerminalPane}
            onSaveEditor={saveEditorPane}
            onRequestTree={onRequestTree}
            onRequestRepositories={onRequestRepositories}
            onRequestGitStatus={onRequestGitStatus}
            onRequestGitDiff={onRequestGitDiff}
            onBrowserNavigate={onBrowserNavigate}
            onBrowserHistory={onBrowserHistory}
            onBrowserSync={onBrowserSync}
            onOpenSourceControl={openSourceControlPane}
          />
          <FreeformLayer
            panes={floatingPanes}
            baseUrl={baseUrl}
            workspace={workspace}
            fileTrees={fileTrees}
            repositories={repositories}
            gitStatuses={gitStatuses}
            selectedPath={selectedPath}
            activePaneId={workspace.activePaneId}
            placement="floating"
            onSelectPath={setSelectedPath}
            onFocusPane={focusPane}
            onUpdatePane={updatePane}
            onClosePane={closePane}
            onSplitPane={splitPane}
            onAddPaneTab={addPaneTab}
            onMovePaneTab={movePaneTab}
            onSetPanePlacement={setPanePlacement}
            onUpdateSettings={updateSettings}
            onOpenEditor={openEditorPane}
            onOpenTerminal={openTerminalPane}
            onSaveEditor={saveEditorPane}
            onRequestTree={onRequestTree}
            onRequestRepositories={onRequestRepositories}
            onRequestGitStatus={onRequestGitStatus}
            onRequestGitDiff={onRequestGitDiff}
            onBrowserNavigate={onBrowserNavigate}
            onBrowserHistory={onBrowserHistory}
            onBrowserSync={onBrowserSync}
            onOpenSourceControl={openSourceControlPane}
          />
        </>
      ) : (
        <CanvasWorkspace
          panes={workspace.panes}
          baseUrl={baseUrl}
          workspace={workspace}
          fileTrees={fileTrees}
          repositories={repositories}
          gitStatuses={gitStatuses}
          selectedPath={selectedPath}
          activePaneId={workspace.activePaneId}
          onSelectPath={setSelectedPath}
          onFocusPane={focusPane}
          onUpdatePane={updatePane}
          onClosePane={closePane}
          onSplitPane={splitPane}
          onAddPaneTab={addPaneTab}
          onMovePaneTab={movePaneTab}
          onSetPanePlacement={setPanePlacement}
          onUpdateSettings={updateSettings}
          onOpenEditor={openEditorPane}
          onOpenTerminal={openTerminalPane}
          onSaveEditor={saveEditorPane}
          onRequestTree={onRequestTree}
          onRequestRepositories={onRequestRepositories}
          onRequestGitStatus={onRequestGitStatus}
          onRequestGitDiff={onRequestGitDiff}
          onBrowserNavigate={onBrowserNavigate}
          onBrowserHistory={onBrowserHistory}
          onBrowserSync={onBrowserSync}
          onOpenSourceControl={openSourceControlPane}
        />
      )}

      {menu ? (
        <ActionsMenu
          x={menu.x}
          y={menu.y}
          title={activePane ? `Actions on ${activePane.title}` : `Actions on ${workspace.label}`}
          groups={commandGroups}
          onClose={() => setMenu(null)}
        />
      ) : null}

      {notice ? (
        <div className="absolute right-4 top-4 z-50 max-w-md rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground shadow-lg">
          {notice}
        </div>
      ) : null}

      {modal ? <NativeModal request={modal} onClose={() => setModal(null)} /> : null}
    </div>
  );
}

function TiledWorkspace(props: TiledWorkspaceProps) {
  if (!props.layout || props.panes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Open a pane from the quick bar.
      </div>
    );
  }
  return (
    <div className="h-full p-1">
      <TiledNode {...props} layout={props.layout} />
    </div>
  );
}

type TiledWorkspaceProps = PaneRenderProps & {
  layout: TiledLayoutNode | null;
  panes: PaneState[];
  activePaneId: string | null;
  onUpdateSplitRatio: (splitId: string, ratio: number) => void;
};

function TiledNode({ layout, panes, onUpdateSplitRatio, ...props }: TiledWorkspaceProps & { layout: TiledLayoutNode }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  if (layout.type === "leaf") {
    const tabPanes = leafPaneIds(layout)
      .map((paneId) => panes.find((candidate) => candidate.id === paneId))
      .filter((pane): pane is PaneState => Boolean(pane));
    const activeTabId = layout.activePaneId && tabPanes.some((pane) => pane.id === layout.activePaneId)
      ? layout.activePaneId
      : layout.paneId;
    const pane = tabPanes.find((candidate) => candidate.id === activeTabId) ?? tabPanes[0];
    if (!pane) return null;
    return (
      <PaneFrame
        {...props}
        pane={pane}
        active={pane.id === props.activePaneId}
        mode="tiled"
        tabs={tabPanes}
      />
    );
  }
  const horizontal = layout.direction === "horizontal";
  return (
    <div ref={containerRef} className={cn("flex h-full min-h-0 min-w-0", horizontal ? "flex-row" : "flex-col")}>
      <div className="min-h-0 min-w-0" style={{ flexBasis: `${layout.ratio * 100}%`, flexGrow: 0, flexShrink: 0 }}>
        <TiledNode {...props} panes={panes} layout={layout.first} onUpdateSplitRatio={onUpdateSplitRatio} />
      </div>
      <button
        type="button"
        title="Resize split"
        className={cn(
          "shrink-0 rounded bg-secondary transition-colors hover:bg-[var(--surface-hover)]",
          horizontal ? "mx-0.5 w-1 cursor-col-resize" : "my-0.5 h-1 cursor-row-resize",
        )}
        onPointerDown={(event) => {
          event.preventDefault();
          const bounds = containerRef.current?.getBoundingClientRect();
          if (!bounds) return;
          const onMove = (move: PointerEvent) => {
            const raw = horizontal
              ? (move.clientX - bounds.left) / bounds.width
              : (move.clientY - bounds.top) / bounds.height;
            onUpdateSplitRatio(layout.id, Math.min(0.85, Math.max(0.15, raw)));
          };
          const onUp = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
          };
          window.addEventListener("pointermove", onMove);
          window.addEventListener("pointerup", onUp);
        }}
      />
      <div className="min-h-0 min-w-0 flex-1">
        <TiledNode {...props} panes={panes} layout={layout.second} onUpdateSplitRatio={onUpdateSplitRatio} />
      </div>
    </div>
  );
}

type PaneRenderProps = {
  baseUrl?: string;
  workspace: Workspace;
  fileTrees: Map<string, FsEntry[]>;
  repositories: GitRepository[];
  gitStatuses: Map<string, GitStatus>;
  selectedPath: string | null;
  activePaneId: string | null;
  onSelectPath: (path: string | null) => void;
  onFocusPane: (paneId: string) => void;
  onUpdatePane: (paneId: string, updater: (pane: PaneState) => PaneState) => void;
  onClosePane: (paneId: string) => void;
  onSplitPane: (paneId: string, direction?: "horizontal" | "vertical") => void;
  onAddPaneTab: (paneId: string) => void;
  onMovePaneTab: (sourcePaneId: string, targetPaneId: string, targetPlacement: PaneState["placement"]) => void;
  onSetPanePlacement: (paneId: string, placement: PaneState["placement"]) => void;
  onUpdateSettings: (patch: Partial<WorkspaceSettings>) => void;
  onOpenEditor: (path: string, placement?: PaneState["placement"]) => Promise<void>;
  onOpenTerminal: (cwd?: string, placement?: PaneState["placement"]) => void;
  onSaveEditor: (pane: EditorPaneState) => Promise<void>;
  onRequestTree: (path: string) => void;
  onRequestRepositories: (rootPath: string) => void;
  onRequestGitStatus: (repoPath: string) => Promise<GitStatus>;
  onRequestGitDiff: (repoPath: string, path: string) => Promise<GitDiff>;
  onBrowserNavigate: (workspaceId: string, paneId: string, url: string, replace?: boolean) => Promise<void>;
  onBrowserHistory: (workspaceId: string, paneId: string, direction: "back" | "forward") => Promise<void>;
  onBrowserSync: (workspaceId: string) => Promise<void>;
  onOpenSourceControl: (repoPath?: string | null, placement?: PaneState["placement"]) => void;
};

function FreeformLayer({
  panes,
  placement,
  ...props
}: PaneRenderProps & {
  panes: PaneState[];
  placement: "floating" | "canvas";
}) {
  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      {panes.map((pane) => (
        <FreeformPane key={pane.id} pane={pane} placement={placement} {...props} />
      ))}
    </div>
  );
}

function CanvasWorkspace({ panes, ...props }: PaneRenderProps & { panes: PaneState[] }) {
  return (
    <div className="relative h-full overflow-hidden">
      <FreeformLayer panes={panes} placement="canvas" {...props} />
    </div>
  );
}

function FreeformPane({
  pane,
  placement,
  workspace,
  onFocusPane,
  onUpdatePane,
  ...props
}: PaneRenderProps & {
  pane: PaneState;
  placement: "floating" | "canvas";
}) {
  const dragRef = useRef<{
    mode: "move" | "resize";
    startX: number;
    startY: number;
    rect: PaneRect;
    nextRect: PaneRect;
  } | null>(null);
  const [draftRect, setDraftRect] = useState<PaneRect | null>(null);

  useEffect(() => {
    function onMove(event: PointerEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      const nextRect =
        drag.mode === "move"
          ? clampRect({ ...drag.rect, x: drag.rect.x + dx, y: drag.rect.y + dy })
          : clampRect({
              ...drag.rect,
              width: drag.rect.width + dx,
              height: drag.rect.height + dy,
            });
      drag.nextRect = nextRect;
      setDraftRect(nextRect);
    }
    function onUp() {
      const drag = dragRef.current;
      dragRef.current = null;
      setDraftRect(null);
      if (!drag) return;
      onUpdatePane(pane.id, (candidate) => ({
        ...candidate,
        rect: drag.nextRect,
      }));
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [onUpdatePane, pane.id]);

  const rect = draftRect ?? pane.rect;

  return (
    <section
      className="pointer-events-auto absolute overflow-hidden rounded-md border border-border bg-[var(--panel-bg)] shadow-xl backdrop-blur-xl"
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        zIndex: pane.z,
      }}
      onPointerDown={() => onFocusPane(pane.id)}
    >
      <PaneFrame
        {...props}
        pane={pane}
        active={pane.id === props.activePaneId}
        mode={placement}
        tabs={workspace.settings.tabbedPanes ? [pane] : undefined}
        workspace={workspace}
        onFocusPane={onFocusPane}
        onUpdatePane={onUpdatePane}
        dragHandleProps={{
          onPointerDown: (event) => {
            event.preventDefault();
            onFocusPane(pane.id);
            dragRef.current = {
              mode: "move",
              startX: event.clientX,
              startY: event.clientY,
              rect: pane.rect,
              nextRect: pane.rect,
            };
            setDraftRect(pane.rect);
          },
        }}
      />
      <button
        type="button"
        title="Resize"
        aria-label="Resize pane"
        className="absolute bottom-0 right-0 h-5 w-5 cursor-nwse-resize text-muted-foreground/60 hover:text-foreground"
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onFocusPane(pane.id);
          dragRef.current = {
            mode: "resize",
            startX: event.clientX,
            startY: event.clientY,
            rect: pane.rect,
            nextRect: pane.rect,
          };
          setDraftRect(pane.rect);
        }}
      >
        <Maximize2 className="h-3.5 w-3.5 rotate-90" />
      </button>
    </section>
  );
}

function PaneFrame({
  pane,
  active,
  mode,
  tabs,
  baseUrl,
  workspace,
  fileTrees,
  repositories,
  gitStatuses,
  selectedPath,
  dragHandleProps,
  onSelectPath,
  onFocusPane,
  onUpdatePane,
  onClosePane,
  onSplitPane,
  onAddPaneTab,
  onMovePaneTab,
  onSetPanePlacement,
  onUpdateSettings,
  onOpenEditor,
  onOpenTerminal,
  onSaveEditor,
  onRequestTree,
  onRequestRepositories,
  onRequestGitStatus,
  onRequestGitDiff,
  onBrowserNavigate,
  onBrowserHistory,
  onBrowserSync,
  onOpenSourceControl,
}: PaneRenderProps & {
  pane: PaneState;
  active: boolean;
  mode: "tiled" | "floating" | "canvas";
  tabs?: PaneState[];
  dragHandleProps?: {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  };
}) {
  const showTabs = workspace.settings.tabbedPanes && tabs && tabs.length > 0;
  const handleTabDragOver = (event: ReactDragEvent<HTMLElement>) => {
    if (!Array.from(event.dataTransfer.types).includes(PANE_TAB_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  };
  const handleTabDrop = (event: ReactDragEvent<HTMLElement>) => {
    const sourcePaneId = event.dataTransfer.getData(PANE_TAB_MIME);
    if (!sourcePaneId || sourcePaneId === pane.id) return;
    event.preventDefault();
    onMovePaneTab(sourcePaneId, pane.id, mode);
  };
  return (
    <section
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden rounded-md border bg-[var(--panel-bg)] backdrop-blur-xl",
        active ? "border-ring" : "border-border",
        mode === "tiled" && "h-full",
      )}
      onPointerDown={() => onFocusPane(pane.id)}
      onDragOver={handleTabDragOver}
      onDrop={handleTabDrop}
    >
      <header
        className={cn(
          "flex h-9 shrink-0 select-none items-center gap-2 border-b border-border bg-[var(--chrome-bg)] px-2",
        )}
      >
        {dragHandleProps ? (
          <button
            type="button"
            title="Move pane"
            aria-label="Move pane"
            className="inline-flex h-6 w-5 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground hover:bg-[var(--surface-hover)] hover:text-foreground active:cursor-grabbing"
            {...dragHandleProps}
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>
        ) : null}
        <div className="min-w-0 flex-1">
          {showTabs ? (
            <div className="flex h-8 min-w-0 items-end gap-1 overflow-x-auto pt-1">
              {tabs.map((tab) => {
                const selected = tab.id === pane.id;
                return (
                  <div
                    key={tab.id}
                    title={tab.title}
                    draggable
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      onFocusPane(tab.id);
                    }}
                    onDragStart={(event) => {
                      event.stopPropagation();
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData(PANE_TAB_MIME, tab.id);
                      event.dataTransfer.setData("text/plain", tab.title);
                    }}
                    className={cn(
                      "flex h-7 min-w-0 max-w-[190px] cursor-grab items-center gap-1.5 rounded-t-md border border-b-0 px-2 text-xs active:cursor-grabbing",
                      selected
                        ? "border-border bg-[var(--panel-bg)] text-foreground"
                        : "border-transparent text-muted-foreground hover:bg-[var(--surface-hover)] hover:text-foreground",
                    )}
                  >
                    <button type="button" className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
                      {paneIcon(tab.type, "h-3.5 w-3.5 shrink-0")}
                      <span className="truncate">{tab.title}</span>
                      {tab.type === "editor" && tab.dirty ? <span className="shrink-0">*</span> : null}
                    </button>
                    <button
                      type="button"
                      title="Close tab"
                      className="ml-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded hover:bg-[var(--surface-hover)]"
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={() => onClosePane(tab.id)}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex min-w-0 items-center gap-1.5">
              {paneIcon(pane.type, "h-3.5 w-3.5 shrink-0")}
              <span className="min-w-0 flex-1 truncate text-xs font-semibold">
                {pane.title}
                {pane.type === "editor" && pane.dirty ? " *" : ""}
              </span>
            </div>
          )}
        </div>
        {pane.type === "editor" ? (
          <HeaderButton title="Save" onClick={() => void onSaveEditor(pane)}>
            <Save className="h-3.5 w-3.5" />
          </HeaderButton>
        ) : null}
        <HeaderButton title="Split right" onClick={() => onSplitPane(pane.id, "horizontal")}>
          <PanelLeft className="h-3.5 w-3.5" />
        </HeaderButton>
        <HeaderButton title="Split down" onClick={() => onSplitPane(pane.id, "vertical")}>
          <Rows2 className="h-3.5 w-3.5" />
        </HeaderButton>
        {workspace.settings.tabbedPanes && mode === "tiled" ? (
          <HeaderButton title="New tab" onClick={() => onAddPaneTab(pane.id)}>
            <Plus className="h-3.5 w-3.5" />
          </HeaderButton>
        ) : null}
        <HeaderButton
          title={mode === "tiled" ? "Float" : "Tile"}
          onClick={() => onSetPanePlacement(pane.id, mode === "tiled" ? "floating" : "tiled")}
        >
          {mode === "tiled" ? <ExternalLink className="h-3.5 w-3.5" /> : <Columns2 className="h-3.5 w-3.5" />}
        </HeaderButton>
        <HeaderButton title="Canvas" onClick={() => onSetPanePlacement(pane.id, "canvas")}>
          <Grid2X2 className="h-3.5 w-3.5" />
        </HeaderButton>
        <HeaderButton title="Close" onClick={() => onClosePane(pane.id)}>
          <X className="h-3.5 w-3.5" />
        </HeaderButton>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden">
        {pane.type === "explorer" ? (
          <ExplorerPane
            pane={pane}
            fileTrees={fileTrees}
            selectedPath={selectedPath}
            onSelectPath={onSelectPath}
            onUpdatePane={onUpdatePane}
            onOpenEditor={onOpenEditor}
            onOpenTerminal={onOpenTerminal}
            onRequestTree={onRequestTree}
          />
        ) : null}
        {pane.type === "editor" ? <EditorPane pane={pane} onUpdatePane={onUpdatePane} onSaveEditor={onSaveEditor} /> : null}
        {pane.type === "terminal" ? <TerminalPane pane={pane} baseUrl={baseUrl} /> : null}
        {pane.type === "browser" ? (
          <BrowserPane
            workspaceId={workspace.id}
            pane={pane}
            baseUrl={baseUrl}
            onBrowserNavigate={onBrowserNavigate}
            onBrowserHistory={onBrowserHistory}
            onBrowserSync={onBrowserSync}
          />
        ) : null}
        {pane.type === "sourceControl" ? (
          <SourceControlPane
            workspace={workspace}
            pane={pane}
            repositories={repositories}
            gitStatuses={gitStatuses}
            onUpdatePane={onUpdatePane}
            onRequestGitStatus={onRequestGitStatus}
            onRequestGitDiff={onRequestGitDiff}
          />
        ) : null}
        {pane.type === "repositories" ? (
          <RepositoriesPane
            pane={pane}
            repositories={repositories}
            onRequestRepositories={onRequestRepositories}
            onOpenSourceControl={onOpenSourceControl}
          />
        ) : null}
        {pane.type === "settings" ? <SettingsPane workspace={workspace} onUpdateSettings={onUpdateSettings} /> : null}
      </div>
    </section>
  );
}

function HeaderButton({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={onClick}
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-[var(--surface-hover)] hover:text-foreground"
    >
      {children}
    </button>
  );
}

function NativeModal({ request, onClose }: { request: WorkspaceModalRequest; onClose: () => void }) {
  const [value, setValue] = useState(request.kind === "prompt" ? request.defaultValue : "");
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-background/80" data-context-menu role="presentation">
      <form
        role="dialog"
        aria-modal="true"
        aria-label={request.title}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
        className="w-[420px] max-w-[calc(100vw-2rem)] rounded-md border border-border bg-[var(--panel-bg)] p-4 shadow-xl backdrop-blur-xl"
        onSubmit={(event) => {
          event.preventDefault();
          if (request.kind === "prompt") {
            const trimmed = value.trim();
            if (!trimmed) return;
            request.onSubmit(trimmed);
          } else {
            request.onConfirm();
          }
          onClose();
        }}
      >
        <div className="text-base font-semibold">{request.title}</div>
        <div className="mt-1 break-all text-sm text-muted-foreground">{request.message}</div>
        {request.kind === "prompt" ? (
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className="mt-4 w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
          />
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            autoFocus
            onClick={onClose}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="submit"
            className={cn(
              "rounded-md px-3 py-1.5 text-sm",
              request.kind === "confirm" && request.destructive
                ? "border border-border bg-secondary text-foreground"
                : "bg-primary text-primary-foreground",
            )}
          >
            {request.confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

function paneIcon(type: PaneType, className: string) {
  if (type === "explorer") return <Folder className={className} />;
  if (type === "editor") return <Code2 className={className} />;
  if (type === "terminal") return <TerminalIcon className={className} />;
  if (type === "browser") return <Globe2 className={className} />;
  if (type === "sourceControl") return <GitBranch className={className} />;
  if (type === "settings") return <Settings className={className} />;
  return <FolderGit2 className={className} />;
}

function nowIso(): string {
  return new Date().toISOString();
}
