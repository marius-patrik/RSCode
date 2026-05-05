import { z } from "zod";

export const fsEntrySchema = z.object({
  kind: z.enum(["dir", "file"]),
  name: z.string(),
  path: z.string(),
});

export const runtimeStatusSchema = z.object({
  pid: z.number().int().positive().nullable(),
  startedAt: z.string().nullable(),
  port: z.number().int().positive(),
  url: z.string(),
  logPath: z.string(),
  graphPath: z.string(),
  workspacePath: z.string(),
  isHealthy: z.boolean(),
});

export const graphPinTypeSchema = z.enum([
  "trigger",
  "path",
  "text",
  "command",
  "cwd",
  "result",
  "error",
]);
export const graphPinDirectionSchema = z.enum(["input", "output"]);

export const graphNodeKindSchema = z.enum([
  "fs.read",
  "fs.write",
  "fs.mkdir",
  "fs.delete",
  "terminal.run",
]);

export const graphPositionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

export const graphNodeConfigSchema = z.object({
  path: z.string().optional(),
  text: z.string().optional(),
  command: z.string().optional(),
  cwd: z.string().optional(),
  timeoutMs: z.number().int().positive().max(120_000).optional(),
});

export const graphNodeSchema = z.object({
  id: z.string().trim().min(1),
  kind: graphNodeKindSchema,
  label: z.string().trim().min(1).optional(),
  position: graphPositionSchema,
  config: graphNodeConfigSchema.default({}),
});

export const graphEdgeSchema = z.object({
  id: z.string().trim().min(1),
  source: z.string().trim().min(1),
  sourcePin: z.string().trim().min(1),
  target: z.string().trim().min(1),
  targetPin: z.string().trim().min(1),
});

export const canvasGraphSchema = z.object({
  version: z.literal(1),
  nodes: z.array(graphNodeSchema),
  edges: z.array(graphEdgeSchema),
  updatedAt: z.string(),
});

export const graphIssueSchema = z.object({
  severity: z.enum(["error", "warning"]),
  message: z.string(),
  edgeId: z.string().optional(),
  nodeId: z.string().optional(),
});

export const graphExecutionStepSchema = z.object({
  nodeId: z.string(),
  kind: graphNodeKindSchema,
  status: z.enum(["completed", "failed", "skipped"]),
  outputs: z.record(z.string(), z.unknown()),
  error: z.string().nullable(),
  startedAt: z.string(),
  completedAt: z.string(),
});

export const graphExecutionResultSchema = z.object({
  ok: z.boolean(),
  startedAt: z.string(),
  completedAt: z.string(),
  steps: z.array(graphExecutionStepSchema),
  issues: z.array(graphIssueSchema),
});

export const viewportStateSchema = z.object({
  x: z.number(),
  y: z.number(),
  zoom: z.number().positive(),
});

export const panelRectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
});

const panelBaseSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  rect: panelRectSchema,
  z: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const editorPanelStateSchema = panelBaseSchema.extend({
  kind: z.literal("editor"),
  path: z.string().trim().min(1),
  draftBody: z.string(),
  dirty: z.boolean().default(false),
});

export const terminalPanelStateSchema = panelBaseSchema.extend({
  kind: z.literal("terminal"),
  cwd: z.string().trim().min(1),
});

export const panelStateSchema = z.discriminatedUnion("kind", [
  editorPanelStateSchema,
  terminalPanelStateSchema,
]);

export const canvasSessionSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  rootPath: z.string().trim().min(1),
  address: z.string().trim().min(1),
  expandedPaths: z.array(z.string()).default([]),
  openPanels: z.array(panelStateSchema).default([]),
  graph: canvasGraphSchema,
  viewport: viewportStateSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  lastOpenedAt: z.string(),
});

export const canvasSessionSummarySchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  rootPath: z.string().trim().min(1),
  address: z.string().trim().min(1),
  panelCount: z.number().int().nonnegative(),
  graphNodeCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastOpenedAt: z.string(),
});

export const canvasSessionIndexSchema = z.object({
  version: z.literal(1),
  activeSessionId: z.string().trim().min(1),
  sessionIds: z.array(z.string().trim().min(1)),
});

export const finderResultSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  detail: z.string().optional(),
  kind: z.enum(["file", "folder", "panel", "graph", "command", "path"]),
 });

