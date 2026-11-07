import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  context as standaloneContext,
  parseRepositoryContext,
  type RepositoryContext,
  type RepositoryIdentity,
} from "./repository-context";

/**
 * Read-only repository context adapter. The future unified app owns source
 * authorization, repository selection, and document retrieval. Canvas never
 * writes to an independent persistence authority through this interface.
 */
export type RuntimeRepositoryAdapter = {
  load(selection: RepositoryIdentity, signal: AbortSignal): Promise<unknown>;
  list?(signal: AbortSignal): Promise<RepositoryIdentity[]>;
};

type RuntimeRepositoryState = {
  context: RepositoryContext | null;
  selection: RepositoryIdentity | null;
  available: RepositoryIdentity[];
  loading: boolean;
  error: string | null;
  select(identity: RepositoryIdentity): void;
};

function sameIdentity(a: RepositoryIdentity | null, b: RepositoryIdentity | null): boolean {
  return (
    !!a &&
    !!b &&
    a.provider === b.provider &&
    a.id === b.id &&
    a.ref === b.ref &&
    a.revision === b.revision
  );
}

/** No build-time fallback is permitted once a runtime adapter is active. */
export function verifyRuntimeContext(
  payload: unknown,
  selection: RepositoryIdentity,
): RepositoryContext {
  const parsed = parseRepositoryContext(payload);
  if (parsed.schema !== 2 || !sameIdentity(parsed.repositoryIdentity, selection)) {
    throw new Error("Runtime repository context did not match the selected immutable identity.");
  }
  return parsed;
}

const RuntimeRepository = createContext<RuntimeRepositoryState | null>(null);

export function RuntimeRepositoryProvider({
  adapter,
  selected,
  children,
}: {
  adapter?: RuntimeRepositoryAdapter;
  selected?: RepositoryIdentity;
  children: ReactNode;
}) {
  const [selection, setSelection] = useState<RepositoryIdentity | null>(
    selected ?? standaloneContext.repositoryIdentity,
  );
  const [data, setData] = useState<RepositoryContext | null>(adapter ? null : standaloneContext);
  const [available, setAvailable] = useState<RepositoryIdentity[]>([]);
  const [loading, setLoading] = useState(!!adapter);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const invalidSelection = useRef(false);
  const select = useCallback((identity: RepositoryIdentity) => {
    // Clear old repository content synchronously, before any new async load.
    if (!identity.provider || !identity.id || !identity.ref || !identity.revision) {
      // Invalid selections are still revocation boundaries. Without advancing
      // the generation and clearing the old selection, an outstanding request
      // could repopulate private content after the error was displayed.
      invalidSelection.current = true;
      generation.current++;
      setData(null);
      setSelection(null);
      setLoading(false);
      setError("Invalid repository identity.");
      return;
    }
    invalidSelection.current = false;
    generation.current++;
    setData(null);
    setLoading(true);
    setError(null);
    setSelection({ ...identity });
  }, []);

  useEffect(() => {
    if (!adapter) {
      setData(standaloneContext);
      setLoading(false);
      return;
    }
    // Abort previous loads and reject any stale asynchronous result.
    const current = ++generation.current;
    const controller = new AbortController();
    setData(null);
    setError(null);
    setLoading(true);
    const active = selection;
    if (!active) {
      setError(
        invalidSelection.current
          ? "Invalid repository identity."
          : "Select a repository to load source context.",
      );
      setLoading(false);
      return () => controller.abort();
    }
    void adapter
      .load(active, controller.signal)
      .then((payload) => {
        const context = verifyRuntimeContext(payload, active);
        if (controller.signal.aborted || generation.current !== current) return;
        setData(context);
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted || generation.current !== current) return;
        setData(null);
        setError(reason instanceof Error ? reason.message : String(reason));
        setLoading(false);
      });
    return () => controller.abort();
  }, [adapter, selection]);

  useEffect(() => {
    if (!adapter?.list) return;
    const controller = new AbortController();
    void adapter
      .list(controller.signal)
      .then((identities) => {
        if (controller.signal.aborted) return;
        setAvailable(
          identities.filter(
            (candidate) =>
              typeof candidate.provider === "string" &&
              typeof candidate.id === "string" &&
              typeof candidate.ref === "string" &&
              typeof candidate.revision === "string",
          ),
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) setAvailable([]);
      });
    return () => controller.abort();
  }, [adapter]);

  const value = useMemo(
    () => ({ context: data, selection, available, loading, error, select }),
    [data, selection, available, loading, error, select],
  );
  return <RuntimeRepository.Provider value={value}>{children}</RuntimeRepository.Provider>;
}

export function useRuntimeRepository(): RuntimeRepositoryState {
  const current = useContext(RuntimeRepository);
  if (!current) throw new Error("Canvas must be hosted by RuntimeRepositoryProvider.");
  return current;
}

export function useRepositoryContext(): RepositoryContext {
  const current = useRuntimeRepository();
  if (!current.context) throw new Error("No authenticated repository context is loaded.");
  return current.context;
}

export function RuntimeRepositoryGate({ children }: { children: ReactNode }) {
  const { context, loading, error } = useRuntimeRepository();
  if (loading) return <main role="status">Loading selected repository context…</main>;
  if (error) return <main role="alert">{error}</main>;
  if (!context) return <main role="status">No repository is selected.</main>;
  return <>{children}</>;
}
