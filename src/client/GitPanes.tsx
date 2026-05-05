import type { GitDiff, GitRepository, GitStatus, PaneState, SourceControlPaneState, Workspace } from "@/shared/schema";
import { cn } from "@/shared/utils";
import { FolderGit2, GitBranch } from "lucide-react";
import { useEffect, useState } from "react";

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
        <pre className="min-h-0 overflow-auto p-3 text-[11px] leading-relaxed text-foreground">
          {selectedFile ? diff || "No diff for selected file." : "Select a changed file to preview a readonly diff."}
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
