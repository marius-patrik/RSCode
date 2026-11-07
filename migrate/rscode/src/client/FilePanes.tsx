import { MonacoEditor, languageForFile } from "@/client/MonacoEditor";
import { TerminalNodeView } from "@/client/TerminalNode";
import type { EditorPaneState, ExplorerPaneState, FsEntry, PaneState, TerminalPaneState } from "@/shared/schema";
import { cn } from "@/shared/utils";
import { ChevronDown, ChevronRight, FileText, Folder, Terminal as TerminalIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useMemo } from "react";

export function ExplorerPane({
  pane,
  fileTrees,
  selectedPath,
  onSelectPath,
  onUpdatePane,
  onOpenEditor,
  onOpenTerminal,
  onRequestTree,
}: {
  pane: ExplorerPaneState;
  fileTrees: Map<string, FsEntry[]>;
  selectedPath: string | null;
  onSelectPath: (path: string | null) => void;
  onUpdatePane: (paneId: string, updater: (pane: PaneState) => PaneState) => void;
  onOpenEditor: (path: string, placement?: PaneState["placement"]) => Promise<void>;
  onOpenTerminal: (cwd?: string, placement?: PaneState["placement"]) => void;
  onRequestTree: (path: string) => void;
}) {
  const expanded = useMemo(() => new Set(pane.expandedPaths), [pane.expandedPaths]);
  const toggle = (path: string) => {
    const next = new Set(expanded);
    if (next.has(path)) {
      for (const existing of Array.from(next)) {
        if (existing === path || existing.startsWith(`${path}/`)) next.delete(existing);
      }
    } else {
      next.add(path);
      onRequestTree(path);
    }
    onUpdatePane(pane.id, (candidate) =>
      candidate.type === "explorer" ? { ...candidate, expandedPaths: Array.from(next) } : candidate,
    );
  };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-2">
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground">{pane.folderPath}</span>
        <HeaderButton title="Terminal here" onClick={() => onOpenTerminal(pane.folderPath)}>
          <TerminalIcon className="h-3.5 w-3.5" />
        </HeaderButton>
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-1">
        <TreeBranch
          path={pane.folderPath}
          depth={0}
          expanded={expanded}
          fileTrees={fileTrees}
          selectedPath={selectedPath}
          onSelectPath={(path) => {
            onSelectPath(path);
            onUpdatePane(pane.id, (candidate) =>
              candidate.type === "explorer" ? { ...candidate, selectedPath: path } : candidate,
            );
          }}
          onToggle={toggle}
          onOpenEditor={onOpenEditor}
        />
      </div>
    </div>
  );
}

function TreeBranch({
  path,
  depth,
  expanded,
  fileTrees,
  selectedPath,
  onSelectPath,
  onToggle,
  onOpenEditor,
}: {
  path: string;
  depth: number;
  expanded: Set<string>;
  fileTrees: Map<string, FsEntry[]>;
  selectedPath: string | null;
  onSelectPath: (path: string) => void;
  onToggle: (path: string) => void;
  onOpenEditor: (path: string, placement?: PaneState["placement"]) => Promise<void>;
}) {
  const entries = fileTrees.get(path);
  if (!entries) {
    return <div className="px-3 py-2 font-mono text-[11px] text-muted-foreground">loading...</div>;
  }
  if (entries.length === 0) {
    return <div className="px-3 py-2 font-mono text-[11px] text-muted-foreground">empty</div>;
  }
  return (
    <div>
      {entries.map((entry) => {
        const isExpanded = expanded.has(entry.path);
        const isSelected = selectedPath === entry.path;
        return (
          <div key={entry.path}>
            <button
              type="button"
              onClick={() => {
                onSelectPath(entry.path);
                if (entry.kind === "dir") onToggle(entry.path);
                else void onOpenEditor(entry.path);
              }}
              className={cn(
                "flex h-7 w-full items-center gap-1.5 px-2 text-left text-xs hover:bg-[var(--surface-hover)]",
                isSelected && "bg-secondary text-foreground",
              )}
              style={{ paddingLeft: 8 + depth * 14 }}
            >
              {entry.kind === "dir" ? (
                isExpanded ? (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )
              ) : (
                <span className="w-3.5 shrink-0" />
              )}
              {entry.kind === "dir" ? (
                <Folder className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              )}
              <span className="truncate">{entry.name}</span>
            </button>
            {entry.kind === "dir" && isExpanded ? (
              <TreeBranch
                path={entry.path}
                depth={depth + 1}
                expanded={expanded}
                fileTrees={fileTrees}
                selectedPath={selectedPath}
                onSelectPath={onSelectPath}
                onToggle={onToggle}
                onOpenEditor={onOpenEditor}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function EditorPane({
  pane,
  onUpdatePane,
  onSaveEditor,
}: {
  pane: EditorPaneState;
  onUpdatePane: (paneId: string, updater: (pane: PaneState) => PaneState) => void;
  onSaveEditor: (pane: EditorPaneState) => Promise<void>;
}) {
  return (
    <div
      className="h-full"
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
          event.preventDefault();
          void onSaveEditor(pane);
        }
      }}
    >
      <MonacoEditor
        value={pane.draftBody}
        language={languageForFile(pane.filePath.split("/").pop() ?? "")}
        onChange={(draftBody) =>
          onUpdatePane(pane.id, (candidate) =>
            candidate.type === "editor" ? { ...candidate, draftBody, dirty: true } : candidate,
          )
        }
      />
    </div>
  );
}

export function TerminalPane({ pane, baseUrl }: { pane: TerminalPaneState; baseUrl?: string }) {
  return (
    <div className="h-full p-2">
      <TerminalNodeView cwd={pane.cwd} paneId={pane.id} baseUrl={baseUrl} />
    </div>
  );
}

function HeaderButton({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={onClick}
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-[var(--surface-hover)] hover:text-foreground"
    >
      {children}
    </button>
  );
}
