import { cn } from "@/utils.ts";
import { Crosshair, Maximize2, RefreshCw, Search } from "lucide-react";
import { motion } from "motion/react";

// Top-left icon-only toolbar: fit (f), focus selected (⇧f), refresh (r),
// search (/). Buttons emit semantic actions; `Canvas` owns the actual
// fitView / refresh / search wiring + the keyboard shortcuts.

export type ToolbarAction = "fit" | "focusSelected" | "refresh" | "search";

const BUTTONS: Array<{
  id: ToolbarAction;
  icon: typeof Maximize2;
  hint: string;
  shortcut: string;
}> = [
  { id: "fit", icon: Maximize2, hint: "Fit view", shortcut: "f" },
  { id: "focusSelected", icon: Crosshair, hint: "Focus selected", shortcut: "⇧f" },
  { id: "refresh", icon: RefreshCw, hint: "Refresh", shortcut: "r" },
  { id: "search", icon: Search, hint: "Search canvas", shortcut: "/" },
];

export function Toolbar({
  onAction,
  refreshing = false,
}: {
  onAction: (action: ToolbarAction) => void;
  refreshing?: boolean;
}) {
  return (
    <div className="pointer-events-auto fixed left-5 top-5 z-30 flex items-center gap-0.5 rounded-full glass-heavy border border-white/10 px-1 py-1 backdrop-blur-xl shadow-lg">
      {BUTTONS.map((b) => {
        const Icon = b.icon;
        const spinning = b.id === "refresh" && refreshing;
        return (
          <motion.button
            key={b.id}
            type="button"
            title={`${b.hint} (${b.shortcut})`}
            whileTap={{ scale: 0.94 }}
            onClick={() => onAction(b.id)}
            className={cn(
              "inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20",
            )}
          >
            <Icon className={cn("h-3.5 w-3.5", spinning && "animate-spin")} />
          </motion.button>
        );
      })}
    </div>
  );
}
