import { type CommandDefinition, disabled, enabled } from "@/client/commands";
import type { EditorPaneState, FsEntry, GitRepository, PaneState, Workspace } from "@/shared/schema";

export type WorkspaceModalRequest =
  | {
      kind: "prompt";
      title: string;
      message: string;
      defaultValue: string;
      confirmLabel: string;
      onSubmit: (value: string) => void;
    }
  | {
      kind: "confirm";
      title: string;
      message: string;
      confirmLabel: string;
      destructive?: boolean;
      onConfirm: () => void;
    };

export function createWorkspaceCommands(args: {
  workspace: Workspace;
  activePane: PaneState | null;
  selectedEntry: FsEntry | null;
  selectedPath: string | null;
  repositories: GitRepository[];
  setModal: (modal: WorkspaceModalRequest) => void;
  openExplorerPane: () => void;
  openEditorPane: (path: string, placement?: PaneState["placement"]) => Promise<void>;
  openTerminalPane: (cwd?: string, placement?: PaneState["placement"]) => void;
  openBrowserPane: (url?: string, placement?: PaneState["placement"]) => void;
  openSourceControlPane: (repoPath?: string | null, placement?: PaneState["placement"]) => void;
  openRepositoriesPane: (placement?: PaneState["placement"]) => void;
  openSettingsPane: (placement?: PaneState["placement"]) => void;
  closePane: (paneId: string) => void;
  splitPane: (paneId: string, direction?: "horizontal" | "vertical") => void;
  addPaneTab: (paneId: string) => void;
  setPanePlacement: (paneId: string, placement: PaneState["placement"]) => void;
  saveEditorPane: (pane: EditorPaneState) => Promise<void>;
  setView: (view: Workspace["activeView"]) => void;
  refreshExplorer: () => void;
  mkdir: (parentPath: string) => void;
  createFile: (parentPath: string, kind: "markdown" | "json" | "yaml" | "typescript" | "plain") => void;
  deleteEntry: (path: string) => void;
}): CommandDefinition[] {
  const activeEditor = args.activePane?.type === "editor" ? args.activePane : null;
  const selectedPath = args.selectedPath;
  const contextFolder = selectedPath
    ? args.selectedEntry?.kind === "file"
      ? parentPath(selectedPath)
      : selectedPath
    : args.workspace.rootPath;
  return [
    {
      id: "workspace.view.panes",
      label: "Show Panes",
      scope: "workspace",
      group: "workspace",
      enabled,
      run: () => args.setView("panes"),
    },
    {
      id: "workspace.view.canvas",
      label: "Show Canvas",
      scope: "workspace",
      group: "workspace",
      enabled,
      run: () => args.setView("canvas"),
    },
    {
      id: "workspace.refresh",
      label: "Refresh Workspace",
      scope: "workspace",
      group: "workspace",
      enabled,
      run: args.refreshExplorer,
    },
    {
      id: "pane.open.explorer",
      label: "Open Explorer",
      scope: "pane",
      group: "pane",
      enabled,
      run: args.openExplorerPane,
    },
    {
      id: "pane.open.terminal",
      label: "Open Terminal",
      scope: "pane",
      group: "pane",
      hint: contextFolder,
      enabled,
      run: () => args.openTerminalPane(contextFolder),
    },
    {
      id: "pane.open.browser",
      label: "Open Browser",
      scope: "browser",
      group: "browser",
      enabled,
      run: () => args.openBrowserPane("about:blank"),
    },
    {
      id: "pane.open.repositories",
      label: "Open Repositories",
      scope: "git",
      group: "git",
      enabled,
      run: () => args.openRepositoriesPane(),
    },
    {
      id: "pane.open.source-control",
      label: "Open Source Control",
      scope: "git",
      group: "git",
      hint: args.repositories[0]?.relativePath,
      enabled,
      run: () => args.openSourceControlPane(args.repositories[0]?.rootPath ?? null),
    },
    {
      id: "pane.open.settings",
      label: "Open Settings",
      scope: "workspace",
      group: "workspace",
      enabled,
      run: () => args.openSettingsPane(),
    },
    {
      id: "fs.open-file",
      label: "Open in Editor",
      scope: "filesystem",
      group: "item",
      hint: selectedPath ?? undefined,
      enabled: () => (args.selectedEntry?.kind === "file" ? enabled() : disabled("select a file")),
      run: () => {
        if (selectedPath) void args.openEditorPane(selectedPath);
      },
    },
    {
      id: "fs.delete-entry",
      label: args.selectedEntry?.kind === "dir" ? "Delete Folder" : "Delete File",
      scope: "filesystem",
      group: "item",
      hint: selectedPath ?? undefined,
      destructive: true,
      enabled: () => (selectedPath ? enabled() : disabled("select an item")),
      run: () => {
        if (selectedPath) args.deleteEntry(selectedPath);
      },
    },
    {
      id: "new.folder",
      label: "+ Subfolder",
      scope: "filesystem",
      group: "new",
      hint: contextFolder,
      enabled,
      run: () => args.mkdir(contextFolder),
    },
    ...(["markdown", "json", "yaml", "typescript", "plain"] as const).map((kind) => ({
      id: `new.file.${kind}`,
      label: `+ File: ${kind}`,
      scope: "filesystem" as const,
      group: "new",
      hint: contextFolder,
      enabled,
      run: () => args.createFile(contextFolder, kind),
    })),
    {
      id: "pane.save-active",
      label: "Save Active Editor",
      scope: "pane",
      group: "pane",
      hint: activeEditor?.filePath,
      enabled: () => (activeEditor ? enabled() : disabled("focus an editor")),
      run: () => {
        if (activeEditor) void args.saveEditorPane(activeEditor);
      },
    },
    {
      id: "pane.split-active",
      label: "Split Active Pane Right",
      scope: "pane",
      group: "pane",
      hint: args.activePane?.title,
      enabled: () => (args.activePane ? enabled() : disabled("focus a pane")),
      run: () => {
        if (args.activePane) args.splitPane(args.activePane.id);
      },
    },
    {
      id: "pane.split-active-vertical",
      label: "Split Active Pane Down",
      scope: "pane",
      group: "pane",
      hint: args.activePane?.title,
      enabled: () => (args.activePane ? enabled() : disabled("focus a pane")),
      run: () => {
        if (args.activePane) args.splitPane(args.activePane.id, "vertical");
      },
    },
    {
      id: "pane.tab-active",
      label: "New Tab in Active Pane",
      scope: "pane",
      group: "pane",
      hint: args.activePane?.title,
      enabled: () => (args.activePane ? enabled() : disabled("focus a pane")),
      run: () => {
        if (args.activePane) args.addPaneTab(args.activePane.id);
      },
    },
    {
      id: "pane.float-active",
      label: "Float Active Pane",
      scope: "pane",
      group: "pane",
      hint: args.activePane?.title,
      enabled: () => (args.activePane ? enabled() : disabled("focus a pane")),
      run: () => {
        if (args.activePane) args.setPanePlacement(args.activePane.id, "floating");
      },
    },
    {
      id: "pane.close-active",
      label: "Close Active Pane",
      scope: "pane",
      group: "pane",
      hint: args.activePane?.title,
      enabled: () => (args.activePane ? enabled() : disabled("focus a pane")),
      run: () => {
        if (args.activePane) args.closePane(args.activePane.id);
      },
    },
  ];
}

export function findEntry(fileTrees: Map<string, FsEntry[]>, path: string): FsEntry | null {
  const parent = parentPath(path);
  return fileTrees.get(parent)?.find((entry) => entry.path === path) ?? null;
}

export function joinPath(parent: string, name: string): string {
  if (parent === "/" || parent === "") return `/${name}`;
  return `${parent}/${name}`;
}

export function parentPath(absPath: string): string {
  if (!absPath || absPath === "/") return "/";
  const idx = absPath.lastIndexOf("/");
  if (idx <= 0) return "/";
  return absPath.slice(0, idx);
}

export function extensionForKind(kind: "markdown" | "json" | "yaml" | "typescript" | "plain"): string {
  if (kind === "markdown") return "md";
  if (kind === "typescript") return "ts";
  if (kind === "yaml") return "yaml";
  if (kind === "json") return "json";
  return "txt";
}
