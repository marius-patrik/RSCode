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
import { useWorkspace } from "@/workspace/context";
import {
  assembleIssueDrafts,
  calculateDiscrepancies,
  desiredPaths,
  parseContract,
  validateContract,
  type Contract,
  type FileEvidence,
} from "./contracts";

export type FactoryConcern = "overview" | "specification" | "delta" | "repository";
export type FactoryDocument = {
  path: string;
  raw: string;
  contract: Contract | null;
  error: string | null;
};
type FactoryState = {
  concern: FactoryConcern;
  selectedPath: string | null;
  selectPath: (path: string | null) => void;
  setConcern: (concern: FactoryConcern) => void;
  desired: FactoryDocument | null;
  reported: FactoryDocument | null;
  desiredFiles: FileEvidence[];
  actualFiles: FileEvidence[];
  changes: ReturnType<typeof calculateDiscrepancies>;
  drafts: ReturnType<typeof assembleIssueDrafts>;
  validation: string[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
};

const FactoryContext = createContext<FactoryState | null>(null);
const DESIRED_PATHS = [".agents/PRD.md", "PRD.md", "docs/PRD.md"];
const REPORTED_PATHS = [".agents/ARCHITECTURE.md", "ARCHITECTURE.md", "docs/ARCHITECTURE.md"];

function persistedConcern(): FactoryConcern {
  try {
    const value = localStorage.getItem("ghcode-concern");
    if (
      value === "overview" ||
      value === "specification" ||
      value === "delta" ||
      value === "repository"
    )
      return value;
  } catch {
    /* Storage can be unavailable in private browsing. */
  }
  return "repository";
}

function fileInventory(
  remote: Array<{ path: string; type: string }>,
  committed: Array<{ path: string; deleted: boolean }>,
  local: Array<{ path: string; status: string }>,
): FileEvidence[] {
  const entries = new Map<string, FileEvidence>();
  for (const file of remote) {
    if (file.type === "blob") entries.set(file.path, { path: file.path, type: "file" });
    else if (file.type === "tree") entries.set(file.path, { path: file.path, type: "dir" });
  }
  for (const file of committed) {
    if (file.deleted) entries.delete(file.path);
    else entries.set(file.path, { path: file.path, type: "file" });
  }
  for (const file of local) {
    if (file.status === "deleted") entries.delete(file.path);
    else entries.set(file.path, { path: file.path, type: "file" });
  }
  return [...entries.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export function FactoryProvider({ children }: { children: ReactNode }) {
  const workspace = useWorkspace();
  const [concern, setConcern] = useState<FactoryConcern>(persistedConcern);
  const [selectedPath, selectPath] = useState<string | null>(null);
  const [desired, setDesired] = useState<FactoryDocument | null>(null);
  const [reported, setReported] = useState<FactoryDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);
  const project = workspace.workspace;
  const actualFiles = useMemo(
    () => fileInventory(project?.tree ?? [], workspace.committedFiles, workspace.overlays),
    [project?.tree, workspace.committedFiles, workspace.overlays],
  );
  const fileSet = useMemo(
    () => new Set(actualFiles.filter((f) => f.type === "file").map((f) => f.path)),
    [actualFiles],
  );
  const refresh = useCallback(() => setNonce((value) => value + 1), []);
  const previousProject = useRef<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem("ghcode-concern", concern);
    } catch {
      /* Optional persistence. */
    }
  }, [concern]);

  useEffect(() => {
    const id = project?.id ?? null;
    if (previousProject.current !== id) {
      previousProject.current = id;
      selectPath(null);
    }
  }, [project]);

  useEffect(() => {
    // An explicit refresh request must reload even when the workspace snapshot is unchanged.
    void nonce;
    let active = true;
    setDesired(null);
    setReported(null);
    setError(null);
    if (!project) {
      setLoading(false);
      return () => {
        active = false;
      };
    }
    setLoading(true);
    const read = async (paths: string[]): Promise<FactoryDocument | null> => {
      const path = paths.find((item) => fileSet.has(item));
      if (!path) return null;
      const raw = await workspace.readFile(path);
      try {
        return { path, raw, contract: parseContract(raw).contract, error: null };
      } catch (reason) {
        return {
          path,
          raw,
          contract: null,
          error: reason instanceof Error ? reason.message : String(reason),
        };
      }
    };
    void Promise.all([read(DESIRED_PATHS), read(REPORTED_PATHS)])
      .then(([target, architecture]) => {
        if (!active) return;
        setDesired(target);
        setReported(architecture);
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [project, fileSet, workspace.readFile, nonce]);

  const desiredFiles = useMemo(() => desiredPaths(desired?.contract ?? null), [desired]);
  const changes = useMemo(
    () =>
      calculateDiscrepancies(
        desired?.contract ?? null,
        reported?.contract ?? null,
        actualFiles,
        Boolean(project),
      ),
    [desired, reported, actualFiles, project],
  );
  const drafts = useMemo(() => assembleIssueDrafts(changes), [changes]);
  const validation = useMemo(
    () => (desired?.contract ? validateContract(desired.contract) : []),
    [desired],
  );

  const value = useMemo<FactoryState>(
    () => ({
      concern,
      setConcern,
      selectedPath,
      selectPath,
      desired,
      reported,
      desiredFiles,
      actualFiles,
      changes,
      drafts,
      validation,
      loading,
      error,
      refresh,
    }),
    [
      concern,
      selectedPath,
      desired,
      reported,
      desiredFiles,
      actualFiles,
      changes,
      drafts,
      validation,
      loading,
      error,
      refresh,
    ],
  );

  return <FactoryContext.Provider value={value}>{children}</FactoryContext.Provider>;
}

export function useFactory() {
  const value = useContext(FactoryContext);
  if (!value) throw new Error("FactoryProvider is missing from the workbench");
  return value;
}
