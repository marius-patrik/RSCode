import { makeClient } from "@/client/client";
import type { GitDiff, GitRepository, GitStatus, PaneState, SourceControlPaneState, Workspace } from "@/shared/schema";
import { cn } from "@/shared/utils";
import { FolderGit2, GitBranch } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

export function SourceControlPane({
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
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const git = useMemo(() => makeClient(), []);

  const mutate = async (action: () => Promise<unknown>) => {
    if (!repoPath || busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
      await onRequestGitStatus(repoPath);
      if (selectedFile) {
        const next = await onRequestGitDiff(repoPath, selectedFile);
        setDiff(next.diff);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

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
      </div>
      {error ? <div role="alert" className="border-b border-border px-3 py-2 text-xs text-red-400">{error}</div> : null}
      <form
        className="flex gap-2 border-b border-border p-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!message.trim()) return;
          void mutate(async () => {
            await git.git.commit({ repoPath, message });
            setMessage("");
          });
        }}
      >
        <input
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          aria-label="Git commit message"
          placeholder="Commit message"
          className="min-w-0 flex-1 rounded border border-border bg-[var(--input-bg)] px-2 py-1 text-xs"
        />
        <button
          type="submit"
          disabled={busy || !message.trim() || !status?.files.some((file) => file.staged)}
          className="rounded border border-border px-2 text-xs disabled:opacity-40"
        >
          Commit
        </button>
      </form>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(180px,34%)_1fr]">
        <div className="min-h-0 overflow-auto border-r border-border">
          <div className="border-b border-border px-3 py-2 text-xs">
            <div className="font-semibold">{status?.branch ?? "detached"}</div>
            <div className="font-mono text-[10px] text-muted-foreground">
              {status ? (status.clean ? "clean" : `${status.files.length} changed`) : "loading"}
            </div>
          </div>
          {(status?.files ?? []).map((file) => (
            <div key={`${file.status}:${file.path}`} className="flex min-w-0 items-center">
              <button
                type="button"
                onClick={() => {
                  setSelectedFile(file.path);
                  void onRequestGitDiff(repoPath, file.path).then((result) => setDiff(result.diff));
                }}
                className={cn(
                  "flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-xs hover:bg-[var(--surface-hover)]",
                  selectedFile === file.path && "bg-secondary text-foreground",
                )}
              >
                <span className="w-8 shrink-0 font-mono text-[10px] text-muted-foreground">{file.status}</span>
                <span className="truncate">{file.path}</span>
              </button>
              <button
                type="button"
                disabled={busy}
                aria-label={`${file.staged ? "Unstage" : "Stage"} ${file.path}`}
                title={file.staged ? "Unstage" : "Stage"}
                onClick={() => void mutate(() => file.staged
                  ? git.git.unstage({ repoPath, path: file.path })
                  : git.git.stage({ repoPath, path: file.path }))}
                className="shrink-0 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-[var(--surface-hover)] disabled:opacity-40"
              >
                {file.staged ? "−" : "+"}
              </button>
            </div>
          ))}
        </div>
        <pre className="min-h-0 overflow-auto p-3 text-[11px] leading-relaxed text-foreground">
          {selectedFile ? diff || "No diff for selected file." : "Select a changed file to preview its diff."}
        </pre>
      </div>
    </div>
  );
}

export function RepositoriesPane({
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
