import type { ActionGroup } from "@/ActionsMenu.tsx";
import { cn } from "@/utils.ts";
import { useEffect, useMemo } from "react";

// Action popover anchored to the dock command input. Mirrors
// ActionsMenu's filtering / grouping but renders **upward** from the
// input (the dock sits at the bottom of the screen) and owns no input
// itself — the dock's <input> drives `query` and Enter submission.

export type CommandPopoverProps = {
  query: string;
  groups: ActionGroup[];
  highlight: number;
  onHighlightChange: (next: number) => void;
  onPick: (idx: number) => void;
};

export function flattenGroups(query: string, groups: ActionGroup[]): Array<{ group: ActionGroup["id"]; itemIdx: number; group_label: string; item: ActionGroup["items"][number] }> {
  const filterText = query.trim().toLowerCase();
  const flat: Array<{ group: ActionGroup["id"]; itemIdx: number; group_label: string; item: ActionGroup["items"][number] }> = [];
  for (const g of groups) {
    for (const it of g.items) {
      if (!filterText || matches(filterText, `${g.label} ${it.label} ${it.hint ?? ""}`)) {
        flat.push({ group: g.id, itemIdx: flat.length, group_label: g.label, item: it });
      }
    }
  }
  return flat;
}

export function CommandPopover({ query, groups, highlight, onHighlightChange, onPick }: CommandPopoverProps) {
  const visible = useMemo(() => flattenGroups(query, groups), [query, groups]);

  // Clamp highlight if filter shrinks the list out from under it.
  useEffect(() => {
    if (highlight >= visible.length) onHighlightChange(0);
  }, [visible.length, highlight, onHighlightChange]);

  // Build per-group item lists in original group order.
  const grouped: Array<{ group: ActionGroup; items: ActionGroup["items"] }> = [];
  for (const g of groups) {
    const items = visible.filter((v) => v.group === g.id).map((v) => v.item);
    if (items.length > 0) grouped.push({ group: g, items });
  }

  let runningIdx = -1;

  return (
    <div
      data-context-menu
      className="glass-heavy pointer-events-auto absolute bottom-full left-0 right-0 mb-2 flex max-h-[420px] flex-col overflow-hidden rounded-xl border border-white/10 shadow-2xl backdrop-blur-xl"
    >
      <div className="flex-1 overflow-y-auto py-1">
        {visible.length === 0 ? (
          <div className="px-4 py-3 font-mono text-[11px] text-muted-foreground/60">no matches</div>
        ) : (
          grouped.map(({ group, items }) => (
            <div key={group.id} className="mb-1">
              <div className="px-3 pb-0.5 pt-1.5 font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground/50">
                {group.label}
              </div>
              {items.map((it) => {
                runningIdx += 1;
                const idx = runningIdx;
                const active = idx === highlight;
                return (
                  <button
                    key={it.id}
                    type="button"
                    disabled={Boolean(it.disabledReason)}
                    onMouseEnter={() => onHighlightChange(idx)}
                    onMouseDown={(e) => {
                      // Use mousedown so we beat the input's blur, which
                      // otherwise tears the popover down before click fires.
                      e.preventDefault();
                      if (it.disabledReason) return;
                      onPick(idx);
                    }}
                    title={it.disabledReason ?? it.hint}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 px-3 py-1 text-left text-[13px] transition-colors focus-visible:outline-none",
                      active ? "bg-white/[0.10]" : "",
                      it.destructive ? "text-rose-300" : "text-foreground",
                      it.disabledReason && "cursor-not-allowed opacity-45",
                    )}
                  >
                    <span className="truncate">{it.label}</span>
                    {it.disabledReason || it.hint ? (
                      <span className="ml-2 shrink-0 font-mono text-[10px] text-muted-foreground/50">
                        {it.disabledReason ?? it.hint}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// Subsequence matcher — every char of query appears in target in order.
// Same as ActionsMenu's; copied so this file stays standalone.
function matches(query: string, target: string): boolean {
  const t = target.toLowerCase();
  let i = 0;
  for (const ch of query) {
    const found = t.indexOf(ch, i);
    if (found === -1) return false;
    i = found + 1;
  }
  return true;
}
