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
  createGithubBlob,
  createGithubBranchRef,
  createGithubCommit,
  createGithubTree,
  getGithubBlob,
  getGithubBlobBytes,
  getGithubBranchRef,
  getGithubCommit,
  getGithubRepository,
  getGithubTree,
  downloadGithubRepositoryArchive,
  getGithubUser,
  listGithubRefs,
  listGithubRepositories,
  updateGithubBranchRef,
  type GithubRepository,
  type GithubUser,
} from "@/github/client";
import { clearGithubToken, getGithubToken, setGithubToken } from "@/github/auth";
import {
  parseRepositoryInput,
  repositoryFromGithub,
  type CommittedFile,
  type LocalCommit,
  type StagedFile,
  type WorkspaceSnapshot,
  type WorkingFile,
  type WorkingFileStatus,
} from "./model";
import {
  anonymousPrincipal,
  canonicalGitRef,
  createOwnedWorkspaceIdentity,
  githubPrincipal,
  isOwnedWorkspace,
  ownedWorkspaceId,
  repositoryIdentity,
  sameOwnership,
  type OwnershipGeneration,
  type Principal,
} from "./identity";
import { documentService } from "./document-service";
import {
  bindStoragePrincipal,
  beginPushOperation,
  compareAndSetOverlay,
  compareAndApplyStaged,
  advancePushOperation,
  finalizeConfirmedPush,
  loadPendingPushOperation,
  clearStaged,
  commitLocalChanges,
  loadBlob,
  loadCommittedFiles,
  loadLocalCommits,
  loadOverlays,
  loadRecentWorkspaces,
  loadStaged,
  loadWorkspace,
  rememberWorkspace,
  removeOverlay,
  removeStaged,
  saveBlob,
  saveCommittedFile,
  saveLocalCommit,
  saveOverlay,
  saveStaged,
  saveWorkspace,
} from "./storage";
import {
  createStoredZip,
  downloadBytes,
  downloadText,
  virtualFiles,
  wholeFilePatch,
} from "./export";

export type PatchExportScope = "all" | "working" | "staged" | "commits" | "commit";

export type PushReconciliation = {
  phase: "prepared" | "ready" | "remote-confirmed";
  expectedRemoteSha: string;
  observedRemoteSha: string | null;
  intendedTargetSha: string | null;
  localCommitIds: string[];
  reason: string;
};

