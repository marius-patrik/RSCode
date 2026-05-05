import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import { browserStoredUrl } from "@/shared/browser";
import { getPaths } from "@/shared/paths";
import {
  type BrowserPaneState,
  type BrowserSession,
  DEFAULT_WORKSPACE_SETTINGS,
  type ExplorerPaneState,
  type FsEntry,
  type GitDiff,
  type GitRepository,
  type GitStatus,
  type PaneRect,
  type PaneState,
  type TiledLayoutNode,
  type Workspace,
  type WorkspaceIndex,
  type WorkspaceSummary,
  defaultViewport,
  workspaceIndexSchema,
  workspaceSchema,
} from "@/shared/schema";

const MAX_READ_BYTES = 1_000_000;
const DEFAULT_GIT_DISCOVERY_DEPTH = 5;

async function ensureDir(path: string) {
  await mkdir(path, { recursive: true });
}

async function exists(path: string) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readJson<T>(path: string): Promise<T | null> {
  if (!(await exists(path))) return null;
  const source = await readFile(path, "utf8");
  return JSON.parse(source) as T;
}

async function writeJson(path: string, data: unknown) {
  await ensureDir(dirname(path));
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function now() {
  return new Date().toISOString();
}

function safeAbsolute(absPath: string): string {
  if (!absPath || typeof absPath !== "string") {
    throw new Error("path must be a non-empty string");
  }
  const normalized = resolve(absPath);
  if (!normalized.startsWith("/")) {
    throw new Error(`expected absolute path, got: ${absPath}`);
  }
  return normalized;
}

export async function listFsTree(absPath: string): Promise<FsEntry[]> {
  const dir = safeAbsolute(absPath);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out: FsEntry[] = [];
  for (const name of names) {
    if (name.startsWith(".")) continue;
    const childAbs = resolve(dir, name);
    const st = await stat(childAbs).catch(() => null);
    if (!st) continue;
    out.push({
      kind: st.isDirectory() ? "dir" : "file",
      name,
      path: childAbs,
    });
  }
  out.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return out;
}

export async function readFsFile(absPath: string): Promise<string> {
  const abs = safeAbsolute(absPath);
  const st = await stat(abs);
  if (st.size > MAX_READ_BYTES) {
    throw new Error(`file too large (${st.size} bytes; cap is ${MAX_READ_BYTES})`);
  }
  return readFile(abs, "utf8");
}

export async function writeFsFile(absPath: string, body: string): Promise<void> {
  const abs = safeAbsolute(absPath);
  if (abs === "/") throw new Error("refusing to write filesystem root");
  await ensureDir(dirname(abs));
  await writeFile(abs, body, "utf8");
}

export async function mkdirFs(absPath: string): Promise<void> {
  const abs = safeAbsolute(absPath);
  if (abs === "/") throw new Error("refusing to mkdir filesystem root");
  await mkdir(abs, { recursive: true });
}

export async function createFsFile(
  absPath: string,
  kind: "markdown" | "json" | "yaml" | "typescript" | "plain",
): Promise<string> {
  const seed: Record<typeof kind, string> = {
    markdown: "# untitled\n",
    json: "{}\n",
    yaml: "{}\n",
    typescript: "export {};\n",
    plain: "",
  };
  const abs = safeAbsolute(absPath);
  if (abs === "/") throw new Error("refusing to create file at filesystem root");
  await ensureDir(dirname(abs));
  await writeFile(abs, seed[kind], "utf8");
  return abs;
}

export async function deleteFsEntry(absPath: string): Promise<void> {
  const abs = safeAbsolute(absPath);
  if (abs === "/") throw new Error("refusing to delete filesystem root");
  await rm(abs, { recursive: true, force: true });
}

export class CanvasStore {
  readonly paths = getPaths();

  async ensureInitialized() {
    await Promise.all([
      ensureDir(this.paths.runtimeDir),
      ensureDir(this.paths.logsDir),
      ensureDir(this.paths.root),
      ensureDir(this.paths.workspacesDir),
      ensureDir(this.paths.browserProfilesDir),
    ]);
    await this.ensureWorkspacesInitialized();
  }

  async ensureWorkspacesInitialized() {
    await ensureDir(this.paths.workspacesDir);
    const existing = await this.readWorkspaceIndex();
    const existingIds: string[] = [];
    if (existing) {
      for (const id of existing.workspaceIds) {
        if (await this.loadWorkspace(id)) existingIds.push(id);
      }
    }
    if (existing && existingIds.length > 0) {
      const activeWorkspaceId = existingIds.includes(existing.activeWorkspaceId)
        ? existing.activeWorkspaceId
        : (existingIds[0] ?? existing.activeWorkspaceId);
      await this.writeWorkspaceIndex({ version: 1, activeWorkspaceId, workspaceIds: existingIds });
      return;
    }

    const workspace = makeWorkspace({
      label: "Workspace 1",
      rootPath: process.cwd(),
      nowIso: now(),
    });
    await this.writeWorkspace(workspace);
    await this.writeWorkspaceIndex({
      version: 1,
      activeWorkspaceId: workspace.id,
      workspaceIds: [workspace.id],
    });
  }

  async listWorkspaces(): Promise<{ activeWorkspaceId: string; workspaces: WorkspaceSummary[] }> {
    await this.ensureWorkspacesInitialized();
    const index = await this.requireWorkspaceIndex();
    const workspaces = await Promise.all(index.workspaceIds.map((id) => this.loadWorkspace(id)));
    return {
      activeWorkspaceId: index.activeWorkspaceId,
      workspaces: workspaces.filter(Boolean).map((workspace) => summarizeWorkspace(workspace as Workspace)),
    };
  }

  async getActiveWorkspace(): Promise<Workspace> {
    await this.ensureWorkspacesInitialized();
    const index = await this.requireWorkspaceIndex();
    return this.requireWorkspace(index.activeWorkspaceId);
  }

  async getWorkspace(id: string): Promise<Workspace> {
    await this.ensureWorkspacesInitialized();
    return this.requireWorkspace(id);
  }

  async createWorkspace(input: { label?: string; rootPath?: string } = {}): Promise<Workspace> {
    await this.ensureWorkspacesInitialized();
    const index = await this.requireWorkspaceIndex();
    const rootPath = safeAbsolute(input.rootPath || process.cwd());
    const label = input.label?.trim() || `Workspace ${index.workspaceIds.length + 1}`;
    const workspace = makeWorkspace({ label, rootPath, nowIso: now() });
    await this.writeWorkspace(workspace);
    await this.writeWorkspaceIndex({
      version: 1,
      activeWorkspaceId: workspace.id,
      workspaceIds: [...index.workspaceIds, workspace.id],
    });
    return workspace;
  }

  async saveWorkspace(workspace: Workspace): Promise<Workspace> {
    await this.ensureWorkspacesInitialized();
    const index = await this.requireWorkspaceIndex();
    if (!index.workspaceIds.includes(workspace.id)) {
      throw new Error(`unknown workspace: ${workspace.id}`);
    }
    const parsed = normalizeWorkspace({ ...workspace, updatedAt: now() });
    await this.writeWorkspace(parsed);
    return parsed;
  }

  async renameWorkspace(id: string, label: string): Promise<Workspace> {
    const workspace = await this.requireWorkspace(id);
    return this.saveWorkspace({ ...workspace, label: label.trim() || workspace.label });
  }

  async setActiveWorkspace(id: string): Promise<Workspace> {
    await this.ensureWorkspacesInitialized();
    const index = await this.requireWorkspaceIndex();
    if (!index.workspaceIds.includes(id)) throw new Error(`unknown workspace: ${id}`);
    const workspace = await this.requireWorkspace(id);
    const opened = await this.saveWorkspace({ ...workspace, lastOpenedAt: now() });
    await this.writeWorkspaceIndex({ ...index, activeWorkspaceId: id });
    return opened;
  }

  async closeWorkspace(id: string): Promise<{ activeWorkspaceId: string; workspaces: WorkspaceSummary[] }> {
    await this.ensureWorkspacesInitialized();
    const index = await this.requireWorkspaceIndex();
    if (!index.workspaceIds.includes(id)) throw new Error(`unknown workspace: ${id}`);
    const remainingIds = index.workspaceIds.filter((candidate) => candidate !== id);
    await rm(this.workspacePath(id), { force: true });
    if (remainingIds.length === 0) {
      const replacement = makeWorkspace({
        label: "Workspace 1",
        rootPath: process.cwd(),
        nowIso: now(),
      });
      await this.writeWorkspace(replacement);
      await this.writeWorkspaceIndex({
        version: 1,
        activeWorkspaceId: replacement.id,
        workspaceIds: [replacement.id],
      });
      return {
        activeWorkspaceId: replacement.id,
        workspaces: [summarizeWorkspace(replacement)],
      };
    }
    const activeWorkspaceId = index.activeWorkspaceId === id ? (remainingIds[0] as string) : index.activeWorkspaceId;
    await this.writeWorkspaceIndex({ version: 1, activeWorkspaceId, workspaceIds: remainingIds });
    return this.listWorkspaces();
  }

  async getBrowserSession(workspaceId: string, paneId: string): Promise<BrowserSession> {
    const workspace = await this.requireWorkspace(workspaceId);
    const pane = workspace.panes.find((candidate) => candidate.id === paneId);
    if (pane?.type !== "browser") throw new Error(`unknown browser pane: ${paneId}`);
    return browserSessionFor(this.paths.browserProfilesDir, workspaceId, pane);
  }

  async navigateBrowserPane(input: {
    workspaceId: string;
    paneId: string;
    url: string;
    replace?: boolean;
  }): Promise<{ workspace: Workspace; browser: BrowserSession }> {
    const url = browserStoredUrl(input.url);
    const workspace = await this.requireWorkspace(input.workspaceId);
    const nextPanes = workspace.panes.map((pane) => {
      if (pane.id !== input.paneId) return pane;
      if (pane.type !== "browser") throw new Error(`pane is not a browser: ${pane.id}`);
      const baseHistory = pane.history.length > 0 ? pane.history.map(browserStoredUrl) : [browserStoredUrl(pane.url)];
      const currentIndex = clampIndex(pane.historyIndex, baseHistory.length);
      const history = input.replace
        ? baseHistory.map((entry, index) => (index === currentIndex ? url : entry))
        : [...baseHistory.slice(0, currentIndex + 1), url];
      const historyIndex = input.replace ? currentIndex : history.length - 1;
      return {
        ...pane,
        title: titleForBrowserUrl(url),
        url,
        history,
        historyIndex,
        updatedAt: now(),
      } satisfies BrowserPaneState;
    });
    const saved = await this.saveWorkspace({ ...workspace, panes: nextPanes, activePaneId: input.paneId });
    return { workspace: saved, browser: await this.getBrowserSession(saved.id, input.paneId) };
  }

  async moveBrowserHistory(input: {
    workspaceId: string;
    paneId: string;
    direction: "back" | "forward";
  }): Promise<{ workspace: Workspace; browser: BrowserSession }> {
    const workspace = await this.requireWorkspace(input.workspaceId);
    const nextPanes = workspace.panes.map((pane) => {
      if (pane.id !== input.paneId) return pane;
      if (pane.type !== "browser") throw new Error(`pane is not a browser: ${pane.id}`);
      const history = pane.history.length > 0 ? pane.history.map(browserStoredUrl) : [browserStoredUrl(pane.url)];
      const currentIndex = clampIndex(pane.historyIndex, history.length);
      const delta = input.direction === "back" ? -1 : 1;
      const historyIndex = Math.min(history.length - 1, Math.max(0, currentIndex + delta));
      const url = history[historyIndex] ?? "about:blank";
      return {
        ...pane,
        title: titleForBrowserUrl(url),
        url,
        history,
        historyIndex,
        updatedAt: now(),
      } satisfies BrowserPaneState;
    });
    const saved = await this.saveWorkspace({ ...workspace, panes: nextPanes, activePaneId: input.paneId });
    return { workspace: saved, browser: await this.getBrowserSession(saved.id, input.paneId) };
  }

  async listGitRepositories(rootPath: string, depth = DEFAULT_GIT_DISCOVERY_DEPTH): Promise<GitRepository[]> {
    const root = safeAbsolute(rootPath);
    const repos = await discoverGitRepositories(root, depth);
    const out: GitRepository[] = [];
    for (const repoPath of repos) {
      const branch = cleanGitOutput(await runGit(repoPath, ["branch", "--show-current"]));
      const rel = relative(root, repoPath);
      out.push({
        id: repoPath,
        name: basename(repoPath) || repoPath,
        rootPath: repoPath,
        relativePath: rel || ".",
        branch: branch || null,
      });
    }
    return out.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  }

  async getGitStatus(repoPath: string): Promise<GitStatus> {
    const repo = safeAbsolute(repoPath);
    const output = await runGit(repo, ["status", "--porcelain=v1", "--branch"]);
    return parseGitStatus(repo, output);
  }

  async getGitDiff(repoPath: string, path: string): Promise<GitDiff> {
    const repo = safeAbsolute(repoPath);
    const filePath = path || ".";
    let diff = await runGit(repo, ["diff", "--", filePath]);
    if (!diff.trim()) diff = await runGit(repo, ["diff", "--cached", "--", filePath]);
    return { repoPath: repo, path: filePath, diff };
  }

  private workspacePath(id: string): string {
    return resolve(this.paths.workspacesDir, `${encodeURIComponent(id)}.json`);
  }

  private async readWorkspaceIndex(): Promise<WorkspaceIndex | null> {
    const raw = await readJson<unknown>(this.paths.workspacesIndexFile);
    const parsed = workspaceIndexSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }

  private async requireWorkspaceIndex(): Promise<WorkspaceIndex> {
    const index = await this.readWorkspaceIndex();
    if (!index) throw new Error("workspace index is missing");
    return index;
  }

  private async writeWorkspaceIndex(index: WorkspaceIndex) {
    await writeJson(this.paths.workspacesIndexFile, workspaceIndexSchema.parse(index));
  }

  private async loadWorkspace(id: string): Promise<Workspace | null> {
    const raw = await readJson<unknown>(this.workspacePath(id));
    const parsed = workspaceSchema.safeParse(raw);
    return parsed.success ? normalizeWorkspace(parsed.data) : null;
  }

  private async requireWorkspace(id: string): Promise<Workspace> {
    const workspace = await this.loadWorkspace(id);
    if (!workspace) throw new Error(`unknown workspace: ${id}`);
    return workspace;
  }

  private async writeWorkspace(workspace: Workspace) {
    await writeJson(this.workspacePath(workspace.id), workspaceSchema.parse(normalizeWorkspace(workspace)));
  }
}

function makeWorkspace(args: { label: string; rootPath: string; nowIso: string }): Workspace {
  const explorer = makeExplorerPane(args.rootPath, 0, args.nowIso);
  return normalizeWorkspace({
    id: makeWorkspaceId(),
    label: args.label,
    rootPath: args.rootPath,
    activeView: "panes",
    settings: DEFAULT_WORKSPACE_SETTINGS,
    panes: [explorer],
    tiledLayout: leafForPane(explorer.id),
    canvasViewport: defaultViewport(),
    activePaneId: explorer.id,
    createdAt: args.nowIso,
    updatedAt: args.nowIso,
    lastOpenedAt: args.nowIso,
  });
}

function makeWorkspaceId(): string {
  return `workspace-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function makePaneId(type: PaneState["type"], value: string): string {
  return `${type}:${encodeURIComponent(value)}`;
}

function defaultPaneRect(index: number): PaneRect {
  return {
    x: 96 + (index % 4) * 32,
    y: 72 + (index % 4) * 28,
    width: 760,
    height: 480,
  };
}

function makeExplorerPane(rootPath: string, index: number, nowIso: string): ExplorerPaneState {
  return {
    id: makePaneId("explorer", rootPath),
    type: "explorer",
    title: basename(rootPath) || rootPath,
    folderPath: rootPath,
    expandedPaths: [],
    selectedPath: null,
    placement: "tiled",
    rect: defaultPaneRect(index),
    z: index,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

function normalizeWorkspace(workspace: Workspace): Workspace {
  const panes = workspace.panes.map((pane, index) => normalizePane(pane, index, workspace.rootPath));
  const paneIds = new Set(panes.map((pane) => pane.id));
  const tiledLayout = pruneLayout(workspace.tiledLayout, paneIds) ?? layoutForPanes(panes.filter((pane) => pane.placement === "tiled"));
  const activePaneId = workspace.activePaneId && paneIds.has(workspace.activePaneId) ? workspace.activePaneId : (panes[0]?.id ?? null);
  return workspaceSchema.parse({
    ...workspace,
    panes,
    tiledLayout,
    activePaneId,
  });
}

function normalizePane(pane: PaneState, index: number, rootPath: string): PaneState {
  const base = {
    ...pane,
    rect: pane.rect ?? defaultPaneRect(index),
    z: pane.z ?? index,
  };
  if (base.type === "browser") {
    const history = (base.history.length > 0 ? base.history : [base.url || "about:blank"]).map(browserStoredUrl);
    const historyIndex = clampIndex(base.historyIndex, history.length);
    return {
      ...base,
      url: history[historyIndex] ?? browserStoredUrl(base.url || "about:blank"),
      history,
      historyIndex,
      sessionId: base.sessionId || `${base.id}:session`,
    };
  }
  if (base.type === "repositories" && !base.rootPath) return { ...base, rootPath };
  return base;
}

function layoutForPanes(panes: PaneState[]): TiledLayoutNode | null {
  if (panes.length === 0) return null;
  let layout: TiledLayoutNode = leafForPane(panes[0]!.id);
  for (const pane of panes.slice(1)) {
    layout = {
      type: "split",
      id: `split:${layoutNodeKey(layout)}:${pane.id}`,
      direction: "horizontal",
      ratio: 0.5,
      first: layout,
      second: leafForPane(pane.id),
    };
  }
  return layout;
}

function pruneLayout(layout: TiledLayoutNode | null, paneIds: Set<string>): TiledLayoutNode | null {
  if (!layout) return null;
  if (layout.type === "leaf") {
    const tabIds = leafPaneIds(layout).filter((paneId) => paneIds.has(paneId));
    if (tabIds.length === 0) return null;
    const activePaneId = tabIds.includes(layout.activePaneId ?? layout.paneId) ? (layout.activePaneId ?? layout.paneId) : tabIds[0]!;
    return { type: "leaf", paneId: activePaneId, paneIds: tabIds, activePaneId };
  }
  const first = pruneLayout(layout.first, paneIds);
  const second = pruneLayout(layout.second, paneIds);
  if (first && second) return { ...layout, first, second };
  return first ?? second;
}

function layoutNodeKey(layout: TiledLayoutNode): string {
  return layout.type === "leaf" ? layout.paneId : layout.id;
}

function leafForPane(paneId: string): TiledLayoutNode {
  return { type: "leaf", paneId, paneIds: [paneId], activePaneId: paneId };
}

function leafPaneIds(layout: Extract<TiledLayoutNode, { type: "leaf" }>): string[] {
  const paneIds = layout.paneIds && layout.paneIds.length > 0 ? layout.paneIds : [layout.paneId];
  return Array.from(new Set([...paneIds, layout.paneId]));
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

function browserSessionFor(root: string, workspaceId: string, pane: BrowserPaneState): BrowserSession {
  const url = browserStoredUrl(pane.url);
  return {
    workspaceId,
    paneId: pane.id,
    url,
    title: titleForBrowserUrl(url),
    canGoBack: pane.historyIndex > 0,
    canGoForward: pane.historyIndex < pane.history.length - 1,
    profilePath: resolve(root, encodeURIComponent(workspaceId), encodeURIComponent(pane.id)),
  };
}

function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return Math.min(Math.max(index, 0), length - 1);
}

function titleForBrowserUrl(url: string): string {
  if (!url || url === "about:blank") return "Browser";
  try {
    const parsed = new URL(url);
    return parsed.hostname || parsed.pathname || url;
  } catch {
    return url;
  }
}

async function discoverGitRepositories(root: string, depth: number): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, remaining: number) {
    if (remaining < 0) return;
    const gitPath = resolve(dir, ".git");
    if (await exists(gitPath)) {
      out.push(dir);
      return;
    }
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist") continue;
      await walk(resolve(dir, entry.name), remaining - 1);
    }
  }
  await walk(root, depth);
  return out;
}

async function runGit(repoPath: string, args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", "-C", repoPath, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(cleanGitOutput(stderr) || `git ${args.join(" ")} exited ${exitCode}`);
  }
  return stdout;
}

function cleanGitOutput(output: string): string {
  return output.trim();
}

function parseGitStatus(repoPath: string, output: string): GitStatus {
  const lines = output.split(/\r?\n/).filter(Boolean);
  const header = lines[0]?.startsWith("## ") ? lines.shift() ?? "" : "";
  const branchMatch = /^## ([^.[\s]+|\S+)/.exec(header);
  const aheadMatch = /ahead (\d+)/.exec(header);
  const behindMatch = /behind (\d+)/.exec(header);
  const files = lines.map((line) => {
    const x = line[0] ?? " ";
    const y = line[1] ?? " ";
    const rawPath = line.slice(3);
    const renamed = rawPath.includes(" -> ") ? rawPath.split(" -> ").at(-1) ?? rawPath : rawPath;
    return {
      path: renamed,
      status: `${x}${y}`.trim() || "modified",
      staged: x !== " " && x !== "?",
    };
  });
  return {
    repoPath,
    branch: branchMatch?.[1] === "HEAD" ? null : (branchMatch?.[1] ?? null),
    ahead: Number(aheadMatch?.[1] ?? 0),
    behind: Number(behindMatch?.[1] ?? 0),
    clean: files.length === 0,
    files,
  };
}
