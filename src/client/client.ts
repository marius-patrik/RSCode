import type {
  BrowserSession,
  FsEntry,
  GitDiff,
  GitRepository,
  GitStatus,
  Workspace,
  WorkspaceSummary,
} from "@/shared/schema";

type FileKind = "markdown" | "json" | "yaml" | "typescript" | "plain";

export type CanvasClient = {
  fs: {
    tree(input: { path: string }): Promise<{ entries: FsEntry[] }>;
    readFile(input: { path: string }): Promise<{ body: string }>;
    writeFile(input: { path: string; body: string }): Promise<{ ok: true }>;
    mkdir(input: { path: string }): Promise<{ ok: true }>;
    createFile(input: { path: string; kind: FileKind }): Promise<{ path: string }>;
    delete(input: { path: string }): Promise<{ ok: true }>;
  };
  workspace: {
    list(): Promise<{ activeWorkspaceId: string; workspaces: WorkspaceSummary[] }>;
    active(): Promise<{ workspace: Workspace }>;
    get(input: { id: string }): Promise<{ workspace: Workspace }>;
    create(input?: { label?: string; rootPath?: string }): Promise<{ workspace: Workspace }>;
    save(input: { workspace: Workspace }): Promise<{ workspace: Workspace }>;
    rename(input: { id: string; label: string }): Promise<{ workspace: Workspace }>;
    setActive(input: { id: string }): Promise<{ workspace: Workspace }>;
    close(input: { id: string }): Promise<{ activeWorkspaceId: string; workspaces: WorkspaceSummary[] }>;
  };
  git: {
    repositories(input: { rootPath: string; depth?: number }): Promise<{ repositories: GitRepository[] }>;
    status(input: { repoPath: string }): Promise<{ status: GitStatus }>;
    diff(input: { repoPath: string; path?: string }): Promise<{ diff: GitDiff }>;
  };
  browser: {
    navigate(input: {
      workspaceId: string;
      paneId: string;
      url: string;
      replace?: boolean;
    }): Promise<{ workspace: Workspace; browser: BrowserSession }>;
    history(input: {
      workspaceId: string;
      paneId: string;
      direction: "back" | "forward";
    }): Promise<{ workspace: Workspace; browser: BrowserSession }>;
  };
};

async function post<T>(baseUrl: string, path: string, input?: unknown): Promise<T> {
  const res = await fetch(`${baseUrl}/api/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input ?? null),
  });
  const text = await res.text();
  const parsed = parseResponse(text);
  if (!res.ok) {
    const error =
      parsed && typeof parsed === "object" && "error" in parsed
        ? String((parsed as { error: unknown }).error)
        : `${res.status} ${res.statusText}`;
    throw new Error(`${path}: ${error}`);
  }
  return parsed as T;
}

function parseResponse(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function getBaseUrl() {
  if (typeof window !== "undefined") return window.location.origin;
  return process.env.CANVAS_URL ?? "http://127.0.0.1:4567";
}

export function makeClient(url = getBaseUrl()): CanvasClient {
  return {
    fs: {
      tree: (input) => post(url, "fs.tree", input),
      readFile: (input) => post(url, "fs.readFile", input),
      writeFile: (input) => post(url, "fs.writeFile", input),
      mkdir: (input) => post(url, "fs.mkdir", input),
      createFile: (input) => post(url, "fs.createFile", input),
      delete: (input) => post(url, "fs.delete", input),
    },
    workspace: {
      list: () => post(url, "workspace.list"),
      active: () => post(url, "workspace.active"),
      get: (input) => post(url, "workspace.get", input),
      create: (input = {}) => post(url, "workspace.create", input),
      save: (input) => post(url, "workspace.save", input),
      rename: (input) => post(url, "workspace.rename", input),
      setActive: (input) => post(url, "workspace.setActive", input),
      close: (input) => post(url, "workspace.close", input),
    },
    git: {
      repositories: (input) => post(url, "git.repositories", input),
      status: (input) => post(url, "git.status", input),
      diff: (input) => post(url, "git.diff", input),
    },
    browser: {
      navigate: (input) => post(url, "browser.navigate", input),
      history: (input) => post(url, "browser.history", input),
    },
  };
}
