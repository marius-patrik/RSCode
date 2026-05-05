import type { ActionGroup } from "@/ActionsMenu.tsx";
import { Canvas, type FsEntry } from "@/Canvas.tsx";
import { Dock } from "@/Dock.tsx";
import { makeClient } from "@/client.ts";
import type { GitDiff, GitRepository, GitStatus, Workspace, WorkspaceSummary } from "@/schema.ts";
import { useCallback, useEffect, useMemo, useState } from "react";

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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<AppModal | null>(null);
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem("canvas-theme") !== "light";
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
    document.documentElement.dataset.theme = darkMode ? "dark" : "light";
    window.localStorage.setItem("canvas-theme", darkMode ? "dark" : "light");
  }, [darkMode]);

  const refreshWorkspaces = useCallback(async () => {
    const result = (await client.workspace.list.query()) as {
      activeWorkspaceId: string;
      workspaces: WorkspaceSummary[];
    };
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
        const response = (await client.workspace.get.query({ id })) as { workspace: Workspace };
        if (cancelled) return;
        setActiveWorkspace(response.workspace);
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
          const result = await client.fs.tree.query({ path });
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
      const result = await client.fs.readFile.query({ path });
      return result.body as string;
    },
    [client],
  );

  const onWriteFile = useCallback(
    async (path: string, body: string) => {
      await client.fs.writeFile.mutate({ path, body });
    },
    [client],
  );

  const onMkdir = useCallback(
    async (path: string) => {
      await client.fs.mkdir.mutate({ path });
    },
    [client],
  );

  const onCreateFile = useCallback(
    async (path: string, kind: "markdown" | "json" | "yaml" | "typescript" | "plain") => {
      await client.fs.createFile.mutate({ path, kind });
    },
    [client],
  );

  const onDeleteEntry = useCallback(
    async (path: string) => {
      await client.fs.delete.mutate({ path });
    },
    [client],
  );

  const onRequestRepositories = useCallback(
    (rootPath: string) => {
      void (async () => {
        try {
          const result = (await client.git.repositories.query({ rootPath })) as {
            repositories: GitRepository[];
          };
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
      const result = (await client.git.status.query({ repoPath })) as { status: GitStatus };
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
      const result = (await client.git.diff.query({ repoPath, path })) as { diff: GitDiff };
      return result.diff;
    },
    [client],
  );

  const onBrowserNavigate = useCallback(
    async (workspaceId: string, paneId: string, url: string) => {
      const result = (await client.browser.navigate.mutate({ workspaceId, paneId, url })) as {
        workspace: Workspace;
      };
      setActiveWorkspace((current) => (current?.id === result.workspace.id ? result.workspace : current));
      setWorkspaces((prev) =>
        prev.map((workspace) => (workspace.id === result.workspace.id ? summarizeWorkspace(result.workspace) : workspace)),
      );
    },
    [client],
  );

  const onWorkspaceChange = useCallback(
    (nextWorkspace: Workspace) => {
      setActiveWorkspace(nextWorkspace);
      setWorkspaces((prev) =>
        prev.map((workspace) => (workspace.id === nextWorkspace.id ? summarizeWorkspace(nextWorkspace) : workspace)),
      );
      void (async () => {
        try {
          const saved = (await client.workspace.save.mutate({ workspace: nextWorkspace })) as { workspace: Workspace };
          setActiveWorkspace((current) => (current?.id === saved.workspace.id ? saved.workspace : current));
          setWorkspaces((prev) =>
            prev.map((workspace) => (workspace.id === saved.workspace.id ? summarizeWorkspace(saved.workspace) : workspace)),
          );
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })();
    },
    [client],
  );

  const switchWorkspace = useCallback(
    async (id: string) => {
      if (id === activeWorkspaceId) return;
      setBusy(true);
      try {
        const response = (await client.workspace.setActive.mutate({ id })) as { workspace: Workspace };
        setActiveWorkspace(response.workspace);
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
      const response = (await client.workspace.create.mutate({})) as { workspace: Workspace };
      setActiveWorkspace(response.workspace);
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
              const response = (await client.workspace.rename.mutate({ id, label })) as { workspace: Workspace };
              if (response.workspace.id === activeWorkspace?.id) setActiveWorkspace(response.workspace);
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
              const response = (await client.workspace.close.mutate({ id })) as {
                activeWorkspaceId: string;
                workspaces: WorkspaceSummary[];
              };
              setWorkspaces(response.workspaces);
              setActiveWorkspaceId(response.activeWorkspaceId);
              const active = (await client.workspace.get.query({ id: response.activeWorkspaceId })) as {
                workspace: Workspace;
              };
              setActiveWorkspace(active.workspace);
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

  const onCommandSubmit = useCallback(
    (idx: number) => {
      const filterText = commandQuery.trim().toLowerCase();
      const flat: Array<{ run: () => void; disabled: boolean }> = [];
      for (const group of commandGroups) {
        for (const item of group.items) {
          if (!filterText || subseq(filterText, `${group.label} ${item.label} ${item.hint ?? ""}`)) {
            flat.push({ run: item.onSelect, disabled: Boolean(item.disabledReason) });
          }
        }
      }
      const picked = flat[idx];
      if (picked && !picked.disabled) picked.run();
    },
    [commandGroups, commandQuery],
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
        darkMode={darkMode}
        onSwitchWorkspace={(id) => void switchWorkspace(id)}
        onCreateWorkspace={() => void createWorkspace()}
        onRenameWorkspace={renameWorkspace}
        onCloseWorkspace={closeWorkspace}
        onToggleView={toggleActiveView}
        onToggleTheme={() => setDarkMode((current) => !current)}
        commandQuery={commandQuery}
        onCommandQueryChange={setCommandQuery}
        commandGroups={commandGroups}
        onCommandSubmit={onCommandSubmit}
      />

      {modal ? <AppModalView modal={modal} onClose={() => setModal(null)} /> : null}
    </div>
  );
}

export default function App() {
  return <CanvasMount />;
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
        className="w-[380px] max-w-[calc(100vw-2rem)] rounded-md border border-border bg-background p-4 shadow-xl"
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

function subseq(query: string, target: string): boolean {
  const text = target.toLowerCase();
  let i = 0;
  for (const ch of query) {
    const found = text.indexOf(ch, i);
    if (found === -1) return false;
    i = found + 1;
  }
  return true;
}
