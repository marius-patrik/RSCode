import { appendFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { getPaths, getServicePort, getServiceUrl } from "@/paths.ts";
import {
  type CanvasGraph,
  type CanvasSession,
  type CanvasSessionIndex,
  type CanvasSessionSummary,
  type FsEntry,
  GRAPH_NODE_DEFINITIONS,
  type GraphEdge,
  type GraphExecutionResult,
  type GraphExecutionStep,
  type GraphIssue,
  type GraphNode,
  type GraphPinDefinition,
  canvasGraphSchema,
  canvasSessionIndexSchema,
  canvasSessionSchema,
  defaultViewport,
  emptyGraph,
} from "@/schema.ts";

const MAX_READ_BYTES = 1_000_000;
const DEFAULT_TERMINAL_TIMEOUT_MS = 10_000;

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
      ensureDir(this.paths.sessionsDir),
    ]);
    if (!(await exists(this.paths.graphFile))) {
      await this.saveGraph(emptyGraph());
    }
    await this.ensureSessionsInitialized();
  }

  async appendLog(line: string) {
    await ensureDir(dirname(this.paths.serviceLogFile));
    await appendFile(this.paths.serviceLogFile, `${line}\n`, "utf8");
  }

  async readLogTail(lines = 200): Promise<string> {
    try {
      const content = await readFile(this.paths.serviceLogFile, "utf8");
      return content.split(/\r?\n/).slice(-lines).join("\n");
    } catch {
      return "";
    }
  }

  async getRuntimeStatus() {
    const raw = await readJson<Record<string, unknown>>(this.paths.runtimeFile);
    return {
      pid: typeof raw?.pid === "number" ? raw.pid : null,
      startedAt: typeof raw?.startedAt === "string" ? raw.startedAt : null,
      port: getServicePort(),
      url: getServiceUrl(),
      logPath: this.paths.serviceLogFile,
      graphPath: this.paths.graphFile,
      workspacePath: process.cwd(),
      isHealthy: true,
    };
  }

  async ensureSessionsInitialized() {
    await ensureDir(this.paths.sessionsDir);
    const existing = await this.readSessionIndex();
    const existingIds: string[] = [];
    if (existing) {
      for (const id of existing.sessionIds) {
        if (await exists(this.sessionPath(id))) existingIds.push(id);
      }
    }
    if (existing && existingIds.length > 0) {
      const activeSessionId = existingIds.includes(existing.activeSessionId)
        ? existing.activeSessionId
        : (existingIds[0] ?? existing.activeSessionId);
      await this.writeSessionIndex({ version: 1, activeSessionId, sessionIds: existingIds });
      return;
    }

    const nowIso = now();
    const graph = await this.loadGraph();
    const session = makeSession({ label: "Canvas 1", rootPath: process.cwd(), graph, nowIso });
    await this.writeSession(session);
    await this.writeSessionIndex({ version: 1, activeSessionId: session.id, sessionIds: [session.id] });
  }

  async listSessions(): Promise<{ activeSessionId: string; sessions: CanvasSessionSummary[] }> {
    await this.ensureSessionsInitialized();
    const index = await this.requireSessionIndex();
    const sessions = await Promise.all(index.sessionIds.map((id) => this.loadSession(id)));
    const summaries = sessions.filter(Boolean).map((session) => summarizeSession(session as CanvasSession));
    return { activeSessionId: index.activeSessionId, sessions: summaries };
  }

  async getActiveSession(): Promise<CanvasSession> {
    await this.ensureSessionsInitialized();
    const index = await this.requireSessionIndex();
    return this.requireSession(index.activeSessionId);
  }

  async getSession(id: string): Promise<CanvasSession> {
    await this.ensureSessionsInitialized();
    return this.requireSession(id);
  }

  async createSession(input: { label?: string; rootPath?: string } = {}): Promise<CanvasSession> {
    await this.ensureSessionsInitialized();
    const index = await this.requireSessionIndex();
    const nowIso = now();
    const rootPath = safeAbsolute(input.rootPath || process.cwd());
    const label = input.label?.trim() || `Canvas ${index.sessionIds.length + 1}`;
    const session: CanvasSession = {
      id: makeSessionId(),
      label,
      rootPath,
      address: rootPath,
      expandedPaths: [],
      openPanels: [],
      graph: emptyGraph(),
      viewport: defaultViewport(),
      createdAt: nowIso,
      updatedAt: nowIso,
      lastOpenedAt: nowIso,
    };
    const nextIds = [...index.sessionIds, session.id];
    await this.writeSession(session);
    await this.writeSessionIndex({ version: 1, activeSessionId: session.id, sessionIds: nextIds });
    return session;
  }

  async saveSession(session: CanvasSession): Promise<CanvasSession> {
    await this.ensureSessionsInitialized();
    const index = await this.requireSessionIndex();
    if (!index.sessionIds.includes(session.id)) {
      throw new Error(`unknown session: ${session.id}`);
    }
    const parsed = canvasSessionSchema.parse({ ...session, updatedAt: now() });
    await this.writeSession(parsed);
    return parsed;
  }

  async renameSession(id: string, label: string): Promise<CanvasSession> {
    const session = await this.requireSession(id);
    return this.saveSession({ ...session, label: label.trim() || session.label });
  }

  async setActiveSession(id: string): Promise<CanvasSession> {
    await this.ensureSessionsInitialized();
    const index = await this.requireSessionIndex();
    if (!index.sessionIds.includes(id)) throw new Error(`unknown session: ${id}`);
    const session = await this.requireSession(id);
    const opened = await this.saveSession({ ...session, lastOpenedAt: now() });
    await this.writeSessionIndex({ ...index, activeSessionId: id });
    return opened;
  }

  async closeSession(id: string): Promise<{ activeSessionId: string; sessions: CanvasSessionSummary[] }> {
    await this.ensureSessionsInitialized();
    const index = await this.requireSessionIndex();
    if (!index.sessionIds.includes(id)) throw new Error(`unknown session: ${id}`);
    const remainingIds = index.sessionIds.filter((candidate) => candidate !== id);
    await rm(this.sessionPath(id), { force: true });
    if (remainingIds.length === 0) {
      const replacement = makeSession({
        label: "Canvas 1",
        rootPath: process.cwd(),
        graph: emptyGraph(),
        nowIso: now(),
      });
      await this.writeSession(replacement);
      await this.writeSessionIndex({
        version: 1,
        activeSessionId: replacement.id,
        sessionIds: [replacement.id],
      });
      return {
        activeSessionId: replacement.id,
        sessions: [summarizeSession(replacement)],
      };
    }
    const activeSessionId = index.activeSessionId === id ? (remainingIds[0] as string) : index.activeSessionId;
    await this.writeSessionIndex({ version: 1, activeSessionId, sessionIds: remainingIds });
    return this.listSessions();
  }

  async loadGraph(): Promise<CanvasGraph> {
    const raw = await readJson<unknown>(this.paths.graphFile);
    if (!raw) return emptyGraph();
    const parsed = canvasGraphSchema.safeParse(raw);
    return parsed.success ? parsed.data : emptyGraph();
  }

  async saveGraph(graph: CanvasGraph): Promise<CanvasGraph> {
    const parsed = canvasGraphSchema.parse({
      ...graph,
      updatedAt: now(),
    });
    await writeJson(this.paths.graphFile, parsed);
    return parsed;
  }

  validateGraph(graph: CanvasGraph): GraphIssue[] {
    return validateGraph(graph);
  }

  async executeGraph(graph: CanvasGraph, startNodeId?: string | null): Promise<GraphExecutionResult> {
    return executeGraph(graph, startNodeId ?? null);
  }

  private sessionPath(id: string): string {
    return resolve(this.paths.sessionsDir, `${encodeURIComponent(id)}.json`);
  }

  private async readSessionIndex(): Promise<CanvasSessionIndex | null> {
    const raw = await readJson<unknown>(this.paths.sessionsIndexFile);
    const parsed = canvasSessionIndexSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }

  private async requireSessionIndex(): Promise<CanvasSessionIndex> {
    const index = await this.readSessionIndex();
    if (!index) throw new Error("session index is missing");
    return index;
  }

  private async writeSessionIndex(index: CanvasSessionIndex) {
    await writeJson(this.paths.sessionsIndexFile, canvasSessionIndexSchema.parse(index));
  }

  private async loadSession(id: string): Promise<CanvasSession | null> {
    const raw = await readJson<unknown>(this.sessionPath(id));
    const parsed = canvasSessionSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }

  private async requireSession(id: string): Promise<CanvasSession> {
    const session = await this.loadSession(id);
    if (!session) throw new Error(`unknown session: ${id}`);
    return session;
  }

  private async writeSession(session: CanvasSession) {
    await writeJson(this.sessionPath(session.id), canvasSessionSchema.parse(session));
  }
}

