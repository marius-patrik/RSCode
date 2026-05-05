import type { ActionGroup, ActionItem } from "@/client/ActionsMenu";
import { CommandPopover, flattenGroups } from "@/client/CommandPopover";
import type { WorkspaceSummary } from "@/shared/schema";
import { cn } from "@/shared/utils";
import {
  Columns2,
  Folder,
  FolderGit2,
  FolderKanban,
  GitBranch,
  Globe2,
  Grid2X2,
  Pencil,
  Plus,
  Settings,
  Terminal,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

type DockProps = {
  busy?: boolean;
  workspaces: WorkspaceSummary[];
  activeWorkspaceId: string | null;
  activeView: "panes" | "canvas";
  onSwitchWorkspace: (id: string) => void;
  onCreateWorkspace: () => void;
  onRenameWorkspace: (id: string) => void;
  onCloseWorkspace: (id: string) => void;
  onToggleView: () => void;
  commandQuery: string;
  onCommandQueryChange: (next: string) => void;
  commandGroups: ActionGroup[];
  launcherGroups: ActionGroup[];
  onTerminalSubmit: (input: string) => void;
  onCommandFocus?: () => void;
  onCommandBlur?: () => void;
};

export function Dock({
  busy = false,
  workspaces,
  activeWorkspaceId,
  activeView,
  onSwitchWorkspace,
  onCreateWorkspace,
  onRenameWorkspace,
  onCloseWorkspace,
  onToggleView,
  commandQuery,
  onCommandQueryChange,
  commandGroups,
  launcherGroups,
  onTerminalSubmit,
  onCommandFocus,
  onCommandBlur,
}: DockProps) {
  const [focused, setFocused] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target?.matches("input, textarea, [contenteditable]")) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "1") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  const trimmedQuery = commandQuery.trim();
  const prefixedQuery = commandQuery.trimStart();
  const launcherMode = prefixedQuery.startsWith("/") ? "commands" : prefixedQuery.startsWith(">") ? "terminal" : "search";
  const launcherFilter =
    launcherMode === "commands" || launcherMode === "terminal" ? prefixedQuery.slice(1).trimStart() : trimmedQuery;
  const activeGroups = launcherMode === "commands" ? commandGroups : launcherMode === "search" ? launcherGroups : [];
  const popoverOpen = focused && launcherMode !== "terminal" && (launcherMode === "commands" || launcherFilter.length > 0);
  const visibleItems = popoverOpen ? flattenGroups(launcherFilter, activeGroups) : [];
  const visibleCount = visibleItems.length;
  const commandById = useMemo(() => indexCommands(commandGroups), [commandGroups]);
  const quickActions = [
    { id: "pane.open.explorer", title: "Explorer", icon: Folder },
    { id: "pane.open.terminal", title: "Terminal", icon: Terminal },
    { id: "pane.open.browser", title: "Browser", icon: Globe2 },
    { id: "pane.open.repositories", title: "Repositories", icon: FolderGit2 },
    { id: "pane.open.source-control", title: "Source Control", icon: GitBranch },
  ] as const;

  function submitTop() {
    if (!trimmedQuery) return;
    if (launcherMode === "terminal") {
      onTerminalSubmit(launcherFilter);
      clearInput();
      return;
    }
    if (visibleCount === 0) return;
    const idx = highlight < visibleCount ? highlight : 0;
    const item = visibleItems[idx]?.item;
    if (!item || item.disabledReason) return;
    item.onSelect();
    clearInput();
  }

  function clearInput() {
    onCommandQueryChange("");
    setHighlight(0);
    inputRef.current?.blur();
  }

  function runAction(id: string) {
    const action = commandById.get(id);
    if (!action || action.disabledReason) return;
    action.onSelect();
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-[var(--dock-bg)] text-foreground backdrop-blur-xl">
      <div className="relative mx-auto flex h-12 max-w-screen-2xl items-center gap-2 px-2">
        {popoverOpen ? (
          <CommandPopover
            query={launcherFilter}
            groups={activeGroups}
            highlight={highlight}
            onHighlightChange={setHighlight}
            onPick={(idx) => {
              const item = visibleItems[idx]?.item;
              if (!item || item.disabledReason) return;
              item.onSelect();
              clearInput();
            }}
          />
        ) : null}

        <div className="mr-auto flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {workspaces.map((workspace) => {
            const active = workspace.id === activeWorkspaceId;
            return (
              <div
                key={workspace.id}
                className={cn(
                  "group flex h-8 max-w-[170px] shrink-0 items-center gap-1 rounded-md border px-1",
                  active ? "border-ring bg-[var(--control-bg)] text-foreground" : "border-transparent text-muted-foreground",
                )}
              >
                <button
                  type="button"
                  title={`${workspace.label} - ${workspace.rootPath}`}
                  onClick={() => onSwitchWorkspace(workspace.id)}
                  className="flex min-w-0 items-center gap-1.5 px-1"
                >
                  <FolderKanban className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate text-xs">{workspace.label}</span>
                  {active && busy ? <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-foreground" /> : null}
                </button>
                {active ? (
                  <DockIconButton title="Rename workspace" onClick={() => onRenameWorkspace(workspace.id)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </DockIconButton>
                ) : null}
                {workspaces.length > 1 ? (
                  <DockIconButton title="Close workspace" onClick={() => onCloseWorkspace(workspace.id)}>
                    <X className="h-3.5 w-3.5" />
                  </DockIconButton>
                ) : null}
              </div>
            );
          })}
          <DockIconButton title="New workspace" onClick={onCreateWorkspace} prominent>
            <Plus className="h-4 w-4" />
          </DockIconButton>
        </div>

        <div className="flex shrink-0 items-center gap-1 border-l border-border pl-2">
          {quickActions.map((action) => {
            const item = commandById.get(action.id);
            const Icon = action.icon;
            return (
              <DockIconButton
                key={action.id}
                title={item?.disabledReason ?? action.title}
                onClick={() => runAction(action.id)}
                disabled={!item || Boolean(item.disabledReason)}
              >
                <Icon className="h-4 w-4" />
              </DockIconButton>
            );
          })}
        </div>

        <input
          ref={inputRef}
          value={commandQuery}
          onChange={(e) => {
            onCommandQueryChange(e.target.value);
            setHighlight(0);
          }}
          onFocus={() => {
            setFocused(true);
            onCommandFocus?.();
          }}
          onBlur={() => {
            setFocused(false);
            onCommandBlur?.();
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey)) {
              if (launcherMode === "terminal") return;
              if (visibleCount === 0) return;
              e.preventDefault();
              setHighlight((h) => (h + 1) % visibleCount);
            } else if (e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey)) {
              if (launcherMode === "terminal") return;
              if (visibleCount === 0) return;
              e.preventDefault();
              setHighlight((h) => (h - 1 + visibleCount) % visibleCount);
            } else if (e.key === "Enter") {
              e.preventDefault();
              submitTop();
            } else if (e.key === "Escape") {
              e.preventDefault();
              onCommandQueryChange("");
              setHighlight(0);
              inputRef.current?.blur();
            }
          }}
          placeholder="Search files or web, / commands, > terminal"
          spellCheck={false}
          className="w-[min(42vw,560px)] min-w-[240px] flex-none rounded-md border border-border bg-[var(--input-bg)] px-3 py-1.5 font-mono text-[12px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <div className="flex shrink-0 items-center gap-1 border-l border-border pl-2">
          <DockIconButton title={activeView === "panes" ? "Switch to canvas" : "Switch to panes"} onClick={onToggleView} active>
            {activeView === "panes" ? <Grid2X2 className="h-4 w-4" /> : <Columns2 className="h-4 w-4" />}
          </DockIconButton>
          <DockIconButton title={commandById.get("pane.open.settings")?.disabledReason ?? "Settings"} onClick={() => runAction("pane.open.settings")}>
            <Settings className="h-4 w-4" />
          </DockIconButton>
        </div>
      </div>
    </div>
  );
}

function DockIconButton({
  title,
  onClick,
  children,
  active,
  disabled,
  prominent,
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
  active?: boolean;
  disabled?: boolean;
  prominent?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-transparent text-muted-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-35",
        "hover:border-border hover:bg-[var(--control-bg)] hover:text-foreground",
        active && "border-ring bg-[var(--control-bg)] text-foreground",
        prominent && "border-border bg-[var(--control-bg)] text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function indexCommands(groups: ActionGroup[]): Map<string, ActionItem> {
  const out = new Map<string, ActionItem>();
  for (const group of groups) {
    for (const item of group.items) out.set(item.id, item);
  }
  return out;
}
