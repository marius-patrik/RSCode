import { cn } from "@/shared/utils";
import { ChevronRight } from "lucide-react";
import { Fragment } from "react";

// Filesystem breadcrumb pinned above the quick bar.

export type BreadcrumbSegment = {
  id: string;
  label: string;
  onClick?: () => void;
};

export function Breadcrumb({ segments }: { segments: BreadcrumbSegment[] }) {
  return (
    <div className="pointer-events-auto fixed left-5 bottom-20 z-30 flex items-center gap-1 rounded-lg border border-border bg-[var(--panel-bg)] px-3 py-1.5 shadow-lg backdrop-blur-xl">
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
