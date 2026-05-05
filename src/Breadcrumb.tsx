import { cn } from "@/utils.ts";
import { ChevronRight } from "lucide-react";
import { Fragment } from "react";

// Liquid-glass breadcrumb pinned to the bottom-left of the canvas.
// Shows the current drilled-into filesystem address;
// each segment is clickable to jump back to that prefix.

export type BreadcrumbSegment = {
  id: string;
  label: string;
  onClick?: () => void;
};

export function Breadcrumb({ segments }: { segments: BreadcrumbSegment[] }) {
  return (
    <div className="pointer-events-auto fixed left-5 bottom-20 z-30 flex items-center gap-1 rounded-full glass-heavy border border-white/10 px-3 py-1.5 backdrop-blur-xl shadow-lg">
      {segments.map((s, i) => (
        <Fragment key={s.id}>
          {i > 0 ? <ChevronRight className="h-3 w-3 text-muted-foreground/40" /> : null}
          <button
            type="button"
            disabled={!s.onClick}
            onClick={s.onClick}
            className={cn(
              "rounded-full font-mono text-[11px] uppercase tracking-[0.16em] transition-colors focus-visible:outline-none focus-visible:text-foreground",
              s.onClick
                ? "text-muted-foreground hover:text-foreground"
                : "text-foreground",
            )}
          >
            {s.label}
          </button>
        </Fragment>
      ))}
    </div>
  );
}
