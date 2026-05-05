import type { FsEntry } from "@/schema.ts";

export const TREE_NODE_WIDTH = 240;
export const TREE_NODE_HEIGHT = 86;
export const TREE_COLUMN_GAP = 300;
export const TREE_ROW_GAP = 18;
export const DEFAULT_FOLDER_LIMIT = 36;

export type TreeLayoutNode =
  | {
      type: "entry";
      id: string;
      entry: FsEntry;
      position: { x: number; y: number };
      expanded: boolean;
      childCount: number | null;
    }
  | {
      type: "more";
      id: string;
      parentPath: string;
      position: { x: number; y: number };
      shown: number;
      hidden: number;
    };

export type TreeLayoutEdge = {
  id: string;
  source: string;
  target: string;
};

export type TreeLayout = {
  nodes: TreeLayoutNode[];
  edges: TreeLayoutEdge[];
  totalHeight: number;
};

export function layoutVisibleTree(args: {
  address: string;
  fileTrees: Map<string, FsEntry[]>;
  expandedPaths: Set<string>;
  folderLimits?: Map<string, number>;
  folderLimit?: number;
}): TreeLayout {
  const nodes: TreeLayoutNode[] = [];
  const edges: TreeLayoutEdge[] = [];
  const folderLimit = args.folderLimit ?? DEFAULT_FOLDER_LIMIT;

  function visibleChildren(path: string): FsEntry[] {
    const entries = args.fileTrees.get(path) ?? [];
    const limit = args.folderLimits?.get(path) ?? folderLimit;
    return entries.slice(0, Math.max(0, limit));
  }

  function measure(entry: FsEntry): number {
    if (entry.kind !== "dir" || !args.expandedPaths.has(entry.path)) return TREE_NODE_HEIGHT;
    const children = visibleChildren(entry.path);
    const all = args.fileTrees.get(entry.path) ?? [];
    const childHeights = children.map(measure);
    const moreHeight = all.length > children.length ? TREE_NODE_HEIGHT : 0;
    const childrenHeight =
      childHeights.reduce((sum, height) => sum + height, 0) +
      Math.max(0, childHeights.length - 1) * TREE_ROW_GAP +
      (moreHeight ? TREE_ROW_GAP + moreHeight : 0);
    return Math.max(TREE_NODE_HEIGHT, childrenHeight);
  }

  function place(entry: FsEntry, depth: number, top: number, parentId: string | null) {
    const id = treeNodeId(entry.path);
    const expanded = entry.kind === "dir" && args.expandedPaths.has(entry.path);
    const allChildren = entry.kind === "dir" ? (args.fileTrees.get(entry.path) ?? null) : null;
    const position = { x: 80 + depth * TREE_COLUMN_GAP, y: top };
    nodes.push({
      type: "entry",
      id,
      entry,
      position,
      expanded,
      childCount: allChildren?.length ?? null,
    });
    if (parentId) edges.push({ id: `${parentId}->${id}`, source: parentId, target: id });
    if (!expanded) return;

    const children = visibleChildren(entry.path);
    let childTop = top;
    for (const child of children) {
      place(child, depth + 1, childTop, id);
      childTop += measure(child) + TREE_ROW_GAP;
    }

    const all = args.fileTrees.get(entry.path) ?? [];
    if (all.length > children.length) {
      const moreId = moreNodeId(entry.path);
      nodes.push({
        type: "more",
        id: moreId,
        parentPath: entry.path,
        position: { x: 80 + (depth + 1) * TREE_COLUMN_GAP, y: childTop },
        shown: children.length,
        hidden: all.length - children.length,
      });
      edges.push({ id: `${id}->${moreId}`, source: id, target: moreId });
    }
  }

  let top = 98;
  for (const entry of args.fileTrees.get(args.address) ?? []) {
    place(entry, 0, top, null);
    top += measure(entry) + TREE_ROW_GAP;
  }

  return { nodes, edges, totalHeight: top };
}

export function treeNodeId(path: string): string {
  return `tree:${path}`;
}

export function moreNodeId(path: string): string {
  return `more:${path}`;
}

export function extractTreePath(id: string): string | null {
  const match = /^tree:(.*)$/.exec(id);
  return match?.[1] ?? null;
}

export function extractMorePath(id: string): string | null {
  const match = /^more:(.*)$/.exec(id);
  return match?.[1] ?? null;
}
