import { type ActionGroup, ActionsMenu } from "@/client/ActionsMenu";
import { MonacoEditor, languageForFile } from "@/client/MonacoEditor";
import { TerminalNodeView } from "@/client/TerminalNode";
import { type CommandDefinition, commandGroupsFor, disabled, enabled } from "@/server/commands";
import type {
  BrowserPaneState,
  EditorPaneState,
  ExplorerPaneState,
  FinderResult,
  GitDiff,
  GitRepository,
  GitStatus,
  PaneRect,
  PaneState,
  PaneType,
  SourceControlPaneState,
  TiledLayoutNode,
  Workspace,
} from "@/shared/schema";
import { cn } from "@/shared/utils";
import {
  ChevronDown,
  ChevronRight,
  Code2,
  Columns2,
  ExternalLink,
  FileText,
  Folder,
  FolderGit2,
  GitBranch,
  Globe2,
  Grid2X2,
  Maximize2,
  PanelLeft,
  RefreshCw,
  Save,
  Search,
  Terminal as TerminalIcon,
  X,
} from "lucide-react";
import {
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export type FsEntry = { kind: "dir" | "file"; name: string; path: string };

type CanvasProps = {
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
  onBrowserNavigate: (workspaceId: string, paneId: string, url: string) => Promise<void>;
};

type ModalRequest =
  | {
      kind: "prompt";
      title: string;
      message: string;
      defaultValue: string;
      confirmLabel: string;
      onSubmit: (value: string) => void;
    }
  | {
      kind: "confirm";
      title: string;
      message: string;
      confirmLabel: string;
      destructive?: boolean;
      onConfirm: () => void;
    };

const MIN_PANE_WIDTH = 300;
const MIN_PANE_HEIGHT = 220;

export function Canvas({
  workspace,
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
}: CanvasProps) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [finderOpen, setFinderOpen] = useState(false);
  const [finderQuery, setFinderQuery] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalRequest | null>(null);
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
      const topZ = maxPaneZ(workspace.panes) + 1;
      updateWorkspace({
        activePaneId: paneId,
        panes: workspace.panes.map((pane) => (pane.id === paneId ? { ...pane, z: topZ, updatedAt: nowIso() } : pane)),
      });
    },
    [updateWorkspace, workspace.panes],
  );

  const addPane = useCallback(
    (pane: PaneState) => {
      const nextPanes = [...workspace.panes, pane];
      const tiledLayout =
        pane.placement === "tiled"
          ? insertPaneIntoLayout(workspace.tiledLayout, workspace.activePaneId, pane.id)
          : workspace.tiledLayout;
      commitWorkspace({
        ...workspace,
        panes: nextPanes,
        tiledLayout,
        activePaneId: pane.id,
        activeView: pane.placement === "canvas" ? "canvas" : workspace.activeView,
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

  const closePane = useCallback(
    (paneId: string) => {
      const nextPanes = workspace.panes.filter((pane) => pane.id !== paneId);
      updateWorkspace({
        panes: nextPanes,
        tiledLayout: removePaneFromLayout(workspace.tiledLayout, paneId),
        activePaneId: workspace.activePaneId === paneId ? (nextPanes.at(-1)?.id ?? null) : workspace.activePaneId,
      });
    },
    [updateWorkspace, workspace.activePaneId, workspace.panes, workspace.tiledLayout],
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
        setFinderOpen,
        setModal,
        openExplorerPane,
        openEditorPane,
        openTerminalPane,
        openBrowserPane,
        openSourceControlPane,
        openRepositoriesPane,
        closePane,
        splitPane,
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
      openSourceControlPane,
      openTerminalPane,
      repositories,
      saveEditorPane,
      selectedEntry,
      selectedPath,
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

  const finderResults = useMemo(
    () =>
      buildFinderResults({
        query: finderQuery,
        workspace,
        fileTrees,
        repositories,
        commands,
      }),
    [commands, fileTrees, finderQuery, repositories, workspace],
  );

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target?.matches("input, textarea, [contenteditable]")) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "/") {
        e.preventDefault();
        setFinderOpen(true);
      } else if (e.key === "Escape") {
        setFinderOpen(false);
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
      className="relative h-full min-h-0 w-full overflow-hidden bg-background text-foreground"
      onContextMenu={(event) => {
        event.preventDefault();
        setMenu({ x: event.clientX, y: event.clientY });
      }}
    >
      {workspace.activeView === "panes" ? (
        <>
          <TiledWorkspace
            layout={workspace.tiledLayout}
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
            onSetPanePlacement={setPanePlacement}
            onUpdateSplitRatio={updateSplitRatio}
            onOpenEditor={openEditorPane}
            onOpenTerminal={openTerminalPane}
            onSaveEditor={saveEditorPane}
            onRequestTree={onRequestTree}
            onRequestRepositories={onRequestRepositories}
            onRequestGitStatus={onRequestGitStatus}
            onRequestGitDiff={onRequestGitDiff}
            onBrowserNavigate={onBrowserNavigate}
            onOpenSourceControl={openSourceControlPane}
          />
          <FreeformLayer
            panes={floatingPanes}
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
            onSetPanePlacement={setPanePlacement}
            onOpenEditor={openEditorPane}
            onOpenTerminal={openTerminalPane}
            onSaveEditor={saveEditorPane}
            onRequestTree={onRequestTree}
            onRequestRepositories={onRequestRepositories}
            onRequestGitStatus={onRequestGitStatus}
            onRequestGitDiff={onRequestGitDiff}
            onBrowserNavigate={onBrowserNavigate}
            onOpenSourceControl={openSourceControlPane}
          />
        </>
      ) : (
        <CanvasWorkspace
          panes={workspace.panes}
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
          onSetPanePlacement={setPanePlacement}
          onOpenEditor={openEditorPane}
          onOpenTerminal={openTerminalPane}
          onSaveEditor={saveEditorPane}
          onRequestTree={onRequestTree}
          onRequestRepositories={onRequestRepositories}
          onRequestGitStatus={onRequestGitStatus}
          onRequestGitDiff={onRequestGitDiff}
          onBrowserNavigate={onBrowserNavigate}
          onOpenSourceControl={openSourceControlPane}
        />
      )}

      {finderOpen ? (
        <Finder
          query={finderQuery}
          results={finderResults}
          onQueryChange={setFinderQuery}
          onClose={() => setFinderOpen(false)}
          onPick={(result) => {
            setFinderOpen(false);
            if (result.kind === "command") {
              commands.find((candidate) => candidate.id === result.id.replace(/^command:/, ""))?.run();
            } else if (result.kind === "pane") {
              focusPane(result.id.replace(/^pane:/, ""));
            } else if (result.kind === "file") {
              void openEditorPane(result.detail ?? result.label);
            } else if (result.kind === "folder" || result.kind === "path") {
              const folderPath = result.detail ?? result.label;
              addPane(makeExplorerPane(folderPath, workspace.panes, "tiled"));
            } else if (result.kind === "repository") {
              openSourceControlPane(result.detail ?? null);
            }
          }}
        />
      ) : null}

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
      <div className="flex h-full items-center justify-center bg-background text-sm text-muted-foreground">
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
    const pane = panes.find((candidate) => candidate.id === layout.paneId);
    if (!pane) return null;
    return (
      <PaneFrame
        {...props}
        pane={pane}
        active={pane.id === props.activePaneId}
        mode="tiled"
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
  onSetPanePlacement: (paneId: string, placement: PaneState["placement"]) => void;
  onOpenEditor: (path: string, placement?: PaneState["placement"]) => Promise<void>;
  onOpenTerminal: (cwd?: string, placement?: PaneState["placement"]) => void;
  onSaveEditor: (pane: EditorPaneState) => Promise<void>;
  onRequestTree: (path: string) => void;
  onRequestRepositories: (rootPath: string) => void;
  onRequestGitStatus: (repoPath: string) => Promise<GitStatus>;
  onRequestGitDiff: (repoPath: string, path: string) => Promise<GitDiff>;
  onBrowserNavigate: (workspaceId: string, paneId: string, url: string) => Promise<void>;
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
    <div className="relative h-full overflow-hidden bg-background">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(var(--grid-line)_1px,transparent_1px),linear-gradient(90deg,var(--grid-line)_1px,transparent_1px)] bg-[size:28px_28px]" />
      <FreeformLayer panes={panes} placement="canvas" {...props} />
    </div>
  );
}

function FreeformPane({
  pane,
  placement,
  onFocusPane,
  onUpdatePane,
  ...props
}: PaneRenderProps & {
  pane: PaneState;
  placement: "floating" | "canvas";
}) {
  const dragRef = useRef<{ mode: "move" | "resize"; startX: number; startY: number; rect: PaneRect } | null>(null);

  useEffect(() => {
    function onMove(event: PointerEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (drag.mode === "move") {
        onUpdatePane(pane.id, (candidate) => ({
          ...candidate,
          rect: clampRect({ ...drag.rect, x: drag.rect.x + dx, y: drag.rect.y + dy }),
        }));
      } else {
        onUpdatePane(pane.id, (candidate) => ({
          ...candidate,
          rect: clampRect({
            ...drag.rect,
            width: drag.rect.width + dx,
            height: drag.rect.height + dy,
          }),
        }));
      }
    }
    function onUp() {
      dragRef.current = null;
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [onUpdatePane, pane.id]);

  return (
    <section
      className="pointer-events-auto absolute overflow-hidden rounded-md border border-border bg-background shadow-xl"
      style={{
        left: pane.rect.x,
        top: pane.rect.y,
        width: pane.rect.width,
        height: pane.rect.height,
        zIndex: pane.z,
      }}
      onPointerDown={() => onFocusPane(pane.id)}
    >
      <PaneFrame
        {...props}
        pane={pane}
        active={pane.id === props.activePaneId}
        mode={placement}
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
            };
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
          };
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
  onSetPanePlacement,
  onOpenEditor,
  onOpenTerminal,
  onSaveEditor,
  onRequestTree,
  onRequestRepositories,
  onRequestGitStatus,
  onRequestGitDiff,
  onBrowserNavigate,
  onOpenSourceControl,
}: PaneRenderProps & {
  pane: PaneState;
  active: boolean;
  mode: "tiled" | "floating" | "canvas";
  dragHandleProps?: {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  };
}) {
  return (
    <section
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden rounded-md border bg-background",
        active ? "border-ring" : "border-border",
        mode === "tiled" && "h-full",
      )}
      onPointerDown={() => onFocusPane(pane.id)}
    >
      <header
        className={cn(
          "flex h-9 shrink-0 select-none items-center gap-2 border-b border-border bg-secondary px-2",
          dragHandleProps && "cursor-grab active:cursor-grabbing",
        )}
        {...dragHandleProps}
      >
        {paneIcon(pane.type, "h-3.5 w-3.5")}
        <span className="min-w-0 flex-1 truncate text-xs font-semibold">
          {pane.title}
          {pane.type === "editor" && pane.dirty ? " *" : ""}
        </span>
        {pane.type === "editor" ? (
          <HeaderButton title="Save" onClick={() => void onSaveEditor(pane)}>
            <Save className="h-3.5 w-3.5" />
          </HeaderButton>
        ) : null}
        <HeaderButton title="Split right" onClick={() => onSplitPane(pane.id, "horizontal")}>
          <PanelLeft className="h-3.5 w-3.5" />
        </HeaderButton>
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
        {pane.type === "terminal" ? <TerminalPane cwd={pane.cwd} /> : null}
        {pane.type === "browser" ? (
          <BrowserPane workspaceId={workspace.id} pane={pane} onBrowserNavigate={onBrowserNavigate} />
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

function ExplorerPane({
  pane,
  fileTrees,
  selectedPath,
  onSelectPath,
  onUpdatePane,
  onOpenEditor,
  onOpenTerminal,
  onRequestTree,
}: {
  pane: ExplorerPaneState;
  fileTrees: Map<string, FsEntry[]>;
  selectedPath: string | null;
  onSelectPath: (path: string | null) => void;
  onUpdatePane: (paneId: string, updater: (pane: PaneState) => PaneState) => void;
  onOpenEditor: (path: string, placement?: PaneState["placement"]) => Promise<void>;
  onOpenTerminal: (cwd?: string, placement?: PaneState["placement"]) => void;
  onRequestTree: (path: string) => void;
}) {
  const expanded = useMemo(() => new Set(pane.expandedPaths), [pane.expandedPaths]);
  const toggle = (path: string) => {
    const next = new Set(expanded);
    if (next.has(path)) {
      for (const existing of Array.from(next)) {
        if (existing === path || existing.startsWith(`${path}/`)) next.delete(existing);
      }
    } else {
      next.add(path);
      onRequestTree(path);
    }
    onUpdatePane(pane.id, (candidate) =>
      candidate.type === "explorer" ? { ...candidate, expandedPaths: Array.from(next) } : candidate,
    );
  };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-2">
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground">{pane.folderPath}</span>
        <HeaderButton title="Terminal here" onClick={() => onOpenTerminal(pane.folderPath)}>
          <TerminalIcon className="h-3.5 w-3.5" />
        </HeaderButton>
        <HeaderButton title="Refresh" onClick={() => onRequestTree(pane.folderPath)}>
          <RefreshCw className="h-3.5 w-3.5" />
        </HeaderButton>
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-1">
        <TreeBranch
          path={pane.folderPath}
          depth={0}
          expanded={expanded}
          fileTrees={fileTrees}
          selectedPath={selectedPath}
          onSelectPath={(path) => {
            onSelectPath(path);
            onUpdatePane(pane.id, (candidate) =>
              candidate.type === "explorer" ? { ...candidate, selectedPath: path } : candidate,
            );
          }}
          onToggle={toggle}
          onOpenEditor={onOpenEditor}
        />
      </div>
    </div>
  );
}

function TreeBranch({
  path,
  depth,
  expanded,
  fileTrees,
  selectedPath,
  onSelectPath,
  onToggle,
  onOpenEditor,
}: {
  path: string;
  depth: number;
  expanded: Set<string>;
  fileTrees: Map<string, FsEntry[]>;
  selectedPath: string | null;
  onSelectPath: (path: string) => void;
  onToggle: (path: string) => void;
  onOpenEditor: (path: string, placement?: PaneState["placement"]) => Promise<void>;
}) {
  const entries = fileTrees.get(path);
  if (!entries) {
    return <div className="px-3 py-2 font-mono text-[11px] text-muted-foreground">loading...</div>;
  }
  if (entries.length === 0) {
    return <div className="px-3 py-2 font-mono text-[11px] text-muted-foreground">empty</div>;
  }
  return (
    <div>
      {entries.map((entry) => {
        const isExpanded = expanded.has(entry.path);
        const isSelected = selectedPath === entry.path;
        return (
          <div key={entry.path}>
            <button
              type="button"
              onClick={() => {
                onSelectPath(entry.path);
                if (entry.kind === "dir") onToggle(entry.path);
                else void onOpenEditor(entry.path);
              }}
              className={cn(
                "flex h-7 w-full items-center gap-1.5 px-2 text-left text-xs hover:bg-[var(--surface-hover)]",
                isSelected && "bg-secondary text-foreground",
              )}
              style={{ paddingLeft: 8 + depth * 14 }}
            >
              {entry.kind === "dir" ? (
                isExpanded ? (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )
              ) : (
                <span className="w-3.5 shrink-0" />
              )}
              {entry.kind === "dir" ? (
                <Folder className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <FileText className="h-3.5 w-3.5 shrink-0 text-slate-300" />
              )}
              <span className="truncate">{entry.name}</span>
            </button>
            {entry.kind === "dir" && isExpanded ? (
              <TreeBranch
                path={entry.path}
                depth={depth + 1}
                expanded={expanded}
                fileTrees={fileTrees}
                selectedPath={selectedPath}
                onSelectPath={onSelectPath}
                onToggle={onToggle}
                onOpenEditor={onOpenEditor}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function EditorPane({
  pane,
  onUpdatePane,
  onSaveEditor,
}: {
  pane: EditorPaneState;
  onUpdatePane: (paneId: string, updater: (pane: PaneState) => PaneState) => void;
  onSaveEditor: (pane: EditorPaneState) => Promise<void>;
}) {
  return (
    <div
      className="h-full"
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
          event.preventDefault();
          void onSaveEditor(pane);
        }
      }}
    >
      <MonacoEditor
        value={pane.draftBody}
        language={languageForFile(pane.filePath.split("/").pop() ?? "")}
        onChange={(draftBody) =>
          onUpdatePane(pane.id, (candidate) =>
            candidate.type === "editor" ? { ...candidate, draftBody, dirty: true } : candidate,
          )
        }
      />
    </div>
  );
}

function TerminalPane({ cwd }: { cwd: string }) {
  return (
    <div className="h-full p-2">
      <TerminalNodeView cwd={cwd} />
    </div>
  );
}

function BrowserPane({
  workspaceId,
  pane,
  onBrowserNavigate,
}: {
  workspaceId: string;
  pane: BrowserPaneState;
  onBrowserNavigate: (workspaceId: string, paneId: string, url: string) => Promise<void>;
}) {
  const [address, setAddress] = useState(pane.url);
  const [frame, setFrame] = useState<string | null>(null);
  const [renderer, setRenderer] = useState<string>("connecting");
  const wsRef = useRef<WebSocket | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => setAddress(pane.url), [pane.url]);

  useEffect(() => {
    const url = new URL("/api/browser/stream", window.location.origin);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("workspaceId", workspaceId);
    url.searchParams.set("paneId", pane.id);
    const ws = new WebSocket(url.toString());
    wsRef.current = ws;
    ws.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      const parsed = JSON.parse(event.data) as { type?: string; image?: string; renderer?: string; message?: string };
      if (parsed.type === "frame" && parsed.image) setFrame(parsed.image);
      if (parsed.renderer) setRenderer(parsed.renderer);
      if (parsed.type === "error") setRenderer(parsed.message ?? "error");
    };
    ws.onclose = () => setRenderer("closed");
    return () => {
      ws.close();
    };
  }, [pane.id, workspaceId]);

  useEffect(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "reload", url: pane.url }));
    }
  }, [pane.url]);

  const sendBrowserMessage = useCallback((payload: Record<string, unknown>) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify(payload));
  }, []);

  const navigate = async () => {
    const next = address.trim() || "about:blank";
    await onBrowserNavigate(workspaceId, pane.id, next);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <form
        className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-2"
        onSubmit={(event) => {
          event.preventDefault();
          void navigate();
        }}
      >
        <Globe2 className="h-4 w-4 text-muted-foreground" />
        <input
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          className="min-w-0 flex-1 rounded border border-border bg-secondary px-2 py-1 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
        />
        <button
          type="submit"
          title="Go"
          className="inline-flex h-7 w-7 items-center justify-center rounded bg-secondary text-muted-foreground hover:text-foreground"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </form>
      <div
        tabIndex={0}
        className="relative min-h-0 flex-1 bg-background outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
        onMouseDown={(event) => {
          const point = browserFramePoint(event, imageRef.current);
          if (!point) return;
          event.currentTarget.focus();
          event.preventDefault();
          sendBrowserMessage({ type: "click", ...point, button: browserButton(event.button) });
        }}
        onWheel={(event) => {
          const point = browserFramePoint(event, imageRef.current);
          if (!point) return;
          event.preventDefault();
          sendBrowserMessage({
            type: "wheel",
            ...point,
            deltaX: event.deltaX,
            deltaY: event.deltaY,
          });
        }}
        onKeyDown={(event) => {
          const message = browserKeyMessage(event);
          if (!message) return;
          event.preventDefault();
          sendBrowserMessage(message);
        }}
      >
        {frame ? (
          <img
            ref={imageRef}
            src={frame}
            alt={pane.url}
            className="h-full w-full select-none object-contain bg-background"
            draggable={false}
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-background font-mono text-xs text-muted-foreground">
            waiting for frame
          </div>
        )}
        {renderer !== "chromium" ? (
          <div className="absolute bottom-2 right-2 rounded border border-border bg-background px-2 py-1 font-mono text-[10px] text-muted-foreground">
            {renderer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SourceControlPane({
  workspace,
  pane,
  repositories,
  gitStatuses,
  onUpdatePane,
  onRequestGitStatus,
  onRequestGitDiff,
}: {
  workspace: Workspace;
  pane: SourceControlPaneState;
  repositories: GitRepository[];
  gitStatuses: Map<string, GitStatus>;
  onUpdatePane: (paneId: string, updater: (pane: PaneState) => PaneState) => void;
  onRequestGitStatus: (repoPath: string) => Promise<GitStatus>;
  onRequestGitDiff: (repoPath: string, path: string) => Promise<GitDiff>;
}) {
  const repoPath = pane.repoPath ?? repositories[0]?.rootPath ?? null;
  const status = repoPath ? gitStatuses.get(repoPath) : null;
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [diff, setDiff] = useState<string>("");

  useEffect(() => {
    if (repoPath) void onRequestGitStatus(repoPath);
  }, [onRequestGitStatus, repoPath]);

  if (!repoPath) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-sm text-muted-foreground">
        <GitBranch className="h-8 w-8" />
        <div>No repository found under {workspace.rootPath}</div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-2">
        <GitBranch className="h-4 w-4" />
        <select
          value={repoPath}
          onChange={(event) =>
            onUpdatePane(pane.id, (candidate) =>
              candidate.type === "sourceControl" ? { ...candidate, repoPath: event.target.value } : candidate,
            )
          }
          className="min-w-0 flex-1 rounded border border-border bg-secondary px-2 py-1 text-xs outline-none"
        >
          {repositories.map((repo) => (
            <option key={repo.rootPath} value={repo.rootPath}>
              {repo.relativePath}
            </option>
          ))}
          {!repositories.some((repo) => repo.rootPath === repoPath) ? <option value={repoPath}>{repoPath}</option> : null}
        </select>
        <button
          type="button"
          title="Refresh"
          onClick={() => void onRequestGitStatus(repoPath)}
          className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-[var(--surface-hover)] hover:text-foreground"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(180px,34%)_1fr]">
        <div className="min-h-0 overflow-auto border-r border-border">
          <div className="border-b border-border px-3 py-2 text-xs">
            <div className="font-semibold">{status?.branch ?? "detached"}</div>
            <div className="font-mono text-[10px] text-muted-foreground">
              {status ? (status.clean ? "clean" : `${status.files.length} changed`) : "loading"}
            </div>
          </div>
          {(status?.files ?? []).map((file) => (
            <button
              type="button"
              key={`${file.status}:${file.path}`}
              onClick={() => {
                setSelectedFile(file.path);
                void onRequestGitDiff(repoPath, file.path).then((result) => setDiff(result.diff));
              }}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-[var(--surface-hover)]",
                selectedFile === file.path && "bg-secondary text-foreground",
              )}
            >
              <span className="w-8 shrink-0 font-mono text-[10px] text-muted-foreground">{file.status}</span>
              <span className="truncate">{file.path}</span>
            </button>
          ))}
        </div>
        <pre className="min-h-0 overflow-auto p-3 text-[11px] leading-relaxed text-slate-200">
          {selectedFile ? diff || "No diff for selected file." : "Select a changed file to preview a readonly diff."}
        </pre>
      </div>
    </div>
  );
}

function RepositoriesPane({
  pane,
  repositories,
  onRequestRepositories,
  onOpenSourceControl,
}: {
  pane: { rootPath: string };
  repositories: GitRepository[];
  onRequestRepositories: (rootPath: string) => void;
  onOpenSourceControl: (repoPath?: string | null, placement?: PaneState["placement"]) => void;
}) {
  useEffect(() => {
    onRequestRepositories(pane.rootPath);
  }, [onRequestRepositories, pane.rootPath]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-2">
        <FolderGit2 className="h-4 w-4" />
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground">{pane.rootPath}</span>
        <button
          type="button"
          title="Refresh"
          onClick={() => onRequestRepositories(pane.rootPath)}
          className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-[var(--surface-hover)] hover:text-foreground"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-1">
        {repositories.length === 0 ? (
          <div className="px-3 py-4 text-sm text-muted-foreground">No git repositories found.</div>
        ) : (
          repositories.map((repo) => (
            <button
              type="button"
              key={repo.rootPath}
              onClick={() => onOpenSourceControl(repo.rootPath)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[var(--surface-hover)]"
            >
              <FolderGit2 className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{repo.name}</span>
                <span className="block truncate font-mono text-[10px] text-muted-foreground">{repo.relativePath}</span>
              </span>
              <span className="font-mono text-[10px] text-muted-foreground">{repo.branch ?? "detached"}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function Finder({
  query,
  results,
  onQueryChange,
  onPick,
  onClose,
}: {
  query: string;
  results: FinderResult[];
  onQueryChange: (query: string) => void;
  onPick: (result: FinderResult) => void;
  onClose: () => void;
}) {
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (highlight >= results.length) setHighlight(0);
  }, [highlight, results.length]);

  return (
    <div className="fixed inset-0 z-[70] bg-background/80" data-context-menu>
      <div className="absolute left-1/2 top-20 flex w-[680px] max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-col overflow-hidden rounded-md border border-border bg-background shadow-xl">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              onQueryChange(event.target.value);
              setHighlight(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setHighlight((current) => (results.length === 0 ? 0 : (current + 1) % results.length));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setHighlight((current) => (results.length === 0 ? 0 : (current - 1 + results.length) % results.length));
              } else if (event.key === "Enter") {
                event.preventDefault();
                const result = results[highlight];
                if (result) onPick(result);
              } else if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              }
            }}
            placeholder="Find files, panes, repositories, commands, or jump to /absolute/path"
            className="min-w-0 flex-1 bg-transparent py-1 text-sm outline-none placeholder:text-muted-foreground/45"
          />
        </div>
        <div className="max-h-[440px] overflow-y-auto py-1">
          {results.length === 0 ? (
            <div className="px-4 py-5 text-sm text-muted-foreground">No matches</div>
          ) : (
            results.map((result, index) => (
              <button
                type="button"
                key={result.id}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => onPick(result)}
                className={cn(
                  "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm",
                  index === highlight && "bg-secondary",
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate">{result.label}</span>
                  {result.detail ? (
                    <span className="block truncate font-mono text-[10px] text-muted-foreground/60">{result.detail}</span>
                  ) : null}
                </span>
                <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted-foreground">
                  {result.kind}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function NativeModal({ request, onClose }: { request: ModalRequest; onClose: () => void }) {
  const [value, setValue] = useState(request.kind === "prompt" ? request.defaultValue : "");
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-background/80" data-context-menu>
      <form
        className="w-[420px] max-w-[calc(100vw-2rem)] rounded-md border border-border bg-background p-4 shadow-xl"
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

function createWorkspaceCommands(args: {
  workspace: Workspace;
  activePane: PaneState | null;
  selectedEntry: FsEntry | null;
  selectedPath: string | null;
  repositories: GitRepository[];
  setFinderOpen: (open: boolean) => void;
  setModal: (modal: ModalRequest) => void;
  openExplorerPane: () => void;
  openEditorPane: (path: string, placement?: PaneState["placement"]) => Promise<void>;
  openTerminalPane: (cwd?: string, placement?: PaneState["placement"]) => void;
  openBrowserPane: (url?: string, placement?: PaneState["placement"]) => void;
  openSourceControlPane: (repoPath?: string | null, placement?: PaneState["placement"]) => void;
  openRepositoriesPane: (placement?: PaneState["placement"]) => void;
  closePane: (paneId: string) => void;
  splitPane: (paneId: string, direction?: "horizontal" | "vertical") => void;
  setPanePlacement: (paneId: string, placement: PaneState["placement"]) => void;
  saveEditorPane: (pane: EditorPaneState) => Promise<void>;
  setView: (view: Workspace["activeView"]) => void;
  refreshExplorer: () => void;
  mkdir: (parentPath: string) => void;
  createFile: (parentPath: string, kind: "markdown" | "json" | "yaml" | "typescript" | "plain") => void;
  deleteEntry: (path: string) => void;
}): CommandDefinition[] {
  const activeEditor = args.activePane?.type === "editor" ? args.activePane : null;
  const selectedPath = args.selectedPath;
  const contextFolder = selectedPath
    ? args.selectedEntry?.kind === "file"
      ? parentPath(selectedPath)
      : selectedPath
    : args.workspace.rootPath;
  return [
    {
      id: "finder.open",
      label: "Open Finder",
      scope: "navigation",
      group: "navigation",
      hint: "/",
      enabled,
      run: () => args.setFinderOpen(true),
    },
    {
      id: "workspace.view.panes",
      label: "Show Panes",
      scope: "workspace",
      group: "workspace",
      enabled,
      run: () => args.setView("panes"),
    },
    {
      id: "workspace.view.canvas",
      label: "Show Canvas",
      scope: "workspace",
      group: "workspace",
      enabled,
      run: () => args.setView("canvas"),
    },
    {
      id: "workspace.refresh",
      label: "Refresh Workspace",
      scope: "workspace",
      group: "workspace",
      enabled,
      run: args.refreshExplorer,
    },
    {
      id: "pane.open.explorer",
      label: "Open Explorer",
      scope: "panel",
      group: "panel",
      enabled,
      run: args.openExplorerPane,
    },
    {
      id: "pane.open.terminal",
      label: "Open Terminal",
      scope: "panel",
      group: "panel",
      hint: contextFolder,
      enabled,
      run: () => args.openTerminalPane(contextFolder),
    },
    {
      id: "pane.open.browser",
      label: "Open Browser",
      scope: "browser",
      group: "browser",
      enabled,
      run: () => args.openBrowserPane("about:blank"),
    },
    {
      id: "pane.open.repositories",
      label: "Open Repositories",
      scope: "git",
      group: "git",
      enabled,
      run: () => args.openRepositoriesPane(),
    },
    {
      id: "pane.open.source-control",
      label: "Open Source Control",
      scope: "git",
      group: "git",
      hint: args.repositories[0]?.relativePath,
      enabled,
      run: () => args.openSourceControlPane(args.repositories[0]?.rootPath ?? null),
    },
    {
      id: "fs.open-file",
      label: "Open in Editor",
      scope: "filesystem",
      group: "item",
      hint: selectedPath ?? undefined,
      enabled: () => (args.selectedEntry?.kind === "file" ? enabled() : disabled("select a file")),
      run: () => {
        if (selectedPath) void args.openEditorPane(selectedPath);
      },
    },
    {
      id: "fs.delete-entry",
      label: args.selectedEntry?.kind === "dir" ? "Delete Folder" : "Delete File",
      scope: "filesystem",
      group: "item",
      hint: selectedPath ?? undefined,
      destructive: true,
      enabled: () => (selectedPath ? enabled() : disabled("select an item")),
      run: () => {
        if (selectedPath) args.deleteEntry(selectedPath);
      },
    },
    {
      id: "new.folder",
      label: "+ Subfolder",
      scope: "filesystem",
      group: "new",
      hint: contextFolder,
      enabled,
      run: () => args.mkdir(contextFolder),
    },
    ...(["markdown", "json", "yaml", "typescript", "plain"] as const).map((kind) => ({
      id: `new.file.${kind}`,
      label: `+ File: ${kind}`,
      scope: "filesystem" as const,
      group: "new",
      hint: contextFolder,
      enabled,
      run: () => args.createFile(contextFolder, kind),
    })),
    {
      id: "panel.save-active",
      label: "Save Active Editor",
      scope: "panel",
      group: "panel",
      hint: activeEditor?.filePath,
      enabled: () => (activeEditor ? enabled() : disabled("focus an editor")),
      run: () => {
        if (activeEditor) void args.saveEditorPane(activeEditor);
      },
    },
    {
      id: "panel.split-active",
      label: "Split Active Pane",
      scope: "panel",
      group: "panel",
      hint: args.activePane?.title,
      enabled: () => (args.activePane ? enabled() : disabled("focus a pane")),
      run: () => {
        if (args.activePane) args.splitPane(args.activePane.id);
      },
    },
    {
      id: "panel.float-active",
      label: "Float Active Pane",
      scope: "panel",
      group: "panel",
      hint: args.activePane?.title,
      enabled: () => (args.activePane ? enabled() : disabled("focus a pane")),
      run: () => {
        if (args.activePane) args.setPanePlacement(args.activePane.id, "floating");
      },
    },
    {
      id: "panel.close-active",
      label: "Close Active Pane",
      scope: "panel",
      group: "panel",
      hint: args.activePane?.title,
      enabled: () => (args.activePane ? enabled() : disabled("focus a pane")),
      run: () => {
        if (args.activePane) args.closePane(args.activePane.id);
      },
    },
  ];
}

function buildFinderResults(args: {
  query: string;
  workspace: Workspace;
  fileTrees: Map<string, FsEntry[]>;
  repositories: GitRepository[];
  commands: CommandDefinition[];
}): FinderResult[] {
  const query = args.query.trim();
  const results: FinderResult[] = [];
  for (const entries of args.fileTrees.values()) {
    for (const entry of entries) {
      results.push({
        id: `entry:${entry.path}`,
        label: entry.name,
        detail: entry.path,
        kind: entry.kind === "dir" ? "folder" : "file",
      });
    }
  }
  for (const pane of args.workspace.panes) {
    results.push({
      id: `pane:${pane.id}`,
      label: pane.title,
      detail: detailForPane(pane),
      kind: "pane",
    });
  }
  for (const repo of args.repositories) {
    results.push({
      id: `repository:${repo.rootPath}`,
      label: repo.name,
      detail: repo.rootPath,
      kind: "repository",
    });
  }
  for (const command of args.commands) {
    if (!command.enabled().enabled) continue;
    results.push({
      id: `command:${command.id}`,
      label: command.label,
      detail: command.hint,
      kind: "command",
    });
  }
  if (query.startsWith("/")) {
    results.unshift({
      id: `path:${query}`,
      label: query,
      detail: query,
      kind: "path",
    });
  }
  if (!query) return results.slice(0, 80);
  return results
    .filter((result) => matches(query.toLowerCase(), `${result.kind} ${result.label} ${result.detail ?? ""}`))
    .slice(0, 80);
}

function paneIcon(type: PaneType, className: string) {
  if (type === "explorer") return <Folder className={className} />;
  if (type === "editor") return <Code2 className={className} />;
  if (type === "terminal") return <TerminalIcon className={className} />;
  if (type === "browser") return <Globe2 className={className} />;
  if (type === "sourceControl") return <GitBranch className={className} />;
  return <FolderGit2 className={className} />;
}

function makeExplorerPane(rootPath: string, panes: PaneState[], placement: PaneState["placement"]): ExplorerPaneState {
  const now = nowIso();
  return {
    id: `explorer:${encodeURIComponent(rootPath)}:${Date.now().toString(36)}`,
    type: "explorer",
    title: rootPath.split("/").filter(Boolean).at(-1) || rootPath,
    folderPath: rootPath,
    expandedPaths: [],
    selectedPath: null,
    placement,
    rect: defaultPaneRect(panes.length),
    z: maxPaneZ(panes) + 1,
    createdAt: now,
    updatedAt: now,
  };
}

function makeEditorPane(
  filePath: string,
  body: string,
  panes: PaneState[],
  placement: PaneState["placement"],
): EditorPaneState {
  const now = nowIso();
  return {
    id: `editor:${encodeURIComponent(filePath)}`,
    type: "editor",
    title: filePath.split("/").pop() || filePath,
    filePath,
    draftBody: body,
    dirty: false,
    placement,
    rect: defaultPaneRect(panes.length),
    z: maxPaneZ(panes) + 1,
    createdAt: now,
    updatedAt: now,
  };
}

function makeTerminalPane(cwd: string, panes: PaneState[], placement: PaneState["placement"]): PaneState {
  const now = nowIso();
  return {
    id: `terminal:${encodeURIComponent(cwd)}:${Date.now().toString(36)}`,
    type: "terminal",
    title: `terminal - ${cwd}`,
    cwd,
    placement,
    rect: defaultPaneRect(panes.length),
    z: maxPaneZ(panes) + 1,
    createdAt: now,
    updatedAt: now,
  };
}

function makeBrowserPane(url: string, panes: PaneState[], placement: PaneState["placement"]): BrowserPaneState {
  const now = nowIso();
  const id = `browser:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 7)}`;
  return {
    id,
    type: "browser",
    title: url === "about:blank" ? "Browser" : url,
    url,
    history: [url],
    historyIndex: 0,
    sessionId: `${id}:session`,
    placement,
    rect: defaultPaneRect(panes.length),
    z: maxPaneZ(panes) + 1,
    createdAt: now,
    updatedAt: now,
  };
}

function makeSourceControlPane(
  repoPath: string | null,
  panes: PaneState[],
  placement: PaneState["placement"],
): PaneState {
  const now = nowIso();
  return {
    id: `sourceControl:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 7)}`,
    type: "sourceControl",
    title: "Source Control",
    repoPath,
    placement,
    rect: defaultPaneRect(panes.length),
    z: maxPaneZ(panes) + 1,
    createdAt: now,
    updatedAt: now,
  };
}

function makeRepositoriesPane(rootPath: string, panes: PaneState[], placement: PaneState["placement"]): PaneState {
  const now = nowIso();
  return {
    id: `repositories:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 7)}`,
    type: "repositories",
    title: "Repositories",
    rootPath,
    placement,
    rect: defaultPaneRect(panes.length),
    z: maxPaneZ(panes) + 1,
    createdAt: now,
    updatedAt: now,
  };
}

function clonePaneForSplit(pane: PaneState, panes: PaneState[]): PaneState {
  const now = nowIso();
  const rect = defaultPaneRect(panes.length);
  const z = maxPaneZ(panes) + 1;
  const id = `${pane.id}:split:${Date.now().toString(36)}`;
  if (pane.type === "editor") return { ...pane, id, placement: "tiled", rect, z, createdAt: now, updatedAt: now };
  if (pane.type === "terminal") return { ...pane, id, placement: "tiled", rect, z, createdAt: now, updatedAt: now };
  if (pane.type === "browser") {
    return {
      ...pane,
      id,
      sessionId: `${id}:session`,
      placement: "tiled",
      rect,
      z,
      createdAt: now,
      updatedAt: now,
    };
  }
  return { ...pane, id, placement: "tiled", rect, z, createdAt: now, updatedAt: now };
}

function defaultPaneRect(index: number): PaneRect {
  return {
    x: 80 + (index % 5) * 34,
    y: 58 + (index % 5) * 30,
    width: 760,
    height: 480,
  };
}

function clampRect(rect: PaneRect): PaneRect {
  const maxWidth = Math.max(MIN_PANE_WIDTH, window.innerWidth - 80);
  const maxHeight = Math.max(MIN_PANE_HEIGHT, window.innerHeight - 96);
  const width = Math.min(Math.max(MIN_PANE_WIDTH, rect.width), maxWidth);
  const height = Math.min(Math.max(MIN_PANE_HEIGHT, rect.height), maxHeight);
  return {
    width,
    height,
    x: Math.min(Math.max(8, rect.x), Math.max(8, window.innerWidth - width - 16)),
    y: Math.min(Math.max(8, rect.y), Math.max(8, window.innerHeight - height - 16)),
  };
}

function maxPaneZ(panes: PaneState[]): number {
  return panes.reduce((max, pane) => Math.max(max, pane.z), 0);
}

function insertPaneIntoLayout(
  layout: TiledLayoutNode | null,
  activePaneId: string | null,
  paneId: string,
): TiledLayoutNode {
  if (!layout) return { type: "leaf", paneId };
  if (layoutContains(layout, paneId)) return layout;
  return splitLayoutAt(layout, activePaneId, paneId, "horizontal");
}

function splitLayoutAt(
  layout: TiledLayoutNode | null,
  targetPaneId: string | null,
  newPaneId: string,
  direction: "horizontal" | "vertical",
): TiledLayoutNode {
  if (!layout) return { type: "leaf", paneId: newPaneId };
  if (!targetPaneId) {
    return {
      type: "split",
      id: `split:${newPaneId}:${Date.now().toString(36)}`,
      direction,
      ratio: 0.5,
      first: layout,
      second: { type: "leaf", paneId: newPaneId },
    };
  }
  if (layout.type === "leaf") {
    if (layout.paneId === targetPaneId) {
      return {
        type: "split",
        id: `split:${layout.paneId}:${newPaneId}:${Date.now().toString(36)}`,
        direction,
        ratio: 0.5,
        first: layout,
        second: { type: "leaf", paneId: newPaneId },
      };
    }
    return layout;
  }
  if (layoutContains(layout.first, targetPaneId)) {
    return {
      ...layout,
      first: splitLayoutAt(layout.first, targetPaneId, newPaneId, direction),
    };
  }
  if (layoutContains(layout.second, targetPaneId)) {
    return {
      ...layout,
      second: splitLayoutAt(layout.second, targetPaneId, newPaneId, direction),
    };
  }
  return {
    type: "split",
    id: `split:${newPaneId}:${Date.now().toString(36)}`,
    direction,
    ratio: 0.5,
    first: layout,
    second: { type: "leaf", paneId: newPaneId },
  };
}

function removePaneFromLayout(layout: TiledLayoutNode | null, paneId: string): TiledLayoutNode | null {
  if (!layout) return null;
  if (layout.type === "leaf") return layout.paneId === paneId ? null : layout;
  const first = removePaneFromLayout(layout.first, paneId);
  const second = removePaneFromLayout(layout.second, paneId);
  if (first && second) return { ...layout, first, second };
  return first ?? second;
}

function updateLayoutSplitRatio(
  layout: TiledLayoutNode | null,
  splitId: string,
  ratio: number,
): TiledLayoutNode | null {
  if (!layout) return null;
  if (layout.type === "leaf") return layout;
  if (layout.id === splitId) return { ...layout, ratio };
  return {
    ...layout,
    first: updateLayoutSplitRatio(layout.first, splitId, ratio) ?? layout.first,
    second: updateLayoutSplitRatio(layout.second, splitId, ratio) ?? layout.second,
  };
}

function layoutContains(layout: TiledLayoutNode, paneId: string): boolean {
  if (layout.type === "leaf") return layout.paneId === paneId;
  return layoutContains(layout.first, paneId) || layoutContains(layout.second, paneId);
}

function findEntry(fileTrees: Map<string, FsEntry[]>, path: string): FsEntry | null {
  const parent = parentPath(path);
  return fileTrees.get(parent)?.find((entry) => entry.path === path) ?? null;
}

function detailForPane(pane: PaneState): string {
  if (pane.type === "editor") return pane.filePath;
  if (pane.type === "terminal") return pane.cwd;
  if (pane.type === "browser") return pane.url;
  if (pane.type === "explorer") return pane.folderPath;
  if (pane.type === "sourceControl") return pane.repoPath ?? "workspace";
  return pane.rootPath;
}

function joinPath(parent: string, name: string): string {
  if (parent === "/" || parent === "") return `/${name}`;
  return `${parent}/${name}`;
}

function parentPath(absPath: string): string {
  if (!absPath || absPath === "/") return "/";
  const idx = absPath.lastIndexOf("/");
  if (idx <= 0) return "/";
  return absPath.slice(0, idx);
}

function extensionForKind(kind: "markdown" | "json" | "yaml" | "typescript" | "plain"): string {
  if (kind === "markdown") return "md";
  if (kind === "typescript") return "ts";
  if (kind === "yaml") return "yaml";
  if (kind === "json") return "json";
  return "txt";
}

function matches(query: string, target: string): boolean {
  const text = target.toLowerCase();
  let i = 0;
  for (const ch of query) {
    const found = text.indexOf(ch, i);
    if (found === -1) return false;
    i = found + 1;
  }
  return true;
}

function browserFramePoint(event: { clientX: number; clientY: number }, image: HTMLImageElement | null): { x: number; y: number } | null {
  if (!image) return null;
  const rect = image.getBoundingClientRect();
  const naturalWidth = image.naturalWidth || 1280;
  const naturalHeight = image.naturalHeight || 720;
  const imageAspect = naturalWidth / naturalHeight;
  const boxAspect = rect.width / rect.height;
  let drawWidth = rect.width;
  let drawHeight = rect.height;
  let offsetX = 0;
  let offsetY = 0;
  if (boxAspect > imageAspect) {
    drawWidth = rect.height * imageAspect;
    offsetX = (rect.width - drawWidth) / 2;
  } else {
    drawHeight = rect.width / imageAspect;
    offsetY = (rect.height - drawHeight) / 2;
  }
  const localX = event.clientX - rect.left - offsetX;
  const localY = event.clientY - rect.top - offsetY;
  if (localX < 0 || localY < 0 || localX > drawWidth || localY > drawHeight) return null;
  return {
    x: Math.round(clamp((localX / drawWidth) * naturalWidth, 0, naturalWidth)),
    y: Math.round(clamp((localY / drawHeight) * naturalHeight, 0, naturalHeight)),
  };
}

function browserButton(button: number): "left" | "middle" | "right" {
  if (button === 1) return "middle";
  if (button === 2) return "right";
  return "left";
}

function browserKeyMessage(event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}): { type: "key"; key: string } | { type: "type"; text: string } | null {
  if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
    return { type: "type", text: event.key };
  }
  const key = event.key === " " ? "Space" : event.key;
  const modifier = event.metaKey ? "Meta" : event.ctrlKey ? "Control" : event.altKey ? "Alt" : "";
  return { type: "key", key: modifier ? `${modifier}+${key}` : key };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function nowIso(): string {
  return new Date().toISOString();
}
