import type { ActionGroup, ActionItem } from "@/client/ActionsMenu";
import { Canvas } from "@/client/Canvas";
import { Dock } from "@/client/Dock";
import { makeClient } from "@/client/client";
import { urlForLauncherQuery } from "@/client/launcher";
import { matchesSubsequence } from "@/client/search";
import { applyWorkspaceTheme, resolveWorkspaceTheme } from "@/client/theme";
import type { FsEntry, GitRepository, GitStatus, Workspace, WorkspaceSummary } from "@/shared/schema";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type CanvasMountProps = {
  baseUrl?: string;
  initialWorkspaceId?: string;
  className?: string;
};

type AppModal =
  | {
      kind: "rename";
      title: string;
      label: string;
      onSubmit: (value: string) => void;
    }
  | {
      kind: "confirm";
      title: string;
      message: string;
      confirmLabel: string;
      onConfirm: () => void;
    };

type LauncherBrowserRequest = { id: number; url: string };
type LauncherPaneRequest = { id: number; kind: "file" | "folder"; path: string };
type LauncherTerminalRequest = { id: number; input: string };

export function CanvasMount({ baseUrl, initialWorkspaceId, className }: CanvasMountProps) {
  const client = useMemo(() => makeClient(baseUrl), [baseUrl]);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(null);
  const [fileTrees, setFileTrees] = useState<Map<string, FsEntry[]>>(() => new Map());
  const [repositories, setRepositories] = useState<GitRepository[]>([]);
  const [gitStatuses, setGitStatuses] = useState<Map<string, GitStatus>>(() => new Map());
  const [commandGroups, setCommandGroups] = useState<ActionGroup[]>([]);
  const [commandQuery, setCommandQuery] = useState("");
  const [launcherBrowserRequest, setLauncherBrowserRequest] = useState<LauncherBrowserRequest | null>(null);
  const [launcherPaneRequest, setLauncherPaneRequest] = useState<LauncherPaneRequest | null>(null);
  const [launcherTerminalRequest, setLauncherTerminalRequest] = useState<LauncherTerminalRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<AppModal | null>(null);
  const saveSequenceRef = useRef<Map<string, number>>(new Map());
  const saveQueueRef = useRef<Map<string, Promise<void>>>(new Map());
  const activeTheme = useMemo(() => resolveWorkspaceTheme(activeWorkspace?.settings), [activeWorkspace?.settings]);

  useEffect(() => {
    applyWorkspaceTheme(activeTheme);
  }, [activeTheme]);

  const refreshWorkspaces = useCallback(async () => {
    const result = await client.workspace.list();
    setWorkspaces(result.workspaces);
    setActiveWorkspaceId(result.activeWorkspaceId);
    return result;
  }, [client]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await refreshWorkspaces();
        const id = initialWorkspaceId ?? list.activeWorkspaceId;
        const response = await client.workspace.get({ id });
        if (cancelled) return;
        setActiveWorkspace(workspaceForEntry(response.workspace));
        setActiveWorkspaceId(response.workspace.id);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, initialWorkspaceId, refreshWorkspaces]);

  const onRequestTree = useCallback(
    (path: string) => {
      void (async () => {
        try {
          const result = await client.fs.tree({ path });
          setFileTrees((prev) => {
            const next = new Map(prev);
            next.set(path, result.entries as FsEntry[]);
            return next;
          });
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })();
    },
    [client],
  );

  const onReadFile = useCallback(
    async (path: string) => {
      const result = await client.fs.readFile({ path });
      return result.body as string;
    },
    [client],
  );

  const onWriteFile = useCallback(
    async (path: string, body: string) => {
      await client.fs.writeFile({ path, body });
    },
    [client],
  );

  const onMkdir = useCallback(
    async (path: string) => {
      await client.fs.mkdir({ path });
    },
    [client],
  );

  const onCreateFile = useCallback(
    async (path: string, kind: "markdown" | "json" | "yaml" | "typescript" | "plain") => {
      await client.fs.createFile({ path, kind });
    },
    [client],
  );

  const onDeleteEntry = useCallback(
    async (path: string) => {
      await client.fs.delete({ path });
    },
    [client],
  );

  const onRequestRepositories = useCallback(
    (rootPath: string) => {
      void (async () => {
        try {
          const result = await client.git.repositories({ rootPath });
          setRepositories(result.repositories);
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })();
    },
    [client],
  );

  const onRequestGitStatus = useCallback(
    async (repoPath: string) => {
      const result = await client.git.status({ repoPath });
      setGitStatuses((prev) => {
        const next = new Map(prev);
        next.set(repoPath, result.status);
        return next;
      });
      return result.status;
    },
    [client],
  );

  const onRequestGitDiff = useCallback(
    async (repoPath: string, path: string) => {
      const result = await client.git.diff({ repoPath, path });
      return result.diff;
    },
    [client],
  );

  const onBrowserNavigate = useCallback(
    async (workspaceId: string, paneId: string, url: string, replace?: boolean) => {
      const result = await client.browser.navigate({ workspaceId, paneId, url, replace });
      setActiveWorkspace((current) =>
        current?.id === result.workspace.id ? workspaceForCurrentView(result.workspace, current) : current,
      );
      setWorkspaces((prev) =>
        prev.map((workspace) => (workspace.id === result.workspace.id ? summarizeWorkspace(result.workspace) : workspace)),
      );
    },
    [client],
  );

  const onBrowserHistory = useCallback(
    async (workspaceId: string, paneId: string, direction: "back" | "forward") => {
      const result = await client.browser.history({ workspaceId, paneId, direction });
      setActiveWorkspace((current) =>
        current?.id === result.workspace.id ? workspaceForCurrentView(result.workspace, current) : current,
      );
      setWorkspaces((prev) =>
        prev.map((workspace) => (workspace.id === result.workspace.id ? summarizeWorkspace(result.workspace) : workspace)),
      );
    },
    [client],
  );

  const onBrowserSync = useCallback(
    async (workspaceId: string) => {
      const result = await client.workspace.get({ id: workspaceId });
      setActiveWorkspace((current) =>
        current?.id === result.workspace.id ? workspaceForCurrentView(result.workspace, current) : current,
      );
      setWorkspaces((prev) =>
        prev.map((workspace) => (workspace.id === result.workspace.id ? summarizeWorkspace(result.workspace) : workspace)),
      );
    },
    [client],
  );

  const onWorkspaceChange = useCallback(
    (nextWorkspace: Workspace) => {
      const nextSequence = (saveSequenceRef.current.get(nextWorkspace.id) ?? 0) + 1;
      saveSequenceRef.current.set(nextWorkspace.id, nextSequence);
      setActiveWorkspace(nextWorkspace);
      setWorkspaces((prev) =>
        prev.map((workspace) => (workspace.id === nextWorkspace.id ? summarizeWorkspace(nextWorkspace) : workspace)),
      );
      const previousSave = saveQueueRef.current.get(nextWorkspace.id) ?? Promise.resolve();
      const saveTask = previousSave.catch(() => undefined).then(async () => {
        try {
          const saved = await client.workspace.save({ workspace: nextWorkspace });
          if (saveSequenceRef.current.get(saved.workspace.id) !== nextSequence) return;
          setActiveWorkspace((current) =>
            current?.id === saved.workspace.id ? workspaceForCurrentView(saved.workspace, current) : current,
          );
          setWorkspaces((prev) =>
            prev.map((workspace) => (workspace.id === saved.workspace.id ? summarizeWorkspace(saved.workspace) : workspace)),
          );
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
      saveQueueRef.current.set(nextWorkspace.id, saveTask);
      void saveTask.finally(() => {
        if (saveQueueRef.current.get(nextWorkspace.id) === saveTask) saveQueueRef.current.delete(nextWorkspace.id);
      });
    },
    [client],
  );

  const switchWorkspace = useCallback(
    async (id: string) => {
      if (id === activeWorkspaceId) return;
      setBusy(true);
      try {
        const response = await client.workspace.setActive({ id });
        setActiveWorkspace(workspaceForEntry(response.workspace));
        setActiveWorkspaceId(response.workspace.id);
        setCommandQuery("");
        setFileTrees(new Map());
        setRepositories([]);
        setGitStatuses(new Map());
        await refreshWorkspaces();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [activeWorkspaceId, client, refreshWorkspaces],
  );

  const createWorkspace = useCallback(async () => {
    setBusy(true);
    try {
      const response = await client.workspace.create();
      setActiveWorkspace(workspaceForEntry(response.workspace));
      setActiveWorkspaceId(response.workspace.id);
      setFileTrees(new Map());
      setRepositories([]);
      setGitStatuses(new Map());
      await refreshWorkspaces();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [client, refreshWorkspaces]);

  const renameWorkspace = useCallback(
    (id: string) => {
      const workspace = workspaces.find((candidate) => candidate.id === id);
      if (!workspace) return;
      setModal({
        kind: "rename",
        title: "Rename Workspace",
        label: workspace.label,
        onSubmit: (label) => {
          void (async () => {
            try {
              const response = await client.workspace.rename({ id, label });
              if (response.workspace.id === activeWorkspace?.id) {
                setActiveWorkspace((current) =>
                  current?.id === response.workspace.id ? workspaceForCurrentView(response.workspace, current) : current,
                );
              }
              await refreshWorkspaces();
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            }
          })();
        },
      });
    },
    [activeWorkspace?.id, client, refreshWorkspaces, workspaces],
  );

  const closeWorkspace = useCallback(
    (id: string) => {
      const workspace = workspaces.find((candidate) => candidate.id === id);
      if (!workspace) return;
      setModal({
        kind: "confirm",
        title: "Close Workspace",
        message: workspace.label,
        confirmLabel: "Close",
        onConfirm: () => {
          void (async () => {
            setBusy(true);
            try {
              const response = await client.workspace.close({ id });
              setWorkspaces(response.workspaces);
              setActiveWorkspaceId(response.activeWorkspaceId);
              const active = await client.workspace.get({ id: response.activeWorkspaceId });
              setActiveWorkspace(workspaceForEntry(active.workspace));
              setFileTrees(new Map());
              setRepositories([]);
              setGitStatuses(new Map());
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            } finally {
              setBusy(false);
            }
          })();
        },
      });
    },
    [client, workspaces],
  );

  const onWebSubmit = useCallback((query: string) => {
    const url = urlForLauncherQuery(query);
    if (!url) return;
    setLauncherBrowserRequest((current) => ({ id: (current?.id ?? 0) + 1, url }));
  }, []);

  const onTerminalSubmit = useCallback((input: string) => {
    const trimmed = input.trim();
    if (!trimmed) return;
    setLauncherTerminalRequest((current) => ({ id: (current?.id ?? 0) + 1, input: trimmed }));
  }, []);

  const launcherGroups = useMemo(
    () =>
      buildLauncherGroups({
        query: commandQuery,
        workspace: activeWorkspace,
        fileTrees,
        onOpenFile: (path) => setLauncherPaneRequest((current) => ({ id: (current?.id ?? 0) + 1, kind: "file", path })),
        onOpenFolder: (path) =>
          setLauncherPaneRequest((current) => ({ id: (current?.id ?? 0) + 1, kind: "folder", path })),
        onSearchWeb: onWebSubmit,
      }),
    [activeWorkspace, commandQuery, fileTrees, onWebSubmit],
  );

  const toggleActiveView = useCallback(() => {
    if (!activeWorkspace) return;
    onWorkspaceChange({
      ...activeWorkspace,
      activeView: activeWorkspace.activeView === "panes" ? "canvas" : "panes",
    });
  }, [activeWorkspace, onWorkspaceChange]);

  return (
    <div className={className ?? "relative h-screen overflow-hidden"}>
      <main className="relative h-[calc(100%-3rem)] overflow-hidden">
        <div key={activeWorkspace?.id ?? "loading"} className="h-full">
          {activeWorkspace ? (
            <Canvas
              baseUrl={baseUrl}
              workspace={activeWorkspace}
              fileTrees={fileTrees}
              repositories={repositories}
              gitStatuses={gitStatuses}
              onWorkspaceChange={onWorkspaceChange}
              onCommandGroupsChange={setCommandGroups}
              onRequestTree={onRequestTree}
              onReadFile={onReadFile}
              onWriteFile={onWriteFile}
              onMkdir={onMkdir}
              onCreateFile={onCreateFile}
              onDeleteEntry={onDeleteEntry}
              onRequestRepositories={onRequestRepositories}
              onRequestGitStatus={onRequestGitStatus}
              onRequestGitDiff={onRequestGitDiff}
              onBrowserNavigate={onBrowserNavigate}
              onBrowserHistory={onBrowserHistory}
              onBrowserSync={onBrowserSync}
              launcherBrowserRequest={launcherBrowserRequest}
              onLauncherBrowserRequestHandled={() => setLauncherBrowserRequest(null)}
              launcherPaneRequest={launcherPaneRequest}
              onLauncherPaneRequestHandled={() => setLauncherPaneRequest(null)}
              launcherTerminalRequest={launcherTerminalRequest}
              onLauncherTerminalRequestHandled={() => setLauncherTerminalRequest(null)}
            />
          ) : (
            <div className="flex h-full items-center justify-center bg-background font-mono text-sm text-muted-foreground">
              loading workspace
            </div>
          )}
        </div>
      </main>

      {error ? <ErrorToast message={error} onDismiss={() => setError(null)} /> : null}

      <Dock
        busy={busy}
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        activeView={activeWorkspace?.activeView ?? "panes"}
        onSwitchWorkspace={(id) => void switchWorkspace(id)}
        onCreateWorkspace={() => void createWorkspace()}
        onRenameWorkspace={renameWorkspace}
        onCloseWorkspace={closeWorkspace}
        onToggleView={toggleActiveView}
        commandQuery={commandQuery}
        onCommandQueryChange={setCommandQuery}
        commandGroups={commandGroups}
        launcherGroups={launcherGroups}
        onTerminalSubmit={onTerminalSubmit}
      />

      {modal ? <AppModalView modal={modal} onClose={() => setModal(null)} /> : null}
    </div>
  );
}

export default function App() {
  return <CanvasMount />;
}

export function workspaceForEntry(workspace: Workspace): Workspace {
  return { ...workspace, activeView: workspace.settings.defaultView };
}

export function workspaceForCurrentView(workspace: Workspace, current: Workspace): Workspace {
  return { ...workspace, activeView: current.activeView };
}

function ErrorToast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <button
      type="button"
      onClick={onDismiss}
      className="fixed right-4 top-4 z-[90] max-w-md rounded-md border border-border bg-secondary px-4 py-3 text-left text-sm text-foreground shadow-lg"
    >
      {message}
    </button>
  );
}

function AppModalView({ modal, onClose }: { modal: AppModal; onClose: () => void }) {
  const [value, setValue] = useState(modal.kind === "rename" ? modal.label : "");
  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-background/80" data-context-menu>
      <form
        className="w-[380px] max-w-[calc(100vw-2rem)] rounded-md border border-border bg-[var(--panel-bg)] p-4 shadow-xl backdrop-blur-xl"
        onSubmit={(event) => {
          event.preventDefault();
          if (modal.kind === "rename") {
            const trimmed = value.trim();
            if (!trimmed) return;
            modal.onSubmit(trimmed);
          } else {
            modal.onConfirm();
          }
          onClose();
        }}
      >
        <div className="text-base font-semibold">{modal.title}</div>
        {modal.kind === "rename" ? (
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className="mt-4 w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
          />
        ) : (
          <div className="mt-2 break-all text-sm text-muted-foreground">{modal.message}</div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
          <button type="submit" className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground">
            {modal.kind === "rename" ? "Rename" : modal.confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

function summarizeWorkspace(workspace: Workspace): WorkspaceSummary {
  return {
    id: workspace.id,
    label: workspace.label,
    rootPath: workspace.rootPath,
    activeView: workspace.activeView,
    paneCount: workspace.panes.length,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
    lastOpenedAt: workspace.lastOpenedAt,
  };
}

function buildLauncherGroups({
  query,
  workspace,
  fileTrees,
  onOpenFile,
  onOpenFolder,
  onSearchWeb,
}: {
  query: string;
  workspace: Workspace | null;
  fileTrees: Map<string, FsEntry[]>;
  onOpenFile: (path: string) => void;
  onOpenFolder: (path: string) => void;
  onSearchWeb: (query: string) => void;
}): ActionGroup[] {
  const trimmed = query.trim();
  if (!trimmed || trimmed.startsWith("/") || trimmed.startsWith(">")) return [];
  const groups: ActionGroup[] = [
    {
      id: "web",
      label: "Web",
      items: [
        {
          id: "web.search",
          label: urlForLauncherQuery(trimmed)?.startsWith("http") ? "Open URL" : "Search Web",
          hint: urlForLauncherQuery(trimmed) ?? undefined,
          onSelect: () => onSearchWeb(trimmed),
        },
      ],
    },
  ];
  if (!workspace) return groups;

  const fileItems: ActionItem[] = [
    {
      id: `path:${trimmed}`,
      label: `Open ${trimmed}`,
      hint: joinPath(workspace.rootPath, trimmed),
      onSelect: () => onOpenFolder(joinPath(workspace.rootPath, trimmed)),
    },
  ];
  for (const entries of fileTrees.values()) {
    for (const entry of entries) {
      if (!matchesSubsequence(trimmed, `${entry.name} ${entry.path}`)) continue;
      fileItems.push({
        id: `entry:${entry.path}`,
        label: entry.name,
        hint: entry.path,
        onSelect: () => (entry.kind === "file" ? onOpenFile(entry.path) : onOpenFolder(entry.path)),
      });
      if (fileItems.length >= 16) break;
    }
    if (fileItems.length >= 16) break;
  }
  groups.push({ id: "files", label: "Files", items: fileItems });
  return groups;
}

function joinPath(parent: string, name: string): string {
  const trimmed = name.replace(/^\/+/, "");
  if (!trimmed) return parent;
  if (parent === "/" || parent === "") return `/${trimmed}`;
  return `${parent}/${trimmed}`;
}
