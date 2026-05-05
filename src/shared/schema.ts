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
  workspacePath: z.string(),
  isHealthy: z.boolean(),
});

export const viewportStateSchema = z.object({
  x: z.number(),
  y: z.number(),
  zoom: z.number().positive(),
});

export const paneRectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
});

export const paneTypeSchema = z.enum([
  "explorer",
  "editor",
  "terminal",
  "browser",
  "sourceControl",
  "repositories",
]);

export const panePlacementSchema = z.enum(["tiled", "floating", "canvas"]);

const paneBaseSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  placement: panePlacementSchema.default("tiled"),
  rect: paneRectSchema,
  z: z.number().int().nonnegative().default(0),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const explorerPaneStateSchema = paneBaseSchema.extend({
  type: z.literal("explorer"),
  folderPath: z.string().trim().min(1),
  expandedPaths: z.array(z.string()).default([]),
  selectedPath: z.string().nullable().default(null),
});

export const editorPaneStateSchema = paneBaseSchema.extend({
  type: z.literal("editor"),
  filePath: z.string().trim().min(1),
  draftBody: z.string(),
  dirty: z.boolean().default(false),
});

export const terminalPaneStateSchema = paneBaseSchema.extend({
  type: z.literal("terminal"),
  cwd: z.string().trim().min(1),
});

export const browserPaneStateSchema = paneBaseSchema.extend({
  type: z.literal("browser"),
  url: z.string().default("about:blank"),
  history: z.array(z.string()).default(["about:blank"]),
  historyIndex: z.number().int().nonnegative().default(0),
  sessionId: z.string().trim().min(1),
});

export const sourceControlPaneStateSchema = paneBaseSchema.extend({
  type: z.literal("sourceControl"),
  repoPath: z.string().trim().min(1).nullable().default(null),
});

export const repositoriesPaneStateSchema = paneBaseSchema.extend({
  type: z.literal("repositories"),
  rootPath: z.string().trim().min(1),
});

export const paneStateSchema = z.discriminatedUnion("type", [
  explorerPaneStateSchema,
  editorPaneStateSchema,
  terminalPaneStateSchema,
  browserPaneStateSchema,
  sourceControlPaneStateSchema,
  repositoriesPaneStateSchema,
]);

export type TiledLayoutNode =
  | {
      type: "leaf";
      paneId: string;
    }
  | {
      type: "split";
      id: string;
      direction: "horizontal" | "vertical";
      ratio: number;
      first: TiledLayoutNode;
      second: TiledLayoutNode;
    };

export const tiledLayoutNodeSchema: z.ZodType<TiledLayoutNode> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.object({
      type: z.literal("leaf"),
      paneId: z.string().trim().min(1),
    }),
    z.object({
      type: z.literal("split"),
      id: z.string().trim().min(1),
      direction: z.enum(["horizontal", "vertical"]),
      ratio: z.number().min(0.15).max(0.85),
      first: tiledLayoutNodeSchema,
      second: tiledLayoutNodeSchema,
    }),
  ]),
);

export const workspaceSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  rootPath: z.string().trim().min(1),
  activeView: z.enum(["panes", "canvas"]).default("panes"),
  panes: z.array(paneStateSchema).default([]),
  tiledLayout: tiledLayoutNodeSchema.nullable().default(null),
  canvasViewport: viewportStateSchema,
  activePaneId: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastOpenedAt: z.string(),
});

export const workspaceSummarySchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  rootPath: z.string().trim().min(1),
  activeView: z.enum(["panes", "canvas"]),
  paneCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastOpenedAt: z.string(),
});

export const workspaceIndexSchema = z.object({
  version: z.literal(1),
  activeWorkspaceId: z.string().trim().min(1),
  workspaceIds: z.array(z.string().trim().min(1)),
});

export const gitRepositorySchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  rootPath: z.string().trim().min(1),
  relativePath: z.string(),
  branch: z.string().nullable(),
});

export const gitChangedFileSchema = z.object({
  path: z.string(),
  status: z.string(),
  staged: z.boolean(),
});

export const gitStatusSchema = z.object({
  repoPath: z.string().trim().min(1),
  branch: z.string().nullable(),
  ahead: z.number().int().nonnegative(),
  behind: z.number().int().nonnegative(),
  clean: z.boolean(),
  files: z.array(gitChangedFileSchema),
});

export const gitDiffSchema = z.object({
  repoPath: z.string().trim().min(1),
  path: z.string(),
  diff: z.string(),
});

export const browserSessionSchema = z.object({
  workspaceId: z.string().trim().min(1),
  paneId: z.string().trim().min(1),
  url: z.string(),
  title: z.string(),
  canGoBack: z.boolean(),
  canGoForward: z.boolean(),
  profilePath: z.string(),
});

export const finderResultSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  detail: z.string().optional(),
  kind: z.enum(["file", "folder", "pane", "workspace", "repository", "command", "path"]),
});

export type FsEntry = z.infer<typeof fsEntrySchema>;
export type RuntimeStatus = z.infer<typeof runtimeStatusSchema>;
export type ViewportState = z.infer<typeof viewportStateSchema>;
export type PaneRect = z.infer<typeof paneRectSchema>;
export type PaneType = z.infer<typeof paneTypeSchema>;
export type PanePlacement = z.infer<typeof panePlacementSchema>;
export type PaneState = z.infer<typeof paneStateSchema>;
export type ExplorerPaneState = z.infer<typeof explorerPaneStateSchema>;
export type EditorPaneState = z.infer<typeof editorPaneStateSchema>;
export type TerminalPaneState = z.infer<typeof terminalPaneStateSchema>;
export type BrowserPaneState = z.infer<typeof browserPaneStateSchema>;
export type SourceControlPaneState = z.infer<typeof sourceControlPaneStateSchema>;
export type RepositoriesPaneState = z.infer<typeof repositoriesPaneStateSchema>;
export type Workspace = z.infer<typeof workspaceSchema>;
export type WorkspaceSummary = z.infer<typeof workspaceSummarySchema>;
export type WorkspaceIndex = z.infer<typeof workspaceIndexSchema>;
export type GitRepository = z.infer<typeof gitRepositorySchema>;
export type GitChangedFile = z.infer<typeof gitChangedFileSchema>;
export type GitStatus = z.infer<typeof gitStatusSchema>;
export type GitDiff = z.infer<typeof gitDiffSchema>;
export type BrowserSession = z.infer<typeof browserSessionSchema>;
export type FinderResult = z.infer<typeof finderResultSchema>;

export function defaultViewport(): ViewportState {
  return { x: 0, y: 0, zoom: 1 };
}
