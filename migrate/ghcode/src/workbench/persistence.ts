import type { AppearanceMode } from "@/settings";
import type { PrincipalKey } from "@/workspace/identity";
import type {
  PersistedWorkbench,
  WorkbenchRootSizes,
  WorkbenchSurface,
  WorkbenchSurfaceState,
} from "./model";

// Unattributed v1/v2 layouts can contain private tabs or editor text; preserve but never restore.
const OWNED_LAYOUT_PREFIX = "ghcode-layout-owned-v1:";
const keyFor = (principal: PrincipalKey) =>
  `${OWNED_LAYOUT_PREFIX}${encodeURIComponent(principal)}`;

const DEFAULT_VISIBILITY: Record<WorkbenchSurface, boolean> = {
  primary: true,
  main: true,
  secondary: false,
  panel: true,
};

export const DEFAULT_ROOT_SIZES: WorkbenchRootSizes = {
  primary: 268,
  secondary: 268,
  panel: 190,
};

export function emptyPersistedWorkbench(theme: AppearanceMode): PersistedWorkbench {
  return {
    version: 2,
    theme,
    sizes: { ...DEFAULT_ROOT_SIZES },
    surfaces: {
      primary: { visible: true, layout: null },
      main: { visible: true, layout: null },
      secondary: { visible: false, layout: null },
      panel: { visible: true, layout: null },
    },
  };
}

function positiveSize(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function parsePersisted(raw: string | null, theme: AppearanceMode): PersistedWorkbench | null {
  if (!raw) return null;
  const fallback = emptyPersistedWorkbench(theme);
  try {
    const parsed = JSON.parse(raw) as {
      version?: number;
      theme?: unknown;
      sizes?: Partial<WorkbenchRootSizes>;
      surfaces?: Partial<Record<WorkbenchSurface, WorkbenchSurfaceState>>;
    };
    if (
      (parsed.version !== 1 && parsed.version !== 2) ||
      !parsed.surfaces ||
      typeof parsed.surfaces !== "object"
    )
      return null;
    const surfaces = { ...fallback.surfaces };
    for (const surface of Object.keys(surfaces) as WorkbenchSurface[]) {
      const candidate = parsed.surfaces[surface];
      if (!candidate || typeof candidate !== "object") continue;
      surfaces[surface] = {
        visible: surface === "main" ? true : (candidate.visible ?? DEFAULT_VISIBILITY[surface]),
        layout: candidate.layout ?? null,
      };
    }
    return {
      version: 2,
      theme:
        parsed.theme === "light" || parsed.theme === "dark" || parsed.theme === "oled"
          ? parsed.theme
          : theme,
      sizes: {
        primary: positiveSize(parsed.sizes?.primary, DEFAULT_ROOT_SIZES.primary),
        secondary: positiveSize(parsed.sizes?.secondary, DEFAULT_ROOT_SIZES.secondary),
        panel: positiveSize(parsed.sizes?.panel, DEFAULT_ROOT_SIZES.panel),
      },
      surfaces,
    };
  } catch {
    return null;
  }
}

export function loadWorkbench(theme: AppearanceMode, principal: PrincipalKey): PersistedWorkbench {
  return (
    parsePersisted(localStorage.getItem(keyFor(principal)), theme) ?? emptyPersistedWorkbench(theme)
  );
}

export function saveWorkbench(state: PersistedWorkbench, principal: PrincipalKey) {
  try {
    localStorage.setItem(keyFor(principal), JSON.stringify(state));
  } catch {
    // Layout persistence must not make the workbench unusable.
  }
}
