import type { PaneRect, TiledLayoutNode } from "@/shared/schema";

const MIN_PANE_WIDTH = 300;
const MIN_PANE_HEIGHT = 220;

export function defaultPaneRect(index: number): PaneRect {
  return {
    x: 80 + (index % 5) * 34,
    y: 58 + (index % 5) * 30,
    width: 760,
    height: 480,
  };
}

export function clampPaneRect(rect: PaneRect): PaneRect {
  const maxWidth = Math.max(MIN_PANE_WIDTH, window.innerWidth - 80);
  const maxHeight = Math.max(MIN_PANE_HEIGHT, window.innerHeight - 96);
  const width = Math.min(Math.max(MIN_PANE_WIDTH, rect.width), maxWidth);
  const height = Math.min(Math.max(MIN_PANE_HEIGHT, rect.height), maxHeight);
  return {
    width,
    height,
    x: Math.min(Math.max(8, rect.x), Math.max(8, window.innerWidth - width - 16)),
    y: Math.min(Math.max(8, rect.y), Math.max(8, window.innerHeight - height - 16)),
  };
}

export function offsetDropRect(target: PaneRect, source: PaneRect): PaneRect {
  return clampPaneRect({
    x: target.x + 28,
    y: target.y + 28,
    width: source.width,
    height: source.height,
  });
}

export function maxPaneZ<T extends { z: number }>(panes: T[]): number {
  return panes.reduce((max, pane) => Math.max(max, pane.z), 0);
}

export function insertPaneIntoLayout(
  layout: TiledLayoutNode | null,
  activePaneId: string | null,
  paneId: string,
): TiledLayoutNode {
  if (!layout) return leafForPane(paneId);
  if (layoutContains(layout, paneId)) return layout;
  const targetPaneId = activePaneId && layoutContains(layout, activePaneId) ? activePaneId : firstPaneIdInLayout(layout);
  return splitLayoutAt(layout, targetPaneId, paneId, "horizontal");
}

export function splitLayoutAt(
  layout: TiledLayoutNode | null,
  targetPaneId: string | null,
  newPaneId: string,
  direction: "horizontal" | "vertical",
): TiledLayoutNode {
  if (!layout) return leafForPane(newPaneId);
  if (!targetPaneId) {
    return {
      type: "split",
      id: `split:${newPaneId}:${Date.now().toString(36)}`,
      direction,
      ratio: 0.5,
      first: layout,
      second: leafForPane(newPaneId),
    };
  }
  if (layout.type === "leaf") {
    if (leafPaneIds(layout).includes(targetPaneId)) {
      return {
        type: "split",
        id: `split:${targetPaneId}:${newPaneId}:${Date.now().toString(36)}`,
        direction,
        ratio: 0.5,
        first: activateLayoutTab(layout, targetPaneId) ?? layout,
        second: leafForPane(newPaneId),
      };
    }
    return layout;
  }
  if (layoutContains(layout.first, targetPaneId)) {
    return {
      ...layout,
      first: splitLayoutAt(layout.first, targetPaneId, newPaneId, direction),
    };
  }
  if (layoutContains(layout.second, targetPaneId)) {
    return {
      ...layout,
      second: splitLayoutAt(layout.second, targetPaneId, newPaneId, direction),
    };
  }
  return {
    type: "split",
    id: `split:${newPaneId}:${Date.now().toString(36)}`,
    direction,
    ratio: 0.5,
    first: layout,
    second: leafForPane(newPaneId),
  };
}

export function removePaneFromLayout(layout: TiledLayoutNode | null, paneId: string): TiledLayoutNode | null {
  if (!layout) return null;
  if (layout.type === "leaf") {
    const remainingPaneIds = leafPaneIds(layout).filter((id) => id !== paneId);
    if (remainingPaneIds.length === 0) return null;
    const activePaneId = remainingPaneIds.includes(layout.activePaneId ?? layout.paneId)
      ? (layout.activePaneId ?? layout.paneId)
      : remainingPaneIds[0]!;
    return { type: "leaf", paneId: activePaneId, paneIds: remainingPaneIds, activePaneId };
  }
  const first = removePaneFromLayout(layout.first, paneId);
  const second = removePaneFromLayout(layout.second, paneId);
  if (first && second) return { ...layout, first, second };
  return first ?? second;
}

export function updateLayoutSplitRatio(
  layout: TiledLayoutNode | null,
  splitId: string,
  ratio: number,
): TiledLayoutNode | null {
  if (!layout) return null;
  if (layout.type === "leaf") return layout;
  if (layout.id === splitId) return { ...layout, ratio };
  return {
    ...layout,
    first: updateLayoutSplitRatio(layout.first, splitId, ratio) ?? layout.first,
    second: updateLayoutSplitRatio(layout.second, splitId, ratio) ?? layout.second,
  };
}

export function addPaneToLayoutTab(
  layout: TiledLayoutNode | null,
  targetPaneId: string,
  newPaneId: string,
): TiledLayoutNode {
  if (!layout) return leafForPane(newPaneId);
  if (layout.type === "leaf") {
    if (!leafPaneIds(layout).includes(targetPaneId)) return insertPaneIntoLayout(layout, targetPaneId, newPaneId);
    const paneIds = Array.from(new Set([...leafPaneIds(layout), newPaneId]));
    return { type: "leaf", paneId: newPaneId, paneIds, activePaneId: newPaneId };
  }
  if (layoutContains(layout.first, targetPaneId)) {
    return { ...layout, first: addPaneToLayoutTab(layout.first, targetPaneId, newPaneId) };
  }
  if (layoutContains(layout.second, targetPaneId)) {
    return { ...layout, second: addPaneToLayoutTab(layout.second, targetPaneId, newPaneId) };
  }
  return insertPaneIntoLayout(layout, targetPaneId, newPaneId);
}

export function activateLayoutTab(layout: TiledLayoutNode | null, paneId: string): TiledLayoutNode | null {
  if (!layout) return null;
  if (layout.type === "leaf") {
    const paneIds = leafPaneIds(layout);
    if (!paneIds.includes(paneId)) return layout;
    return { type: "leaf", paneId, paneIds, activePaneId: paneId };
  }
  return {
    ...layout,
    first: activateLayoutTab(layout.first, paneId) ?? layout.first,
    second: activateLayoutTab(layout.second, paneId) ?? layout.second,
  };
}

export function leafPaneIds(layout: Extract<TiledLayoutNode, { type: "leaf" }>): string[] {
  const paneIds = layout.paneIds && layout.paneIds.length > 0 ? layout.paneIds : [layout.paneId];
  return Array.from(new Set([...paneIds, layout.paneId]));
}

export function firstPaneIdInLayout(layout: TiledLayoutNode | null): string | null {
  if (!layout) return null;
  if (layout.type === "leaf") return layout.activePaneId ?? layout.paneId;
  return firstPaneIdInLayout(layout.first) ?? firstPaneIdInLayout(layout.second);
}

function leafForPane(paneId: string): TiledLayoutNode {
  return { type: "leaf", paneId, paneIds: [paneId], activePaneId: paneId };
}

function layoutContains(layout: TiledLayoutNode, paneId: string): boolean {
  if (layout.type === "leaf") return leafPaneIds(layout).includes(paneId);
  return layoutContains(layout.first, paneId) || layoutContains(layout.second, paneId);
}
