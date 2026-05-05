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
  "settings",
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

export const settingsPaneStateSchema = paneBaseSchema.extend({
  type: z.literal("settings"),
});

export const paneStateSchema = z.discriminatedUnion("type", [
  explorerPaneStateSchema,
  editorPaneStateSchema,
  terminalPaneStateSchema,
  browserPaneStateSchema,
  sourceControlPaneStateSchema,
  repositoriesPaneStateSchema,
  settingsPaneStateSchema,
]);

export type TiledLayoutNode =
  | {
      type: "leaf";
      paneId: string;
      paneIds?: string[];
      activePaneId?: string | null;
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
      paneIds: z.array(z.string().trim().min(1)).default([]),
      activePaneId: z.string().trim().min(1).nullable().default(null),
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

export const WORKSPACE_THEME_COLOR_KEYS = [
  "background",
  "foreground",
  "muted",
  "mutedForeground",
  "primary",
  "primaryForeground",
  "secondary",
  "secondaryForeground",
  "border",
  "ring",
  "surface1",
  "surface2",
  "surfaceHover",
  "panelBg",
  "chromeBg",
  "dockBg",
  "controlBg",
  "inputBg",
  "gridLine",
] as const;

export const DEFAULT_THEME_COLORS = {
  dark: {
    background: "#000000",
    foreground: "#ffffff",
    muted: "rgba(255, 255, 255, 0.055)",
    mutedForeground: "#9b9b9b",
    primary: "rgba(255, 255, 255, 0.92)",
    primaryForeground: "#0a0a0a",
    secondary: "rgba(255, 255, 255, 0.07)",
    secondaryForeground: "#ffffff",
    border: "rgba(255, 255, 255, 0.13)",
    ring: "rgba(255, 255, 255, 0.56)",
    surface1: "rgba(255, 255, 255, 0.035)",
    surface2: "rgba(255, 255, 255, 0.065)",
    surfaceHover: "rgba(255, 255, 255, 0.11)",
    panelBg: "rgba(0, 0, 0, 0.72)",
    chromeBg: "rgba(0, 0, 0, 0.56)",
    dockBg: "rgba(0, 0, 0, 0.78)",
    controlBg: "rgba(255, 255, 255, 0.065)",
    inputBg: "rgba(255, 255, 255, 0.05)",
    gridLine: "rgba(255, 255, 255, 0.055)",
  },
  light: {
    background: "#ffffff",
    foreground: "#050505",
    muted: "rgba(0, 0, 0, 0.045)",
    mutedForeground: "#646464",
    primary: "rgba(5, 5, 5, 0.9)",
    primaryForeground: "#ffffff",
    secondary: "rgba(255, 255, 255, 0.66)",
    secondaryForeground: "#050505",
    border: "rgba(0, 0, 0, 0.1)",
    ring: "rgba(5, 5, 5, 0.42)",
    surface1: "rgba(255, 255, 255, 0.5)",
    surface2: "rgba(255, 255, 255, 0.68)",
    surfaceHover: "rgba(0, 0, 0, 0.075)",
    panelBg: "rgba(255, 255, 255, 0.72)",
    chromeBg: "rgba(255, 255, 255, 0.58)",
    dockBg: "rgba(255, 255, 255, 0.76)",
    controlBg: "rgba(255, 255, 255, 0.52)",
    inputBg: "rgba(255, 255, 255, 0.58)",
    gridLine: "rgba(0, 0, 0, 0.045)",
  },
} as const;

export const BUILTIN_WORKSPACE_THEMES = [
  { id: "dark", label: "Dark", mode: "dark", colors: DEFAULT_THEME_COLORS.dark },
  { id: "light", label: "Light", mode: "light", colors: DEFAULT_THEME_COLORS.light },
] as const;

const themeColorValueSchema = z.string().trim().min(1).max(96);

export const workspaceThemeColorsSchema = z.object({
  background: themeColorValueSchema.default(DEFAULT_THEME_COLORS.dark.background),
  foreground: themeColorValueSchema.default(DEFAULT_THEME_COLORS.dark.foreground),
  muted: themeColorValueSchema.default(DEFAULT_THEME_COLORS.dark.muted),
  mutedForeground: themeColorValueSchema.default(DEFAULT_THEME_COLORS.dark.mutedForeground),
  primary: themeColorValueSchema.default(DEFAULT_THEME_COLORS.dark.primary),
  primaryForeground: themeColorValueSchema.default(DEFAULT_THEME_COLORS.dark.primaryForeground),
  secondary: themeColorValueSchema.default(DEFAULT_THEME_COLORS.dark.secondary),
  secondaryForeground: themeColorValueSchema.default(DEFAULT_THEME_COLORS.dark.secondaryForeground),
  border: themeColorValueSchema.default(DEFAULT_THEME_COLORS.dark.border),
  ring: themeColorValueSchema.default(DEFAULT_THEME_COLORS.dark.ring),
  surface1: themeColorValueSchema.default(DEFAULT_THEME_COLORS.dark.surface1),
  surface2: themeColorValueSchema.default(DEFAULT_THEME_COLORS.dark.surface2),
  surfaceHover: themeColorValueSchema.default(DEFAULT_THEME_COLORS.dark.surfaceHover),
  panelBg: themeColorValueSchema.default(DEFAULT_THEME_COLORS.dark.panelBg),
  chromeBg: themeColorValueSchema.default(DEFAULT_THEME_COLORS.dark.chromeBg),
  dockBg: themeColorValueSchema.default(DEFAULT_THEME_COLORS.dark.dockBg),
  controlBg: themeColorValueSchema.default(DEFAULT_THEME_COLORS.dark.controlBg),
  inputBg: themeColorValueSchema.default(DEFAULT_THEME_COLORS.dark.inputBg),
  gridLine: themeColorValueSchema.default(DEFAULT_THEME_COLORS.dark.gridLine),
});

export const workspaceThemeDefinitionSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1).max(48),
  mode: z.enum(["dark", "light"]).default("dark"),
  colors: workspaceThemeColorsSchema,
});

