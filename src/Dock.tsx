import type { ActionGroup } from "@/ActionsMenu.tsx";
import { CommandPopover, flattenGroups } from "@/CommandPopover.tsx";
import type { CanvasSessionSummary } from "@/schema.ts";
import { cn } from "@/utils.ts";
import { Hammer, Pencil, Plus, X } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";

export function Dock({
  busy = false,
  sessions,
  activeSessionId,
  onSwitchSession,
  onCreateSession,
  onRenameSession,
  onCloseSession,
  commandQuery,
  onCommandQueryChange,
  commandGroups,
  onCommandSubmit,
  onCommandFocus,
  onCommandBlur,
}: {
  busy?: boolean;
  sessions: CanvasSessionSummary[];
  activeSessionId: string | null;
  onSwitchSession: (id: string) => void;
  onCreateSession: () => void;
  onRenameSession: (id: string) => void;
  onCloseSession: (id: string) => void;
  commandQuery: string;
  onCommandQueryChange: (next: string) => void;
  commandGroups: ActionGroup[];
  onCommandSubmit: (idx: number) => void;
  onCommandFocus?: () => void;
  onCommandBlur?: () => void;
}) {
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

  const popoverOpen = focused || commandQuery.trim().length > 0;
  const visibleCount = popoverOpen ? flattenGroups(commandQuery, commandGroups).length : 0;

  function submitTop() {
    if (visibleCount === 0) return;
    const idx = highlight < visibleCount ? highlight : 0;
    onCommandSubmit(idx);
    onCommandQueryChange("");
    setHighlight(0);
    inputRef.current?.blur();
  }

  return (
    <motion.div
      initial={{ y: 24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.28, ease: "easeOut" }}
      className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex justify-center"
    >
      <div className="pointer-events-auto relative flex w-[min(980px,calc(100vw-2rem))] flex-col">
        {popoverOpen ? (
          <CommandPopover
            query={commandQuery}
            groups={commandGroups}
            highlight={highlight}
            onHighlightChange={setHighlight}
            onPick={(idx) => {
              onCommandSubmit(idx);
              onCommandQueryChange("");
              setHighlight(0);
              inputRef.current?.blur();
            }}
          />
        ) : null}

        <div className="glass-heavy flex min-h-11 items-center gap-1 rounded-full border border-white/10 px-1 py-1 shadow-2xl backdrop-blur-xl">
          <div className="flex min-w-0 max-w-[48%] items-center gap-1 overflow-x-auto pr-1">
            {sessions.map((session) => {
              const active = session.id === activeSessionId;
              return (
                <div
                  key={session.id}
                  className={cn(
                    "group flex h-9 max-w-[180px] shrink-0 items-center gap-1 rounded-full border pl-2 pr-1",
                    active
                      ? "border-white/15 bg-white/[0.13] text-foreground"
                      : "border-transparent bg-white/[0.05] text-muted-foreground hover:text-foreground",
                  )}
                >
                  <button
                    type="button"
                    title={`${session.label} - ${session.address}`}
                    onClick={() => onSwitchSession(session.id)}
                    className="flex min-w-0 items-center gap-1.5"
                  >
                    <Hammer className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate text-xs">{session.label}</span>
                    {active && busy ? (
                      <span
                        aria-hidden
                        className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-yellow-400 shadow-[0_0_8px_3px_rgba(250,204,21,0.55)]"
                      />
                    ) : null}
                  </button>
                  {active ? (
                    <button
                      type="button"
                      title="Rename canvas"
                      onClick={() => onRenameSession(session.id)}
                      className="hidden h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-white/[0.08] hover:text-foreground group-hover:inline-flex"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  ) : null}
                  {sessions.length > 1 ? (
                    <button
                      type="button"
                      title="Close canvas"
                      onClick={() => onCloseSession(session.id)}
                      className="hidden h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-white/[0.08] hover:text-foreground group-hover:inline-flex"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  ) : null}
                </div>
              );
            })}
            <button
              type="button"
              title="New canvas"
              onClick={onCreateSession}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-muted-foreground transition-colors hover:bg-white/[0.12] hover:text-foreground"
            >
              <Plus className="h-4 w-4" />
            </button>
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
                if (visibleCount === 0) return;
                e.preventDefault();
                setHighlight((h) => (h + 1) % visibleCount);
              } else if (e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey)) {
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
            placeholder="› run a command"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent px-3 font-mono text-[12px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
          />
        </div>
      </div>
    </motion.div>
  );
}
