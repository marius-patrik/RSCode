import {
  BUILTIN_WORKSPACE_THEMES,
  DEFAULT_THEME_COLORS,
  DEFAULT_WORKSPACE_SETTINGS,
  type Workspace,
  type WorkspaceSettings,
  type WorkspaceThemeColorKey,
  type WorkspaceThemeColors,
  type WorkspaceThemeDefinition,
} from "@/shared/schema";

export const THEME_COLOR_FIELDS: Array<{ key: WorkspaceThemeColorKey; label: string }> = [
  { key: "background", label: "Background" },
  { key: "foreground", label: "Text" },
  { key: "muted", label: "Muted Surface" },
  { key: "mutedForeground", label: "Muted Text" },
  { key: "primary", label: "Accent" },
  { key: "primaryForeground", label: "Accent Text" },
  { key: "secondary", label: "Secondary Surface" },
  { key: "secondaryForeground", label: "Secondary Text" },
  { key: "border", label: "Border" },
  { key: "ring", label: "Focus Ring" },
  { key: "surface1", label: "Surface 1" },
  { key: "surface2", label: "Surface 2" },
  { key: "surfaceHover", label: "Hover Surface" },
  { key: "panelBg", label: "Pane Glass" },
  { key: "chromeBg", label: "Chrome Glass" },
  { key: "dockBg", label: "Dock Glass" },
  { key: "controlBg", label: "Control Glass" },
  { key: "inputBg", label: "Input Glass" },
  { key: "gridLine", label: "Grid Line" },
];

const THEME_CSS_VARIABLES: Array<[keyof WorkspaceThemeColors, string]> = [
  ["background", "--background"],
  ["foreground", "--foreground"],
  ["muted", "--muted"],
  ["mutedForeground", "--muted-foreground"],
  ["primary", "--primary"],
  ["primaryForeground", "--primary-foreground"],
  ["secondary", "--secondary"],
  ["secondaryForeground", "--secondary-foreground"],
  ["border", "--border"],
  ["ring", "--ring"],
  ["surface1", "--surface-1"],
  ["surface2", "--surface-2"],
  ["surfaceHover", "--surface-hover"],
  ["panelBg", "--panel-bg"],
  ["chromeBg", "--chrome-bg"],
  ["dockBg", "--dock-bg"],
  ["controlBg", "--control-bg"],
  ["inputBg", "--input-bg"],
  ["gridLine", "--grid-line"],
];

export function workspaceWithSettingsDefaults(workspace: Workspace): Workspace {
  return { ...workspace, settings: settingsForWorkspace(workspace) };
}

export function settingsForWorkspace(workspace: Workspace): WorkspaceSettings {
  return { ...DEFAULT_WORKSPACE_SETTINGS, ...(workspace.settings ?? {}) };
}

export function resolveWorkspaceTheme(settings: WorkspaceSettings | undefined | null): WorkspaceThemeDefinition {
  const normalized = { ...DEFAULT_WORKSPACE_SETTINGS, ...(settings ?? {}) };
  const custom = normalized.customThemes.find((theme) => theme.id === normalized.theme);
  if (custom) return normalizeTheme(custom);
  const builtin = BUILTIN_WORKSPACE_THEMES.find((theme) => theme.id === normalized.theme) ?? BUILTIN_WORKSPACE_THEMES[0];
  return normalizeTheme(builtin);
}

export function applyWorkspaceTheme(theme: WorkspaceThemeDefinition): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.themeMode = theme.mode;
  root.classList.toggle("dark", theme.mode === "dark");
  for (const [key, cssVariable] of THEME_CSS_VARIABLES) {
    root.style.setProperty(cssVariable, theme.colors[key]);
  }
}

export function makeCustomTheme(source: WorkspaceThemeDefinition, index: number): WorkspaceThemeDefinition {
  const id = `custom:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 6)}`;
  return {
    id,
    label: `Custom ${index}`,
    mode: source.mode,
    colors: { ...source.colors },
  };
}

export function colorInputValue(value: string): string {
  const hex = value.trim();
  if (/^#[\da-f]{6}$/i.test(hex)) return hex;
  const rgb = hex.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!rgb) return "#000000";
  const channels = [rgb[1], rgb[2], rgb[3]].map((channel) => Number(channel));
  if (channels.some((channel) => Number.isNaN(channel) || channel < 0 || channel > 255)) return "#000000";
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function normalizeTheme(theme: {
  id: string;
  label: string;
  mode: "dark" | "light";
  colors: Partial<WorkspaceThemeColors>;
}): WorkspaceThemeDefinition {
  return {
    id: theme.id,
    label: theme.label,
    mode: theme.mode,
    colors: { ...DEFAULT_THEME_COLORS[theme.mode], ...theme.colors },
  };
}