export const workspaceSettingsSchema = z.object({
  theme: z.string().trim().min(1).default("dark"),
  defaultView: z.enum(["panes", "canvas"]).default("panes"),
  backgroundStyle: z.enum(["grid", "flat", "dot"]).default("grid"),
  accentColor: z.enum(["neutral", "blue", "green", "amber", "red", "violet"]).default("neutral"),
  customThemes: z.array(workspaceThemeDefinitionSchema).default([]),
  tabbedPanes: z.boolean().default(true),
});

export const DEFAULT_WORKSPACE_SETTINGS = {
  theme: "dark" as const,
  defaultView: "panes" as const,
  backgroundStyle: "grid" as const,
  accentColor: "neutral" as const,
  customThemes: [],
  tabbedPanes: true,
};

export const workspaceSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  rootPath: z.string().trim().min(1),
  activeView: z.enum(["panes", "canvas"]).default("panes"),
  settings: workspaceSettingsSchema.default(DEFAULT_WORKSPACE_SETTINGS),
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
export type SettingsPaneState = z.infer<typeof settingsPaneStateSchema>;
export type Workspace = z.infer<typeof workspaceSchema>;
export type WorkspaceSettings = z.infer<typeof workspaceSettingsSchema>;
export type WorkspaceThemeColorKey = (typeof WORKSPACE_THEME_COLOR_KEYS)[number];
export type WorkspaceThemeColors = z.infer<typeof workspaceThemeColorsSchema>;
export type WorkspaceThemeDefinition = z.infer<typeof workspaceThemeDefinitionSchema>;
export type WorkspaceSummary = z.infer<typeof workspaceSummarySchema>;
export type WorkspaceIndex = z.infer<typeof workspaceIndexSchema>;
export type GitRepository = z.infer<typeof gitRepositorySchema>;
export type GitChangedFile = z.infer<typeof gitChangedFileSchema>;
export type GitStatus = z.infer<typeof gitStatusSchema>;
export type GitDiff = z.infer<typeof gitDiffSchema>;
export type BrowserSession = z.infer<typeof browserSessionSchema>;

export function defaultViewport(): ViewportState {
  return { x: 0, y: 0, zoom: 1 };
}
