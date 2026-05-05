import type { ActionGroup } from "@/ActionsMenu.tsx";
import { Canvas, type FsEntry } from "@/Canvas.tsx";
import { Dock } from "@/Dock.tsx";
import { makeBrowserClient } from "@/client.ts";
import type { CanvasSession, CanvasSessionSummary, GraphExecutionResult, GraphIssue } from "@/schema.ts";
import { motion } from "motion/react";
import { useCallback, useEffect, useMemo, useState } from "react";

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

export default function App() {
  const client = useMemo(() => makeBrowserClient(), []);
  const [sessions, setSessions] = useState<CanvasSessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeSession, setActiveSession] = useState<CanvasSession | null>(null);
  const [fileTrees, setFileTrees] = useState<Map<string, FsEntry[]>>(() => new Map());
  const [graphIssues, setGraphIssues] = useState<GraphIssue[]>([]);
  const [lastRun, setLastRun] = useState<GraphExecutionResult | null>(null);
  const [commandGroups, setCommandGroups] = useState<ActionGroup[]>([]);
  const [commandQuery, setCommandQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<AppModal | null>(null);

  const refreshSessions = useCallback(async () => {
    const result = (await client.session.list.query()) as {
      activeSessionId: string;
      sessions: CanvasSessionSummary[];
    };
    setSessions(result.sessions);
    setActiveSessionId(result.activeSessionId);
    return result;
  }, [client]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await refreshSessions();
        const active = (await client.session.get.query({ id: list.activeSessionId })) as { session: CanvasSession };
        if (cancelled) return;
        setActiveSession(active.session);
        const validation = (await client.graph.validate.query({ graph: active.session.graph })) as {
          issues: GraphIssue[];
        };
        if (!cancelled) setGraphIssues(validation.issues);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, refreshSessions]);

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

  const onSessionChange = useCallback(
    (nextSession: CanvasSession) => {
      setActiveSession(nextSession);
      setSessions((prev) => prev.map((session) => (session.id === nextSession.id ? summarizeSession(nextSession) : session)));
      void (async () => {
        try {
          const saved = (await client.session.save.mutate({ session: nextSession })) as { session: CanvasSession };
          setActiveSession((current) => (current?.id === saved.session.id ? saved.session : current));
          setSessions((prev) =>
            prev.map((session) => (session.id === saved.session.id ? summarizeSession(saved.session) : session)),
          );
          const validation = (await client.graph.validate.query({ graph: saved.session.graph })) as {
            issues: GraphIssue[];
          };
          setGraphIssues(validation.issues);
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })();
    },
    [client],
  );

  const switchSession = useCallback(
    async (id: string) => {
      if (id === activeSessionId) return;
      setBusy(true);
      try {
        const response = (await client.session.setActive.mutate({ id })) as { session: CanvasSession };
        setActiveSession(response.session);
        setActiveSessionId(response.session.id);
        setLastRun(null);
        setCommandQuery("");
        await refreshSessions();
        const validation = (await client.graph.validate.query({ graph: response.session.graph })) as {
          issues: GraphIssue[];
        };
        setGraphIssues(validation.issues);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [activeSessionId, client, refreshSessions],
  );

  const createSession = useCallback(async () => {
    setBusy(true);
    try {
      const response = (await client.session.create.mutate({})) as { session: CanvasSession };
      setActiveSession(response.session);
      setActiveSessionId(response.session.id);
      setLastRun(null);
      setGraphIssues([]);
      await refreshSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [client, refreshSessions]);

  const renameSession = useCallback(
    (id: string) => {
      const session = sessions.find((candidate) => candidate.id === id);
      if (!session) return;
      setModal({
        kind: "rename",
        title: "Rename Canvas",
        label: session.label,
        onSubmit: (label) => {
          void (async () => {
            try {
              const response = (await client.session.rename.mutate({ id, label })) as { session: CanvasSession };
              if (response.session.id === activeSession?.id) setActiveSession(response.session);
              await refreshSessions();
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            }
          })();
        },
      });
    },
    [activeSession?.id, client, refreshSessions, sessions],
  );

  const closeSession = useCallback(
    (id: string) => {
      const session = sessions.find((candidate) => candidate.id === id);
      if (!session) return;
      setModal({
        kind: "confirm",
        title: "Close Canvas",
        message: session.label,
        confirmLabel: "Close",
        onConfirm: () => {
          void (async () => {
            setBusy(true);
            try {
              const response = (await client.session.close.mutate({ id })) as {
                activeSessionId: string;
                sessions: CanvasSessionSummary[];
              };
              setSessions(response.sessions);
              setActiveSessionId(response.activeSessionId);
              const active = (await client.session.get.query({ id: response.activeSessionId })) as {
                session: CanvasSession;
              };
              setActiveSession(active.session);
              setLastRun(null);
              setGraphIssues([]);
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            } finally {
              setBusy(false);
            }
          })();
        },
      });
    },
    [client, sessions],
  );

  const executeGraph = useCallback(
    async (nodeId?: string) => {
      if (!activeSession) return;
      setBusy(true);
      try {
        const response = await client.graph.execute.mutate({
          graph: activeSession.graph,
          nodeId: nodeId ?? null,
        });
        const result = response.result as GraphExecutionResult;
        setLastRun(result);
        setGraphIssues(result.issues);
        if (!result.ok && result.issues.length === 0) {
          const failed = result.steps.find((step) => step.status === "failed");
          setError(failed?.error ?? "graph execution failed");
        } else {
          setError(null);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [activeSession, client],
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

  return (
    <div className="relative h-screen overflow-hidden">
      <main className="relative h-full overflow-hidden">
        <motion.div
          key={activeSession?.id ?? "loading"}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="h-full"
        >
          {activeSession ? (
            <Canvas
              session={activeSession}
              fileTrees={fileTrees}
              graphIssues={graphIssues}
              lastRun={lastRun}
              onSessionChange={onSessionChange}
              onCommandGroupsChange={setCommandGroups}
              onRequestTree={onRequestTree}
              onReadFile={onReadFile}
              onWriteFile={onWriteFile}
              onMkdir={onMkdir}
              onCreateFile={onCreateFile}
              onDeleteEntry={onDeleteEntry}
              onExecuteGraph={executeGraph}
            />
          ) : (
            <div className="flex h-full items-center justify-center bg-[#090d12] font-mono text-sm text-muted-foreground">
              loading canvas
            </div>
          )}
        </motion.div>
      </main>

      {error ? <ErrorToast message={error} onDismiss={() => setError(null)} /> : null}

      <Dock
        busy={busy}
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSwitchSession={(id) => void switchSession(id)}
        onCreateSession={() => void createSession()}
        onRenameSession={renameSession}
        onCloseSession={closeSession}
        commandQuery={commandQuery}
        onCommandQueryChange={setCommandQuery}
        commandGroups={commandGroups}
        onCommandSubmit={onCommandSubmit}
      />

      {modal ? <AppModalView modal={modal} onClose={() => setModal(null)} /> : null}
    </div>
  );
}

function ErrorToast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <button
      type="button"
      onClick={onDismiss}
      className="glass-heavy fixed right-4 top-4 z-[90] max-w-md rounded-lg border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-left text-sm text-rose-100 shadow-2xl"
    >
      {message}
    </button>
  );
}

function AppModalView({ modal, onClose }: { modal: AppModal; onClose: () => void }) {
  const [value, setValue] = useState(modal.kind === "rename" ? modal.label : "");
  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/45 backdrop-blur-sm" data-context-menu>
      <form
        className="glass-heavy w-[380px] max-w-[calc(100vw-2rem)] rounded-lg border border-white/10 p-4 shadow-2xl"
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
            className="mt-4 w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-sky-400/50"
          />
        ) : (
          <div className="mt-2 break-all text-sm text-muted-foreground">{modal.message}</div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-white/10 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
          <button type="submit" className="rounded-md bg-sky-500/80 px-3 py-1.5 text-sm text-white hover:bg-sky-500">
            {modal.kind === "rename" ? "Rename" : modal.confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

function summarizeSession(session: CanvasSession): CanvasSessionSummary {
  return {
    id: session.id,
    label: session.label,
    rootPath: session.rootPath,
    address: session.address,
    panelCount: session.openPanels.length,
    graphNodeCount: session.graph.nodes.length,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    lastOpenedAt: session.lastOpenedAt,
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