function makeSession(args: {
  label: string;
  rootPath: string;
  graph: CanvasGraph;
  nowIso: string;
}): CanvasSession {
  return {
    id: makeSessionId(),
    label: args.label,
    rootPath: args.rootPath,
    address: args.rootPath,
    expandedPaths: [],
    openPanels: [],
    graph: args.graph,
    viewport: defaultViewport(),
    createdAt: args.nowIso,
    updatedAt: args.nowIso,
    lastOpenedAt: args.nowIso,
  };
}

function makeSessionId(): string {
  return `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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

function findPin(node: GraphNode, pinId: string, direction: "input" | "output"): GraphPinDefinition | null {
  const definition = GRAPH_NODE_DEFINITIONS[node.kind];
  const pins = direction === "input" ? definition.inputs : definition.outputs;
  return pins.find((pin) => pin.id === pinId) ?? null;
}

export function validateGraph(graph: CanvasGraph): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const seenEdgeIds = new Set<string>();

  for (const edge of graph.edges) {
    if (seenEdgeIds.has(edge.id)) {
      issues.push({ severity: "error", edgeId: edge.id, message: `duplicate edge id: ${edge.id}` });
    }
    seenEdgeIds.add(edge.id);

    const source = nodes.get(edge.source);
    const target = nodes.get(edge.target);
    if (!source) {
      issues.push({ severity: "error", edgeId: edge.id, message: `unknown source node: ${edge.source}` });
      continue;
    }
    if (!target) {
      issues.push({ severity: "error", edgeId: edge.id, message: `unknown target node: ${edge.target}` });
      continue;
    }
    const sourcePin = findPin(source, edge.sourcePin, "output");
    const targetPin = findPin(target, edge.targetPin, "input");
    if (!sourcePin) {
      issues.push({ severity: "error", edgeId: edge.id, message: `unknown source pin: ${edge.source}.${edge.sourcePin}` });
      continue;
    }
    if (!targetPin) {
      issues.push({ severity: "error", edgeId: edge.id, message: `unknown target pin: ${edge.target}.${edge.targetPin}` });
      continue;
    }
    if (sourcePin.type !== targetPin.type) {
      issues.push({
        severity: "error",
        edgeId: edge.id,
        message: `pin type mismatch: ${sourcePin.type} cannot connect to ${targetPin.type}`,
      });
    }
    if (edge.source === edge.target) {
      issues.push({ severity: "error", edgeId: edge.id, message: "self-connections are not executable" });
    }
  }

  for (const node of graph.nodes) {
    if (!GRAPH_NODE_DEFINITIONS[node.kind]) {
      issues.push({ severity: "error", nodeId: node.id, message: `unknown node kind: ${node.kind}` });
      continue;
    }
    for (const missing of missingRequiredConfig(node)) {
      issues.push({ severity: "error", nodeId: node.id, message: `missing ${missing}` });
    }
  }

  return issues;
}

function missingRequiredConfig(node: GraphNode): string[] {
  if (node.kind === "fs.read" || node.kind === "fs.mkdir" || node.kind === "fs.delete") {
    return optionalString(node.config.path) ? [] : ["path"];
  }
  if (node.kind === "fs.write") {
    const missing: string[] = [];
    if (!optionalString(node.config.path)) missing.push("path");
    if (typeof node.config.text !== "string") missing.push("text");
    return missing;
  }
  const missing: string[] = [];
  if (!optionalString(node.config.command)) missing.push("command");
  if (!optionalString(node.config.cwd)) missing.push("cwd");
  return missing;
}

async function executeGraph(graph: CanvasGraph, startNodeId: string | null): Promise<GraphExecutionResult> {
  const startedAt = now();
  const issues = validateGraph(graph);
  if (issues.some((issue) => issue.severity === "error")) {
    return { ok: false, startedAt, completedAt: now(), steps: [], issues };
  }

  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const selectedIds = selectExecutableNodes(graph, startNodeId);
  const order = topologicalOrder(graph, selectedIds);
  if (order.cycle) {
    return {
      ok: false,
      startedAt,
      completedAt: now(),
      steps: [],
      issues: [...issues, { severity: "error", message: "graph contains a cycle" }],
    };
  }

  const values = new Map<string, Record<string, unknown>>();
  const steps: GraphExecutionStep[] = [];

  for (const nodeId of order.ids) {
    const node = nodesById.get(nodeId);
    if (!node) continue;
    const stepStartedAt = now();
    const inputs = inputValuesFor(node, graph.edges, values);
    try {
      const outputs = await executeNode(node, inputs);
      values.set(node.id, outputs);
      steps.push({
        nodeId: node.id,
        kind: node.kind,
        status: "completed",
        outputs,
        error: null,
        startedAt: stepStartedAt,
        completedAt: now(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const outputs = { error: message };
      values.set(node.id, outputs);
      steps.push({
        nodeId: node.id,
        kind: node.kind,
        status: "failed",
        outputs,
        error: message,
        startedAt: stepStartedAt,
        completedAt: now(),
      });
    }
  }

  return {
    ok: steps.every((step) => step.status === "completed"),
    startedAt,
    completedAt: now(),
    steps,
    issues,
  };
}

function selectExecutableNodes(graph: CanvasGraph, startNodeId: string | null): Set<string> {
  if (!startNodeId) return new Set(graph.nodes.map((node) => node.id));
  const ids = new Set<string>([startNodeId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of graph.edges) {
      if (ids.has(edge.source) && !ids.has(edge.target)) {
        ids.add(edge.target);
        changed = true;
      }
      if (ids.has(edge.target) && !ids.has(edge.source)) {
        ids.add(edge.source);
        changed = true;
      }
    }
  }
  return ids;
}

function topologicalOrder(
  graph: CanvasGraph,
  selectedIds: Set<string>,
): { ids: string[]; cycle: boolean } {
  const indegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const id of selectedIds) {
    indegree.set(id, 0);
    outgoing.set(id, []);
  }
  for (const edge of graph.edges) {
    if (!selectedIds.has(edge.source) || !selectedIds.has(edge.target)) continue;
    outgoing.get(edge.source)?.push(edge.target);
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  }

  const queue = [...indegree.entries()]
    .filter(([, degree]) => degree === 0)
    .map(([id]) => id)
    .sort();
  const result: string[] = [];

  while (queue.length > 0) {
    const id = queue.shift()!;
    result.push(id);
    for (const target of (outgoing.get(id) ?? []).sort()) {
      const next = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, next);
      if (next === 0) queue.push(target);
    }
    queue.sort();
  }

  return { ids: result, cycle: result.length !== selectedIds.size };
}

function inputValuesFor(
  node: GraphNode,
  edges: GraphEdge[],
  values: Map<string, Record<string, unknown>>,
): Record<string, unknown> {
  const inputs: Record<string, unknown> = {
    path: node.config.path,
    text: node.config.text,
    command: node.config.command,
    cwd: node.config.cwd,
  };

  for (const edge of edges) {
    if (edge.target !== node.id) continue;
    const sourceOutputs = values.get(edge.source);
    if (!sourceOutputs) continue;
    if (edge.sourcePin in sourceOutputs) {
      inputs[edge.targetPin] = sourceOutputs[edge.sourcePin];
    }
  }

  return inputs;
}

async function executeNode(
  node: GraphNode,
  inputs: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (node.kind === "fs.read") {
    const path = requiredString(inputs.path, "path");
    const text = await readFsFile(path);
    return { done: true, text, result: { path, bytes: new TextEncoder().encode(text).byteLength } };
  }

  if (node.kind === "fs.write") {
    const path = requiredString(inputs.path, "path");
    const text = requiredString(inputs.text, "text");
    await writeFsFile(path, text);
    return { done: true, result: { path, bytes: new TextEncoder().encode(text).byteLength } };
  }

  if (node.kind === "fs.mkdir") {
    const path = requiredString(inputs.path, "path");
    await mkdirFs(path);
    return { done: true, result: { path } };
  }

  if (node.kind === "fs.delete") {
    const path = requiredString(inputs.path, "path");
    await deleteFsEntry(path);
    return { done: true, result: { path } };
  }

  const command = requiredString(inputs.command, "command");
  const cwd = safeAbsolute(optionalString(inputs.cwd) || process.cwd());
  const timeoutMs = node.config.timeoutMs ?? DEFAULT_TERMINAL_TIMEOUT_MS;
  const result = await runTerminalCommand(command, cwd, timeoutMs);
  if (result.exitCode !== 0) {
    return {
      done: true,
      text: result.stdout,
      result,
      error: result.stderr || `command exited ${result.exitCode}`,
    };
  }
  return { done: true, text: result.stdout, result };
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`missing ${label}`);
  }
  return value;
}

async function runTerminalCommand(command: string, cwd: string, timeoutMs: number) {
  const shell = process.env.SHELL ?? "/bin/bash";
  const proc = Bun.spawn([shell, "-lc", command], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, TERM: "xterm-256color" },
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill("SIGTERM");
  }, timeoutMs);

  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]).finally(() => clearTimeout(timer));

  return {
    command,
    cwd,
    exitCode: timedOut ? 124 : exitCode,
    stdout,
    stderr: timedOut ? `${stderr}\nTimed out after ${timeoutMs}ms`.trim() : stderr,
    timedOut,
  };
}
