import {
  defaultPaneRect,
  maxPaneZ,
} from "@/client/paneLayout";
import type {
  BrowserPaneState,
  EditorPaneState,
  ExplorerPaneState,
  PaneState,
  SettingsPaneState,
  SourceControlPaneState,
  TerminalPaneState,
} from "@/shared/schema";

export function makeExplorerPane(
  rootPath: string,
  panes: PaneState[],
  placement: PaneState["placement"],
): ExplorerPaneState {
  const now = nowIso();
  return {
    id: `explorer:${encodeURIComponent(rootPath)}:${Date.now().toString(36)}`,
    type: "explorer",
    title: rootPath.split("/").filter(Boolean).at(-1) || rootPath,
    folderPath: rootPath,
    expandedPaths: [],
    selectedPath: null,
    placement,
    rect: defaultPaneRect(panes.length),
    z: maxPaneZ(panes) + 1,
    createdAt: now,
    updatedAt: now,
  };
}

export function makeEditorPane(
  filePath: string,
  body: string,
  panes: PaneState[],
  placement: PaneState["placement"],
): EditorPaneState {
  const now = nowIso();
  return {
    id: `editor:${encodeURIComponent(filePath)}`,
    type: "editor",
    title: filePath.split("/").pop() || filePath,
    filePath,
    draftBody: body,
    dirty: false,
    placement,
    rect: defaultPaneRect(panes.length),
    z: maxPaneZ(panes) + 1,
    createdAt: now,
    updatedAt: now,
  };
}

export function makeTerminalPane(
  cwd: string,
  panes: PaneState[],
  placement: PaneState["placement"],
): TerminalPaneState {
  const now = nowIso();
  return {
    id: `terminal:${encodeURIComponent(cwd)}:${Date.now().toString(36)}`,
    type: "terminal",
    title: `terminal - ${cwd}`,
    cwd,
    placement,
    rect: defaultPaneRect(panes.length),
    z: maxPaneZ(panes) + 1,
    createdAt: now,
    updatedAt: now,
  };
}

export function makeBrowserPane(
  url: string,
  panes: PaneState[],
  placement: PaneState["placement"],
): BrowserPaneState {
  const now = nowIso();
  const id = `browser:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 7)}`;
  return {
    id,
    type: "browser",
    title: url === "about:blank" ? "Browser" : url,
    url,
    history: [url],
    historyIndex: 0,
    sessionId: `${id}:session`,
    placement,
    rect: defaultPaneRect(panes.length),
    z: maxPaneZ(panes) + 1,
    createdAt: now,
    updatedAt: now,
  };
}

export function makeSourceControlPane(
  repoPath: string | null,
  panes: PaneState[],
  placement: PaneState["placement"],
): SourceControlPaneState {
  const now = nowIso();
  return {
    id: `sourceControl:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 7)}`,
    type: "sourceControl",
    title: "Source Control",
    repoPath,
    placement,
    rect: defaultPaneRect(panes.length),
    z: maxPaneZ(panes) + 1,
    createdAt: now,
    updatedAt: now,
  };
}

export function makeRepositoriesPane(
  rootPath: string,
  panes: PaneState[],
  placement: PaneState["placement"],
): PaneState {
  const now = nowIso();
  return {
    id: `repositories:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 7)}`,
    type: "repositories",
    title: "Repositories",
    rootPath,
    placement,
    rect: defaultPaneRect(panes.length),
    z: maxPaneZ(panes) + 1,
    createdAt: now,
    updatedAt: now,
  };
}

export function makeSettingsPane(panes: PaneState[], placement: PaneState["placement"]): SettingsPaneState {
  const now = nowIso();
  return {
    id: `settings:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 7)}`,
    type: "settings",
    title: "Settings",
    placement,
    rect: defaultPaneRect(panes.length),
    z: maxPaneZ(panes) + 1,
    createdAt: now,
    updatedAt: now,
  };
}

export function clonePaneForSplit(pane: PaneState, panes: PaneState[]): PaneState {
  const now = nowIso();
  const rect = defaultPaneRect(panes.length);
  const z = maxPaneZ(panes) + 1;
  const id = `${pane.id}:split:${Date.now().toString(36)}`;
  if (pane.type === "browser") {
    return {
      ...pane,
      id,
      sessionId: `${id}:session`,
      placement: "tiled",
      rect,
      z,
      createdAt: now,
      updatedAt: now,
    };
  }
  return { ...pane, id, placement: "tiled", rect, z, createdAt: now, updatedAt: now };
}

function nowIso(): string {
  return new Date().toISOString();
}