type WorkspaceContextValue = {
  token: string | null;
  user: GithubUser | null;
  principal: Principal;
  authPhase: "signed-out" | "anonymous" | "resolving" | "authenticated" | "failed" | "invalidated";
  ownershipGeneration: number;
  repositories: GithubRepository[];
  workspace: WorkspaceSnapshot | null;
  refs: Awaited<ReturnType<typeof listGithubRefs>>;
  overlays: WorkingFile[];
  staged: StagedFile[];
  committedFiles: CommittedFile[];
  commits: LocalCommit[];
  recent: WorkspaceSnapshot[];
  remoteHeadSha: string | null;
  pendingPush: PushReconciliation | null;
  loading: boolean;
  error: string | null;
  dialogOpen: boolean;
  connectToken: (token: string) => Promise<void>;
  signOut: () => void;
  setDialogOpen: (open: boolean) => void;
  openRepository: (input: string, ref?: string) => Promise<void>;
  switchRef: (ref: string) => Promise<void>;
  refreshWorkspace: () => Promise<void>;
  syncWorkspace: () => Promise<void>;
  readBaseFile: (path: string, sha?: string) => Promise<string>;
  readBaselineFile: (path: string) => Promise<string>;
  readFile: (path: string, sha?: string) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;
  createFile: (path: string, content?: string) => Promise<void>;
  deletePath: (path: string) => Promise<void>;
  renamePath: (path: string, nextPath: string) => Promise<void>;
  fileStatus: (path: string) => WorkingFileStatus | null;
  stageFile: (path: string) => Promise<void>;
  stageAll: () => Promise<void>;
  unstageFile: (path: string) => Promise<void>;
  unstageAll: () => Promise<void>;
  discardFile: (path: string) => Promise<void>;
  commitStaged: (message: string) => Promise<LocalCommit>;
  createBranch: (branch: string) => Promise<void>;
  pushLocalCommits: () => Promise<string>;
  exportPatch: (scope?: PatchExportScope, commitId?: string) => Promise<void>;
  exportWorkspaceZip: () => Promise<void>;
  exportRemoteArchive: () => Promise<void>;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function overlayKey(id: string, path: string) {
  return `${id}:${path}`;
}

function sameWorkingFile(left: WorkingFile | StagedFile, right: WorkingFile | StagedFile) {
  return (
    left.path === right.path &&
    left.status === right.status &&
    left.content === right.content &&
    left.baseSha === right.baseSha &&
    left.renamedFrom === right.renamedFrom
  );
}

function asWorkingFile(file: StagedFile): WorkingFile {
  const { stagedAt: _stagedAt, ...working } = file;
  return working;
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [anonymous] = useState(() => {
    const identity = anonymousPrincipal();
    bindStoragePrincipal(identity.key);
    documentService.bindPrincipal(identity.key);
    return identity;
  });
  const [principal, setPrincipal] = useState<Principal>(anonymous);
  const [authPhase, setAuthPhase] = useState<WorkspaceContextValue["authPhase"]>(() =>
    getGithubToken() ? "resolving" : "anonymous",
  );
  const [ownershipGeneration, setOwnershipGeneration] = useState(0);
  const authority = useRef<OwnershipGeneration>({ principalKey: anonymous.key, generation: 0 });
  const channel = useRef<BroadcastChannel | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<GithubUser | null>(null);
  const [repositories, setRepositories] = useState<GithubRepository[]>([]);
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null);
  const [refs, setRefs] = useState<Awaited<ReturnType<typeof listGithubRefs>>>([]);
  const [overlays, setOverlays] = useState<WorkingFile[]>([]);
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const [committedFiles, setCommittedFiles] = useState<CommittedFile[]>([]);
  const [commits, setCommits] = useState<LocalCommit[]>([]);
  const [recent, setRecent] = useState<WorkspaceSnapshot[]>(() =>
    loadRecentWorkspaces(anonymous.key),
  );
  const [remoteHeadSha, setRemoteHeadSha] = useState<string | null>(null);
  const [pendingPush, setPendingPush] = useState<PushReconciliation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const capture = useCallback((): OwnershipGeneration => ({ ...authority.current }), []);
  const isCurrent = useCallback(
    (lease: OwnershipGeneration) => sameOwnership(authority.current, lease),
    [],
  );
  const assertCurrent = useCallback((lease: OwnershipGeneration) => {
    if (!sameOwnership(authority.current, lease))
      throw new Error("Repository session invalidated by an identity transition.");
  }, []);
  const transition = useCallback((next: Principal, phase: WorkspaceContextValue["authPhase"]) => {
    bindStoragePrincipal(next.key);
    documentService.bindPrincipal(next.key);
    const generation = authority.current.generation + 1;
    authority.current = { principalKey: next.key, generation };
    setOwnershipGeneration(generation);
    setPrincipal(next);
    setAuthPhase(phase);
    setToken(null);
    setUser(null);
    setRepositories([]);
    setWorkspace(null);
    setRefs([]);
    setOverlays([]);
    setStaged([]);
    setCommittedFiles([]);
    setCommits([]);
    setRemoteHeadSha(null);
    setPendingPush(null);
    setRecent(phase === "resolving" ? [] : loadRecentWorkspaces(next.key));
    setError(null);
    setLoading(false);
    return { ...authority.current };
  }, []);

  const loadLocalState = useCallback(
    async (id: string, lease: OwnershipGeneration) => {
      assertCurrent(lease);
      const [nextOverlays, nextStaged, nextCommitted, nextCommits] = await Promise.all([
        loadOverlays(id),
        loadStaged(id),
        loadCommittedFiles(id),
        loadLocalCommits(id),
      ]);
      assertCurrent(lease);
      setOverlays(nextOverlays);
      setStaged(nextStaged);
      setCommittedFiles(nextCommitted);
      setCommits(nextCommits);
      return {
        overlays: nextOverlays,
        staged: nextStaged,
        committedFiles: nextCommitted,
        commits: nextCommits,
      };
    },
    [assertCurrent],
  );

  // Journal state is rediscovered on reload, including after an uncertain
  // network response. Never carry its private details across principal epochs.
  useEffect(() => {
    if (!workspace) {
      setPendingPush(null);
      return;
    }
    let cancelled = false;
    const lease = capture();
    void loadPendingPushOperation(workspace).then((operation) => {
      if (cancelled || !isCurrent(lease)) return;
      setPendingPush(operation ? {
        phase: operation.phase === "completed" ? "remote-confirmed" : operation.phase,
        expectedRemoteSha: operation.expectedRemoteSha,
        observedRemoteSha: remoteHeadSha,
        intendedTargetSha: operation.targetSha ?? null,
        localCommitIds: [...operation.commitIds],
        reason: "Unfinished publication is durable. Inspect the remote branch and retry safely.",
      } : null);
    }).catch(() => {
      if (!cancelled && isCurrent(lease)) {
        setError("Push journal could not be read. Existing local commits must be preserved.");
      }
    });
    return () => { cancelled = true; };
  }, [workspace, remoteHeadSha, capture, isCurrent]);

  const connectToken = useCallback(
    async (candidate: string) => {
      const value = candidate.trim();
      if (!value) throw new Error("GitHub token cannot be empty.");
      documentService.assertSafeToNavigate();
      const lease = transition(anonymous, "resolving");
      setLoading(true);
      try {
        // /user is authoritative. A token and mutable login never establish a principal.
        const nextUser = await getGithubUser(value);
        assertCurrent(lease);
        const nextRepositories = await listGithubRepositories(value);
        assertCurrent(lease);
        const verified = githubPrincipal(nextUser.id);
        setGithubToken(value);
        transition(verified, "authenticated");
        setToken(value);
        setUser(nextUser);
        setRepositories(nextRepositories);
        setRecent(loadRecentWorkspaces(verified.key));
        channel.current?.postMessage({ type: "invalidate" });
      } catch (reason) {
        if (isCurrent(lease)) {
          clearGithubToken();
          transition(anonymous, "failed");
          setError(reason instanceof Error ? reason.message : String(reason));
        }
        throw reason;
      } finally {
        if (isCurrent(lease)) setLoading(false);
      }
    },
    [anonymous, assertCurrent, isCurrent, transition],
  );

  const signOut = useCallback(() => {
    try {
      documentService.assertSafeToNavigate();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return;
    }
    clearGithubToken();
    transition(anonymous, "anonymous");
    channel.current?.postMessage({ type: "invalidate" });
  }, [anonymous, transition]);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const next = new BroadcastChannel("ghcode-identity-invalidation-v1");
    next.onmessage = (event: MessageEvent) => {
      if (event.data?.type !== "invalidate") return;
      clearGithubToken();
      transition(anonymous, "invalidated");
      setError(
        documentService.hasSuspendedChanges()
          ? "Account changed in another tab. Unsaved private drafts are held only in this tab. Reauthenticate the original account to recover them; closing the browser will discard them."
          : "Account changed in another tab. Sign in again to access private repositories.",
      );
    };
    channel.current = next;
    return () => {
      if (channel.current === next) channel.current = null;
      next.close();
    };
  }, [anonymous, transition]);

  useEffect(() => {
    const existing = getGithubToken();
    if (existing) {
      void connectToken(existing).catch(() => {});
    }
    // The stored token is an unverified credential; never restore private content on mount.
  }, [connectToken]);

  const openRepository = useCallback(
    async (input: string, requestedRef?: string) => {
      // After forced revocation, reopening a repository must remain possible
      // so the original principal can recover sealed unacknowledged drafts.
      // Never bypass guards while an existing workspace is active.
      if (workspace) documentService.assertSafeToNavigate();
      if (authPhase === "resolving" || authPhase === "failed" || authPhase === "invalidated")
        throw new Error(
          "Resolve your GitHub identity or continue anonymously before opening a repository.",
        );
      const lease = capture();
      const fullName = parseRepositoryInput(input);
      setLoading(true);
      setError(null);
      try {
        // Remote authorization MUST precede any local storage lookup.
        const repository = await getGithubRepository(fullName, token);
        assertCurrent(lease);
        if (!token && repository.private) throw new Error("Sign in to open a private repository.");
        const repositoryKey = repositoryIdentity(repository);
        const ref = requestedRef || repository.default_branch;
        const nextRefs = await listGithubRefs(repository.full_name, token).catch(() => []);
        assertCurrent(lease);
        const fullRef = canonicalGitRef(ref, nextRefs);
        const matching = recent.find((item) =>
          isOwnedWorkspace(item, lease.principalKey, repositoryKey, fullRef),
        );
        const cached = matching ? await loadWorkspace(matching.id, lease.principalKey) : undefined;
        assertCurrent(lease);
        const remoteCommit = await getGithubCommit(repository.full_name, ref, token);
        assertCurrent(lease);
        const localState: [WorkingFile[], StagedFile[], CommittedFile[], LocalCommit[]] = cached
          ? await Promise.all([
              loadOverlays(cached.id),
              loadStaged(cached.id),
              loadCommittedFiles(cached.id),
              loadLocalCommits(cached.id),
            ])
          : [[], [], [], []];
        assertCurrent(lease);
        const hasLocalState = localState.some((items) => items.length > 0);
        if (cached && hasLocalState && cached.baseSha !== remoteCommit.sha) {
          setWorkspace(cached);
          setOverlays(localState[0]);
          setStaged(localState[1]);
          setCommittedFiles(localState[2]);
          setCommits(localState[3]);
          setRemoteHeadSha(remoteCommit.sha);
          setRecent(rememberWorkspace(cached));
          setRefs(nextRefs);
          setError("Remote ref changed. Local work is pinned to its original base until sync.");
          setDialogOpen(false);
          return;
        }
        const tree = await getGithubTree(repository.full_name, remoteCommit.commit.tree.sha, token);
        assertCurrent(lease);
        const ownership =
          cached?.ownership ?? createOwnedWorkspaceIdentity(principal, repositoryKey, fullRef);
        const snapshot: WorkspaceSnapshot = {
          version: 2,
          id: cached?.id ?? ownedWorkspaceId(ownership),
          ownership,
          repository: repositoryFromGithub(repository),
          ref,
          baseSha: remoteCommit.sha,
          treeSha: tree.sha,
          tree: tree.tree,
          updatedAt: Date.now(),
        };
        // Writes use only newly attributed v2 keys. Old anonymous records remain untouched.
        await saveWorkspace(snapshot);
        assertCurrent(lease);
        setWorkspace(snapshot);
        setRemoteHeadSha(remoteCommit.sha);
        await loadLocalState(snapshot.id, lease);
        assertCurrent(lease);
        setRecent(rememberWorkspace(snapshot));
        setRefs(nextRefs);
        setDialogOpen(false);
      } catch (reason) {
        if (!isCurrent(lease)) throw new Error("Repository session invalidated.");
        setError(reason instanceof Error ? reason.message : String(reason));
        // No 401/403/404 fallback. A failed remote request does not authorize cached content.
        throw reason;
      } finally {
        if (isCurrent(lease)) setLoading(false);
      }
    },
    [authPhase, capture, assertCurrent, isCurrent, loadLocalState, principal, recent, token, workspace],
  );

  const switchRef = useCallback(
    async (ref: string) => {
      if (!workspace) return;
      await openRepository(workspace.repository.fullName, ref);
    },
    [openRepository, workspace],
  );

  const refreshWorkspace = useCallback(async () => {
    if (!workspace) return;
    await openRepository(workspace.repository.fullName, workspace.ref);
  }, [openRepository, workspace]);

  const syncWorkspace = useCallback(async () => {
    if (!workspace) throw new Error("No workspace is open.");
    const lease = capture();
    assertCurrent(lease);
    setLoading(true);
    setError(null);
    try {
      const remoteCommit = await getGithubCommit(
        workspace.repository.fullName,
        workspace.ref,
        token,
      );
      assertCurrent(lease);
      setRemoteHeadSha(remoteCommit.sha);
      if (remoteCommit.sha === workspace.baseSha) return;

      const remoteTree = await getGithubTree(
        workspace.repository.fullName,
        remoteCommit.commit.tree.sha,
        token,
      );
      assertCurrent(lease);
      const hasLocalState =
        overlays.length > 0 || staged.length > 0 || committedFiles.length > 0 || commits.length > 0;

      if (hasLocalState) {
        const touched = new Set<string>();
        for (const file of [...committedFiles, ...overlays, ...staged]) {
          touched.add(file.path);
          if ("renamedFrom" in file && file.renamedFrom) touched.add(file.renamedFrom);
        }

        const conflicts: string[] = [];
        for (const path of touched) {
          const before = workspace.tree.find(
            (entry) => entry.type === "blob" && entry.path === path,
          );
          const after = remoteTree.tree.find(
            (entry) => entry.type === "blob" && entry.path === path,
          );
          if (before?.sha !== after?.sha || before?.mode !== after?.mode) conflicts.push(path);
        }
        if (conflicts.length) {
          throw new Error(
            `Remote changes overlap local work: ${conflicts.slice(0, 5).join(", ")}${conflicts.length > 5 ? "…" : ""}. Resolve or export the patch before syncing.`,
          );
        }
      }

      const snapshot: WorkspaceSnapshot = {
        ...workspace,
        baseSha: remoteCommit.sha,
        treeSha: remoteTree.sha,
        tree: remoteTree.tree,
        updatedAt: Date.now(),
      };
      assertCurrent(lease);
      await saveWorkspace(snapshot);
      assertCurrent(lease);
      setWorkspace(snapshot);
      setRecent(rememberWorkspace(snapshot));
      setRemoteHeadSha(remoteCommit.sha);
      const nextRefs = await listGithubRefs(workspace.repository.fullName, token).catch(() => refs);
      assertCurrent(lease);
      setRefs(nextRefs);
    } finally {
      if (isCurrent(lease)) setLoading(false);
    }
  }, [
    assertCurrent,
    capture,
    committedFiles,
    commits,
    isCurrent,
    overlays,
    refs,
    staged,
    token,
    workspace,
  ]);

  const readBaseFile = useCallback(
    async (path: string, sha?: string) => {
      if (!workspace) throw new Error("No workspace is open.");
      const entry = sha
        ? { sha }
        : workspace.tree.find((candidate) => candidate.path === path && candidate.type === "blob");
      if (!entry?.sha) throw new Error(`File does not exist in the remote base tree: ${path}`);
      const lease = capture();
      assertCurrent(lease);
      const cached = await loadBlob(workspace.id, entry.sha);
      assertCurrent(lease);
      if (cached !== null) return cached;
      const content = await getGithubBlob(workspace.repository.fullName, entry.sha, token);
      assertCurrent(lease);
      await saveBlob(workspace.id, entry.sha, content);
      assertCurrent(lease);
      return content;
    },
    [assertCurrent, capture, token, workspace],
  );

  const readBaselineFile = useCallback(
    async (path: string) => {
      if (!workspace) throw new Error("No workspace is open.");
      const committed = committedFiles.find((candidate) => candidate.path === path);
      if (committed) {
        if (committed.deleted) throw new Error(`File is deleted in local commits: ${path}`);
        if (committed.content !== undefined) return committed.content;
      }
      return readBaseFile(path);
    },
    [committedFiles, readBaseFile, workspace],
  );

  const baselineExists = useCallback(
    (path: string) => {
      if (!workspace) return false;
      const committed = committedFiles.find((candidate) => candidate.path === path);
      if (committed) return !committed.deleted;
      return workspace.tree.some((entry) => entry.path === path && entry.type === "blob");
    },
    [committedFiles, workspace],
  );

  const readFile = useCallback(
    async (path: string, sha?: string) => {
      if (!workspace) throw new Error("No workspace is open.");
      const overlay = overlays.find((candidate) => candidate.path === path);
      if (overlay?.status === "deleted") throw new Error(`File is deleted locally: ${path}`);
      if (overlay?.content !== undefined) return overlay.content;
      if (sha) return readBaseFile(path, sha);
      return readBaselineFile(path);
    },
    [overlays, readBaseFile, readBaselineFile, workspace],
  );

  const refreshOverlays = useCallback(async () => {
    if (!workspace) return;
    const lease = capture();
    const next = await loadOverlays(workspace.id);
    assertCurrent(lease);
    setOverlays(next);
  }, [assertCurrent, capture, workspace]);

  const commitOverlay = useCallback(
    async (file: WorkingFile | null, path: string, expected?: WorkingFile | null) => {
      if (!workspace) throw new Error("No workspace is open.");
      const lease = capture();
      assertCurrent(lease);
      if (expected !== undefined)
        await compareAndSetOverlay(workspace.id, path, expected, file);
      else if (file) await saveOverlay(file);
      else await removeOverlay(workspace.id, path);
      assertCurrent(lease);
      await refreshOverlays();
    },
    [assertCurrent, capture, refreshOverlays, workspace],
  );

  const writeFile = useCallback(
    async (path: string, content: string) => {
      if (!workspace) throw new Error("No workspace is open.");
      const currentOverlay = overlays.find((entry) => entry.path === path);
      const exists = baselineExists(path);
      if (exists) {
        const baselineContent = await readBaselineFile(path);
        if (baselineContent === content) {
          await commitOverlay(null, path, currentOverlay ?? null);
          return;
        }
      }
      const remoteEntry = workspace.tree.find(
        (entry) => entry.path === path && entry.type === "blob",
      );
      await commitOverlay(
        {
          key: overlayKey(workspace.id, path),
          workspaceId: workspace.id,
          path,
          status: currentOverlay?.status === "renamed" ? "renamed" : exists ? "modified" : "added",
          content,
          baseSha: remoteEntry?.sha ?? currentOverlay?.baseSha,
          renamedFrom: currentOverlay?.renamedFrom,
          updatedAt: Date.now(),
        },
        path,
        currentOverlay ?? null,
      );
    },
    [baselineExists, commitOverlay, overlays, readBaselineFile, workspace],
  );

  const createFile = useCallback(
    async (path: string, content = "") => {
      if (!workspace) throw new Error("No workspace is open.");
      const normalized = path.trim().replace(/^\/+/, "");
      if (!normalized) throw new Error("File path cannot be empty.");
      const existsInWorkingTree =
        overlays.some((entry) => entry.path === normalized && entry.status !== "deleted") ||
        (!overlays.some((entry) => entry.path === normalized && entry.status === "deleted") &&
          baselineExists(normalized));
      if (existsInWorkingTree) throw new Error(`Path already exists: ${normalized}`);
      await writeFile(normalized, content);
    },
    [baselineExists, overlays, workspace, writeFile],
  );

  const deletePath = useCallback(
    async (path: string) => {
      if (!workspace) throw new Error("No workspace is open.");
      const existing = overlays.find((entry) => entry.path === path);
      if (!baselineExists(path) && existing?.status === "added") {
        await commitOverlay(null, path);
        return;
      }
      const remoteEntry = workspace.tree.find(
        (entry) => entry.path === path && entry.type === "blob",
      );
      await commitOverlay(
        {
          key: overlayKey(workspace.id, path),
          workspaceId: workspace.id,
          path,
          status: "deleted",
          baseSha: remoteEntry?.sha ?? existing?.baseSha,
          updatedAt: Date.now(),
        },
        path,
      );
    },
    [baselineExists, commitOverlay, overlays, workspace],
  );

  const renamePath = useCallback(
    async (path: string, nextPath: string) => {
      if (!workspace) throw new Error("No workspace is open.");
      const target = nextPath.trim().replace(/^\/+/, "");
      if (!target || target === path) return;
      const targetExists =
        overlays.some((entry) => entry.path === target && entry.status !== "deleted") ||
        (!overlays.some((entry) => entry.path === target && entry.status === "deleted") &&
          baselineExists(target));
      if (targetExists) throw new Error(`Path already exists: ${target}`);

      const content = await readFile(path);
      const sourceWasAdded = !baselineExists(path);
      const remoteEntry = workspace.tree.find(
        (entry) => entry.path === path && entry.type === "blob",
      );

      if (sourceWasAdded) {
        await removeOverlay(workspace.id, path);
        await saveOverlay({
          key: overlayKey(workspace.id, target),
          workspaceId: workspace.id,
          path: target,
          status: "added",
          content,
          updatedAt: Date.now(),
        });
        await refreshOverlays();
        return;
      }

      await saveOverlay({
        key: overlayKey(workspace.id, target),
        workspaceId: workspace.id,
        path: target,
        status: "renamed",
        content,
        baseSha: remoteEntry?.sha,
        renamedFrom: path,
        updatedAt: Date.now(),
      });
      await saveOverlay({
        key: overlayKey(workspace.id, path),
        workspaceId: workspace.id,
        path,
        status: "deleted",
        baseSha: remoteEntry?.sha,
        updatedAt: Date.now(),
      });
      await refreshOverlays();
    },
    [baselineExists, overlays, readFile, refreshOverlays, workspace],
  );

  const fileStatus = useCallback(
    (path: string) => overlays.find((entry) => entry.path === path)?.status ?? null,
    [overlays],
  );

  const stageGroupFor = useCallback(
    (path: string) => {
      const selected = overlays.find((entry) => entry.path === path);
      if (!selected) return [];
      const group = [selected];
      if (selected.status === "renamed" && selected.renamedFrom) {
        const sourceDelete = overlays.find(
          (entry) => entry.path === selected.renamedFrom && entry.status === "deleted",
        );
        if (sourceDelete) group.push(sourceDelete);
      } else if (selected.status === "deleted") {
        const renameTarget = overlays.find(
          (entry) => entry.status === "renamed" && entry.renamedFrom === selected.path,
        );
        if (renameTarget) group.push(renameTarget);
      }
      return group;
    },
    [overlays],
  );

  const stageFile = useCallback(
    async (path: string) => {
      if (!workspace) throw new Error("No workspace is open.");
      const lease = capture();
      const now = Date.now();
      const changes = stageGroupFor(path).map((file) => ({
        path: file.path, next: { ...file, stagedAt: now },
      }));
      await compareAndApplyStaged(workspace.id, staged, changes);
      const next = await loadStaged(workspace.id);
      assertCurrent(lease);
      setStaged(next);
    },
    [assertCurrent, capture, stageGroupFor, staged, workspace],
  );

  const stageAll = useCallback(async () => {
    if (!workspace) throw new Error("No workspace is open.");
    const lease = capture();
    const now = Date.now();
    await compareAndApplyStaged(
      workspace.id, staged,
      overlays.map((file) => ({ path: file.path, next: { ...file, stagedAt: now } })),
    );
    const next = await loadStaged(workspace.id);
    assertCurrent(lease);
    setStaged(next);
  }, [assertCurrent, capture, overlays, staged, workspace]);

  const unstageFile = useCallback(
    async (path: string) => {
      if (!workspace) throw new Error("No workspace is open.");
      const lease = capture();
      const selected = staged.find((entry) => entry.path === path);
      const paths = new Set([path]);
      if (selected?.status === "renamed" && selected.renamedFrom) paths.add(selected.renamedFrom);
      if (selected?.status === "deleted") {
        const target = staged.find(
          (entry) => entry.status === "renamed" && entry.renamedFrom === selected.path,
        );
        if (target) paths.add(target.path);
      }
      await compareAndApplyStaged(
        workspace.id, staged,
        [...paths].map((candidate) => ({ path: candidate, next: null })),
      );
      const next = await loadStaged(workspace.id);
      assertCurrent(lease);
      setStaged(next);
    },
    [assertCurrent, capture, staged, workspace],
  );

  const unstageAll = useCallback(async () => {
    if (!workspace) throw new Error("No workspace is open.");
    const lease = capture();
    await compareAndApplyStaged(
      workspace.id, staged,
      staged.map((file) => ({ path: file.path, next: null })),
    );
    assertCurrent(lease);
    setStaged([]);
  }, [assertCurrent, capture, staged, workspace]);

  const discardFile = useCallback(
    async (path: string) => {
      if (!workspace) throw new Error("No workspace is open.");
      const lease = capture();
      const selected = overlays.find((entry) => entry.path === path);
      const paths = new Set([path]);
      if (selected?.status === "renamed" && selected.renamedFrom) paths.add(selected.renamedFrom);
      if (selected?.status === "deleted") {
        const target = overlays.find(
          (entry) => entry.status === "renamed" && entry.renamedFrom === selected.path,
        );
        if (target) paths.add(target.path);
      }
      for (const candidate of paths) {
        await removeOverlay(workspace.id, candidate);
        await removeStaged(workspace.id, candidate);
      }
      const nextStaged = await loadStaged(workspace.id);
      assertCurrent(lease);
      await refreshOverlays();
      assertCurrent(lease);
      setStaged(nextStaged);
    },
    [assertCurrent, capture, overlays, refreshOverlays, workspace],
  );

  const commitStaged = useCallback(
    async (message: string) => {
      if (!workspace) throw new Error("No workspace is open.");
      const normalizedMessage = message.trim();
      if (!normalizedMessage) throw new Error("Commit message cannot be empty.");
      if (!staged.length) throw new Error("There are no staged changes.");
      const lease = capture();
      assertCurrent(lease);

      const now = Date.now();
      const commit: LocalCommit = {
        id: `${workspace.id}:local:${now}:${crypto.randomUUID()}`,
        workspaceId: workspace.id,
        message: normalizedMessage,
        createdAt: now,
        files: staged.map(asWorkingFile),
      };

      await commitLocalChanges(commit, staged);
      assertCurrent(lease);
      await loadLocalState(workspace.id, lease);
      return commit;
    },
    [assertCurrent, capture, loadLocalState, staged, workspace],
  );

  const createBranch = useCallback(
    async (branch: string) => {
      if (!workspace) throw new Error("No workspace is open.");
      if (!token) throw new Error("Sign in with GitHub before creating a branch.");
      const name = branch.trim();
      if (
        !name ||
        /[\s~^:?*\\[\\]\\\\]/.test(name) ||
        name.includes("..") ||
        name.startsWith("/") ||
        name.endsWith("/")
      ) {
        throw new Error("Enter a valid Git branch name.");
      }
      setLoading(true);
      setError(null);
      try {
        const lease = capture();
        await createGithubBranchRef(workspace.repository.fullName, name, workspace.baseSha, token);
        assertCurrent(lease);
        const ownership = createOwnedWorkspaceIdentity(
          principal,
          {
            key: `gh:github.com:repo:${workspace.repository.id}`,
            id: workspace.repository.id,
            fullName: workspace.repository.fullName,
          },
          `refs/heads/${name}`,
        );
        const nextId = ownedWorkspaceId(ownership);
        const nextWorkspace: WorkspaceSnapshot = {
          ...workspace,
          id: nextId,
          ownership,
          ref: name,
          updatedAt: Date.now(),
        };
        await saveWorkspace(nextWorkspace);
        assertCurrent(lease);

        for (const file of overlays) {
          await saveOverlay({
            ...file,
            key: overlayKey(nextId, file.path),
            workspaceId: nextId,
          });
        }
        for (const file of staged) {
          await saveStaged({
            ...file,
            key: overlayKey(nextId, file.path),
            workspaceId: nextId,
          });
        }
        for (const file of committedFiles) {
          await saveCommittedFile({
            ...file,
            key: overlayKey(nextId, file.path),
            workspaceId: nextId,
          });
        }
        for (const localCommit of commits) {
          const id = `${nextId}:local:${localCommit.createdAt}:${crypto.randomUUID()}`;
          await saveLocalCommit({
            ...localCommit,
            id,
            workspaceId: nextId,
            files: localCommit.files.map((file) => ({
              ...file,
              key: overlayKey(nextId, file.path),
              workspaceId: nextId,
            })),
          });
        }

        assertCurrent(lease);
        setWorkspace(nextWorkspace);
        setRemoteHeadSha(workspace.baseSha);
        setRecent(rememberWorkspace(nextWorkspace));
        const nextRefs = await listGithubRefs(workspace.repository.fullName, token);
        assertCurrent(lease);
        setRefs(nextRefs);
        await loadLocalState(nextId, lease);
      } finally {
        setLoading(false);
      }
    },
    [
      assertCurrent,
      capture,
      committedFiles,
      commits,
      loadLocalState,
      overlays,
      principal,
      staged,
      token,
      workspace,
    ],
  );

  const pushLocalCommits = useCallback(async () => {
    if (!workspace) throw new Error("No workspace is open.");
    if (!token) throw new Error("Sign in with GitHub before pushing.");
    const branch = refs.find(
      (candidate) => candidate.kind === "branch" && candidate.name === workspace.ref,
    );
    if (!branch)
      throw new Error("Push requires a branch workspace. Tags and detached refs are read-only.");

    const lease = capture();
    let attempted: Awaited<ReturnType<typeof loadPendingPushOperation>> = null;
    let lastObservedSha: string | null = null;
    setLoading(true);
    setError(null);
    try {
      let operation = await loadPendingPushOperation(workspace);
      attempted = operation;
      assertCurrent(lease);
      if (!operation) {
        if (!commits.length) throw new Error("There are no local commits to push.");
        operation = await beginPushOperation(workspace, commits.map((item) => item.id));
        attempted = operation;
      }
      assertCurrent(lease);
      if (operation.expectedRemoteSha !== workspace.baseSha ||
          operation.commitIds.length !== commits.length ||
          operation.commitIds.some((id) => !commits.some((item) => item.id === id))) {
        throw new Error("Pending push differs from current local commits. Reconcile before retrying.");
      }
      const liveRef = await getGithubBranchRef(workspace.repository.fullName, workspace.ref, token);
      assertCurrent(lease);
      lastObservedSha = liveRef.object.sha;
      // A remote update can succeed while its response or local acknowledgment fails.
      // The journaled target permits idempotent reconciliation without discarding commits.
      if (operation.phase === "prepared") {
        if (liveRef.object.sha !== operation.expectedRemoteSha) {
          setRemoteHeadSha(liveRef.object.sha);
          throw new Error("Remote ref changed during an unprepared push. Reconcile manually.");
        }
        let parentSha = operation.expectedRemoteSha;
        let treeSha = workspace.treeSha;
        for (const localCommit of commits) {
          const mutations = [];
          for (const file of localCommit.files) {
            const sourcePath = file.renamedFrom || file.path;
            const existing = workspace.tree.find(
              (entry) => entry.type === "blob" &&
                (entry.path === file.path || entry.path === sourcePath),
            );
            const mode =
              existing?.mode && ["100644", "100755", "120000"].includes(existing.mode)
                ? existing.mode
                : "100644";
            if (file.status === "deleted") {
              mutations.push({ path: file.path, mode, type: "blob" as const, sha: null });
              continue;
            }
            const blob = await createGithubBlob(
              workspace.repository.fullName, file.content ?? "", token,
            );
            assertCurrent(lease);
            mutations.push({ path: file.path, mode, type: "blob" as const, sha: blob.sha });
          }
          const tree = await createGithubTree(
            workspace.repository.fullName, treeSha, mutations, token,
          );
          assertCurrent(lease);
          const commit = await createGithubCommit(
            workspace.repository.fullName, localCommit.message, tree.sha, [parentSha], token,
          );
          assertCurrent(lease);
          parentSha = commit.sha;
          treeSha = tree.sha;
        }
        // Persist the target BEFORE mutating the GitHub ref.
        operation = await advancePushOperation(
          workspace, operation.id, "prepared", "ready", parentSha,
        );
        attempted = operation;
        assertCurrent(lease);
      }

      if (!operation.targetSha) throw new Error("Push target was not recorded.");
      if (operation.phase === "ready") {
        if (liveRef.object.sha === operation.expectedRemoteSha) {
          // Re-read immediately before patch. A non-force update rejects
          // divergent branch advancement; no unexpected remote ref is overwritten.
          const beforePatch = await getGithubBranchRef(
            workspace.repository.fullName, workspace.ref, token,
          );
          assertCurrent(lease);
          if (beforePatch.object.sha !== operation.expectedRemoteSha)
            throw new Error("Remote branch changed before push; reconcile without force.");
          await updateGithubBranchRef(
            workspace.repository.fullName, workspace.ref,
            operation.expectedRemoteSha, operation.targetSha, token,
          );
          assertCurrent(lease);
        } else if (liveRef.object.sha !== operation.targetSha) {
          setRemoteHeadSha(liveRef.object.sha);
          throw new Error("Remote branch conflicts with pending push; manual reconciliation required.");
        }
        const confirmed = await getGithubBranchRef(workspace.repository.fullName, workspace.ref, token);
        assertCurrent(lease);
        if (confirmed.object.sha !== operation.targetSha)
          throw new Error("GitHub did not confirm the journaled target; local commits preserved.");
        operation = await advancePushOperation(
          workspace, operation.id, "ready", "remote-confirmed", operation.targetSha,
        );
        attempted = operation;
        assertCurrent(lease);
      }

      if (operation.phase !== "remote-confirmed")
        throw new Error("Pending push has an unsupported phase; local commits preserved.");
      const confirmedRef = await getGithubBranchRef(
        workspace.repository.fullName, workspace.ref, token,
      );
      assertCurrent(lease);
      if (confirmedRef.object.sha !== operation.targetSha) {
        setRemoteHeadSha(confirmedRef.object.sha);
        throw new Error("Published ref changed after push. Local cleanup requires reconciliation.");
      }
      const remoteCommit = await getGithubCommit(
        workspace.repository.fullName, operation.targetSha, token,
      );
      assertCurrent(lease);
      const remoteTree = await getGithubTree(
        workspace.repository.fullName, remoteCommit.commit.tree.sha, token,
      );
      assertCurrent(lease);
      const snapshot: WorkspaceSnapshot = {
        ...workspace,
        baseSha: operation.targetSha,
        treeSha: remoteTree.sha,
        tree: remoteTree.tree,
        updatedAt: Date.now(),
      };
      await finalizeConfirmedPush(workspace, snapshot, operation);
      assertCurrent(lease);
      setWorkspace(snapshot);
      setRemoteHeadSha(operation.targetSha);
      setRecent(rememberWorkspace(snapshot));
      await loadLocalState(workspace.id, lease);
      setPendingPush(null);
      return operation.targetSha;
    } catch (reason) {
      if (isCurrent(lease) && attempted) {
        setPendingPush({
          phase: attempted.phase === "completed" ? "remote-confirmed" : attempted.phase,
          expectedRemoteSha: attempted.expectedRemoteSha,
          observedRemoteSha: lastObservedSha,
          intendedTargetSha: attempted.targetSha ?? null,
          localCommitIds: [...attempted.commitIds],
          reason: reason instanceof Error ? reason.message : String(reason),
        });
      }
      throw reason;
    } finally {
      if (isCurrent(lease)) setLoading(false);
    }
  }, [assertCurrent, capture, commits, isCurrent, loadLocalState, refs, token, workspace]);

  const exportPatch = useCallback(
    async (scope: PatchExportScope = "all", commitId?: string) => {
      if (!workspace) throw new Error("No workspace is open.");
      const lease = capture();

      const readRemote = async (path: string): Promise<string | null> => {
        const entry = workspace.tree.find(
          (candidate) => candidate.type === "blob" && candidate.path === path,
        );
        return entry ? readBaseFile(path, entry.sha) : null;
      };

      const readCommitted = async (path: string): Promise<string | null> => {
        const committed = committedFiles.find((candidate) => candidate.path === path);
        if (committed) {
          if (committed.deleted) return null;
          if (committed.content !== undefined) return committed.content;
        }
        return readRemote(path);
      };

      const contentAfter = (file: WorkingFile | StagedFile, before: string | null) =>
        file.status === "deleted" ? null : (file.content ?? before);

      const parts: string[] = [];
      const appendPatch = (path: string, before: string | null, after: string | null) => {
        if (before === after) return;
        parts.push(wholeFilePatch(path, before, after));
      };

      if (scope === "working") {
        for (const file of [...overlays].sort((left, right) =>
          left.path.localeCompare(right.path),
        )) {
          const before = await readCommitted(file.path);
          appendPatch(file.path, before, contentAfter(file, before));
        }
      } else if (scope === "staged") {
        for (const file of [...staged].sort((left, right) => left.path.localeCompare(right.path))) {
          const before = await readCommitted(file.path);
          appendPatch(file.path, before, contentAfter(file, before));
        }
      } else if (scope === "commits") {
        for (const file of [...committedFiles].sort((left, right) =>
          left.path.localeCompare(right.path),
        )) {
          const before = await readRemote(file.path);
          const after = file.deleted ? null : (file.content ?? before);
          appendPatch(file.path, before, after);
        }
      } else if (scope === "commit") {
        const targetIndex = commits.findIndex((candidate) => candidate.id === commitId);
        if (targetIndex < 0) throw new Error("Local commit was not found.");
        const target = commits[targetIndex];
        const targetFiles = new Map(target.files.map((file) => [file.path, file]));

        for (const path of [...targetFiles.keys()].sort()) {
          let before = await readRemote(path);
          for (let index = 0; index < targetIndex; index += 1) {
            const prior = commits[index].files.find((file) => file.path === path);
            if (prior) before = contentAfter(prior, before);
          }
          const file = targetFiles.get(path);
          if (!file) continue;
          appendPatch(path, before, contentAfter(file, before));
        }
      } else {
        const paths = new Set<string>();
        for (const file of committedFiles) paths.add(file.path);
        for (const file of overlays) paths.add(file.path);

        for (const path of [...paths].sort()) {
          const before = await readRemote(path);
          // An intentional deletion must be represented as null, but
          // arbitrary read/auth/network failures must abort the export.
          // Converting every error to a deletion silently corrupts the patch.
          const deleted = overlays.some((item) => item.path === path && item.status === "deleted") ||
            committedFiles.some((item) => item.path === path && item.deleted);
          const after = deleted ? null : await readFile(path);
          appendPatch(path, before, after);
        }
      }

      if (!parts.length) throw new Error("There are no changes in this patch scope.");

      const ref = workspace.ref.replace(/[^A-Za-z0-9._-]+/g, "-");
      let suffix: string = scope;
      if (scope === "commit") {
        const target = commits.find((candidate) => candidate.id === commitId);
        const label = target?.message
          .trim()
          .slice(0, 48)
          .replace(/[^A-Za-z0-9._-]+/g, "-")
          .replace(/^-+|-+$/g, "");
        suffix = label ? `commit-${label}` : "commit";
      }
      assertCurrent(lease);
      downloadText(
        parts.join("\n"),
        `${workspace.repository.name}-${ref}-${suffix}.patch`,
        "text/x-patch;charset=utf-8",
      );
    },
    [
      assertCurrent,
      capture,
      committedFiles,
      commits,
      overlays,
      readBaseFile,
      readFile,
      staged,
      workspace,
    ],
  );

  const exportWorkspaceZip = useCallback(async () => {
    if (!workspace) throw new Error("No workspace is open.");
    const lease = capture();
    setLoading(true);
    setError(null);
    try {
      const files = virtualFiles(workspace.tree, committedFiles, overlays);
      const zipFiles = [];
      for (const file of files) {
        const bytes =
          file.content !== undefined
            ? new TextEncoder().encode(file.content)
            : file.sha
              ? await getGithubBlobBytes(workspace.repository.fullName, file.sha, token)
              : new Uint8Array();
        zipFiles.push({ path: file.path, bytes });
      }
      assertCurrent(lease);
      const archive = createStoredZip(zipFiles);
      const filename = `${workspace.repository.name}-${workspace.ref.replace(/[^A-Za-z0-9._-]+/g, "-")}-workspace.zip`;
      downloadBytes(archive, filename, "application/zip");
    } finally {
      if (isCurrent(lease)) setLoading(false);
    }
  }, [assertCurrent, capture, committedFiles, isCurrent, overlays, token, workspace]);

  const exportRemoteArchive = useCallback(async () => {
    if (!workspace) throw new Error("No workspace is open.");
    const lease = capture();
    setLoading(true);
    setError(null);
    try {
      const archive = await downloadGithubRepositoryArchive(
        workspace.repository.fullName,
        workspace.ref,
        token,
      );
      assertCurrent(lease);
      const filename = `${workspace.repository.name}-${workspace.ref.replace(/[^A-Za-z0-9._-]+/g, "-")}-remote.zip`;
      downloadBytes(archive, filename, "application/zip");
    } finally {
      if (isCurrent(lease)) setLoading(false);
    }
  }, [assertCurrent, capture, isCurrent, token, workspace]);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      token,
      user,
      principal,
      authPhase,
      ownershipGeneration,
      repositories,
      workspace,
      refs,
      overlays,
      staged,
      committedFiles,
      commits,
      recent,
      remoteHeadSha,
      pendingPush,
      loading,
      error,
      dialogOpen,
      connectToken,
      signOut,
      setDialogOpen,
      openRepository,
      switchRef,
      refreshWorkspace,
      syncWorkspace,
      readBaseFile,
      readBaselineFile,
      readFile,
      writeFile,
      createFile,
      deletePath,
      renamePath,
      fileStatus,
      stageFile,
      stageAll,
      unstageFile,
      unstageAll,
      discardFile,
      commitStaged,
      createBranch,
      pushLocalCommits,
      exportPatch,
      exportWorkspaceZip,
      exportRemoteArchive,
    }),
    [
      token,
      user,
      principal,
      authPhase,
      ownershipGeneration,
      repositories,
      workspace,
      refs,
      overlays,
      staged,
      committedFiles,
      commits,
      recent,
      remoteHeadSha,
      pendingPush,
      loading,
      error,
      dialogOpen,
      connectToken,
      signOut,
      openRepository,
      switchRef,
      refreshWorkspace,
      syncWorkspace,
      readBaseFile,
      readBaselineFile,
      readFile,
      writeFile,
      createFile,
      deletePath,
      renamePath,
      fileStatus,
      stageFile,
      stageAll,
      unstageFile,
      unstageAll,
      discardFile,
      commitStaged,
      createBranch,
      pushLocalCommits,
      exportPatch,
      exportWorkspaceZip,
      exportRemoteArchive,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("Workspace context is not available");
  return value;
}