export type FsEntry = z.infer<typeof fsEntrySchema>;
export type RuntimeStatus = z.infer<typeof runtimeStatusSchema>;
export type GraphPinType = z.infer<typeof graphPinTypeSchema>;
export type GraphPinDirection = z.infer<typeof graphPinDirectionSchema>;
export type GraphNodeKind = z.infer<typeof graphNodeKindSchema>;
export type GraphNodeConfig = z.infer<typeof graphNodeConfigSchema>;
export type GraphNode = z.infer<typeof graphNodeSchema>;
export type GraphEdge = z.infer<typeof graphEdgeSchema>;
export type CanvasGraph = z.infer<typeof canvasGraphSchema>;
export type GraphIssue = z.infer<typeof graphIssueSchema>;
export type GraphExecutionStep = z.infer<typeof graphExecutionStepSchema>;
export type GraphExecutionResult = z.infer<typeof graphExecutionResultSchema>;
export type ViewportState = z.infer<typeof viewportStateSchema>;
export type PanelState = z.infer<typeof panelStateSchema>;
export type EditorPanelState = z.infer<typeof editorPanelStateSchema>;
export type TerminalPanelState = z.infer<typeof terminalPanelStateSchema>;
export type CanvasSession = z.infer<typeof canvasSessionSchema>;
export type CanvasSessionSummary = z.infer<typeof canvasSessionSummarySchema>;
export type CanvasSessionIndex = z.infer<typeof canvasSessionIndexSchema>;
export type FinderResult = z.infer<typeof finderResultSchema>;

export type GraphPinDefinition = {
  id: string;
  label: string;
  type: GraphPinType;
  direction: GraphPinDirection;
};

export type GraphNodeDefinition = {
  kind: GraphNodeKind;
  label: string;
  description: string;
  inputs: GraphPinDefinition[];
  outputs: GraphPinDefinition[];
};

export const GRAPH_NODE_DEFINITIONS: Record<GraphNodeKind, GraphNodeDefinition> = {
  "fs.read": {
    kind: "fs.read",
    label: "Read File",
    description: "Read a UTF-8 file from disk.",
    inputs: [
      { id: "in", label: "In", type: "trigger", direction: "input" },
      { id: "path", label: "Path", type: "path", direction: "input" },
    ],
    outputs: [
      { id: "done", label: "Done", type: "trigger", direction: "output" },
      { id: "text", label: "Text", type: "text", direction: "output" },
      { id: "result", label: "Result", type: "result", direction: "output" },
      { id: "error", label: "Error", type: "error", direction: "output" },
    ],
  },
  "fs.write": {
    kind: "fs.write",
    label: "Write File",
    description: "Write UTF-8 text to disk.",
    inputs: [
      { id: "in", label: "In", type: "trigger", direction: "input" },
      { id: "path", label: "Path", type: "path", direction: "input" },
      { id: "text", label: "Text", type: "text", direction: "input" },
    ],
    outputs: [
      { id: "done", label: "Done", type: "trigger", direction: "output" },
      { id: "result", label: "Result", type: "result", direction: "output" },
      { id: "error", label: "Error", type: "error", direction: "output" },
    ],
  },
  "fs.mkdir": {
    kind: "fs.mkdir",
    label: "Make Folder",
    description: "Create a folder recursively.",
    inputs: [
      { id: "in", label: "In", type: "trigger", direction: "input" },
      { id: "path", label: "Path", type: "path", direction: "input" },
    ],
    outputs: [
      { id: "done", label: "Done", type: "trigger", direction: "output" },
      { id: "result", label: "Result", type: "result", direction: "output" },
      { id: "error", label: "Error", type: "error", direction: "output" },
    ],
  },
  "fs.delete": {
    kind: "fs.delete",
    label: "Delete Entry",
    description: "Delete a file or folder recursively.",
    inputs: [
      { id: "in", label: "In", type: "trigger", direction: "input" },
      { id: "path", label: "Path", type: "path", direction: "input" },
    ],
    outputs: [
      { id: "done", label: "Done", type: "trigger", direction: "output" },
      { id: "result", label: "Result", type: "result", direction: "output" },
      { id: "error", label: "Error", type: "error", direction: "output" },
    ],
  },
  "terminal.run": {
    kind: "terminal.run",
    label: "Run Command",
    description: "Run a bounded shell command.",
    inputs: [
      { id: "in", label: "In", type: "trigger", direction: "input" },
      { id: "command", label: "Command", type: "command", direction: "input" },
      { id: "cwd", label: "Cwd", type: "cwd", direction: "input" },
    ],
    outputs: [
      { id: "done", label: "Done", type: "trigger", direction: "output" },
      { id: "text", label: "Stdout", type: "text", direction: "output" },
      { id: "result", label: "Result", type: "result", direction: "output" },
      { id: "error", label: "Error", type: "error", direction: "output" },
    ],
  },
};

export function emptyGraph(): CanvasGraph {
  return { version: 1, nodes: [], edges: [], updatedAt: new Date().toISOString() };
}

export function defaultViewport(): ViewportState {
  return { x: 0, y: 0, zoom: 1 };
}
