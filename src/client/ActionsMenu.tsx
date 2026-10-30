import { matchesSubsequence } from "@/client/search";
import { cn } from "@/shared/utils";
import { useEffect, useMemo, useRef, useState } from "react";

export type ActionItem = {
  id: string;
  label: string;
  hint?: string;
  onSelect: () => void;
  destructive?: boolean;
  disabledReason?: string | null;
};

export type ActionGroup = {
  id: string;
  label: string;
  items: ActionItem[];
};

export function ActionsMenu({
  x,
  y,
  title,
  groups,
  onClose,
}: {
  x: number;
  y: number;
  title: string;
  groups: ActionGroup[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Flatten visible items (post-filter) for keyboard nav. Empty groups vanish.
  const visible = useMemo(() => {
    const filterText = query.trim().toLowerCase();
    const flat: Array<{ group: ActionGroup; item: ActionItem }> = [];
    for (const g of groups) {
      for (const it of g.items) {
        if (!filterText || matchesSubsequence(filterText, `${g.label} ${it.label} ${it.hint ?? ""}`)) {
          flat.push({ group: g, item: it });
        }
      }
    }
    return flat;
  }, [groups, query]);

  useEffect(() => {
    if (highlight >= visible.length) setHighlight(0);
  }, [visible.length, highlight]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function pick(idx: number) {
    const entry = visible[idx];
    if (!entry) return;
    if (entry.item.disabledReason) return;
    entry.item.onSelect();
    onClose();
  }

  // Group the visible items for rendering (in original group order).
  const grouped: Array<{ group: ActionGroup; items: ActionItem[] }> = [];
  for (const g of groups) {
    const items = visible.filter((v) => v.group.id === g.id).map((v) => v.item);
    if (items.length > 0) grouped.push({ group: g, items });
  }

  // The popover positions itself so it doesn't run off-screen on the right
  // or bottom; clamp inside the viewport.
  const winW = typeof window !== "undefined" ? window.innerWidth : 1200;
  const winH = typeof window !== "undefined" ? window.innerHeight : 800;
  const { left, top } = contextMenuPosition(x, y, winW, winH);

  // Track running index across groups so highlight points to the right item.
  let runningIdx = -1;

  return (
    <div
      data-context-menu
      role="group"
      aria-label={title}
      style={{ left, top }}
      className="fixed z-50 flex w-[min(280px,calc(100vw-16px))] max-h-[min(480px,calc(100vh-16px))] flex-col overflow-hidden rounded-lg border border-border bg-[var(--panel-bg)] shadow-xl backdrop-blur-xl"
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="flex items-center gap-1.5 border-b border-border bg-secondary px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/80">
        {title}
      </div>
      <input
        ref={inputRef}
        aria-label="Filter actions"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setHighlight(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey)) {
            e.preventDefault();
            setHighlight((h) => (visible.length === 0 ? 0 : (h + 1) % visible.length));
          } else if (e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey)) {
            e.preventDefault();
            setHighlight((h) => (visible.length === 0 ? 0 : (h - 1 + visible.length) % visible.length));
          } else if (e.key === "Enter") {
            e.preventDefault();
            pick(highlight);
          } else if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
        placeholder="filter…"
        spellCheck={false}
        className="w-full border-b border-border bg-transparent px-3 py-2 font-mono text-[12px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
      />
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
                    onMouseEnter={() => setHighlight(idx)}
                    onClick={() => pick(idx)}
                    title={it.disabledReason ?? it.hint}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 px-3 py-1 text-left text-[13px] transition-colors focus-visible:outline-none",
                      active ? "bg-surface-hover" : "",
                      "text-foreground",
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

/** Keep the context menu fully visible on small displays and at screen edges. */
export function contextMenuPosition(x: number, y: number, viewportWidth: number, viewportHeight: number) {
  const margin = 8;
  const width = Math.min(280, Math.max(0, viewportWidth - margin * 2));
  const height = Math.min(480, Math.max(0, viewportHeight - margin * 2));
  return {
    left: Math.max(margin, Math.min(x, viewportWidth - width - margin)),
    top: Math.max(margin, Math.min(y, viewportHeight - height - margin)),
  };
}
