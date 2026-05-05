import { expect, test } from "bun:test";
import { DEFAULT_FOLDER_LIMIT, layoutVisibleTree } from "@/client/layout";
import { addPaneToLayoutTab, leafPaneIds, removePaneFromLayout, splitLayoutAt } from "@/client/paneLayout";
import type { FsEntry, TiledLayoutNode } from "@/shared/schema";

test("large expanded folders are capped and get a load-more node", () => {
  const root = "/workspace";
  const large = "/workspace/large";
  const entries = new Map<string, FsEntry[]>([
    [root, [{ kind: "dir", name: "large", path: large }]],
    [
      large,
      Array.from({ length: DEFAULT_FOLDER_LIMIT + 5 }, (_, index) => ({
        kind: "file" as const,
        name: `file-${index}.txt`,
        path: `${large}/file-${index}.txt`,
      })),
    ],
  ]);

  const layout = layoutVisibleTree({
    address: root,
    fileTrees: entries,
    expandedPaths: new Set([large]),
  });

  expect(layout.nodes.filter((node) => node.type === "entry")).toHaveLength(DEFAULT_FOLDER_LIMIT + 1);
  const more = layout.nodes.find((node) => node.type === "more");
  expect(more?.type).toBe("more");
  expect(more?.hidden).toBe(5);
});

test("nested tree layout reserves vertical space for expanded children", () => {
  const root = "/workspace";
  const a = "/workspace/a";
  const b = "/workspace/b";
  const entries = new Map<string, FsEntry[]>([
    [
      root,
      [
        { kind: "dir", name: "a", path: a },
        { kind: "dir", name: "b", path: b },
      ],
    ],
    [
      a,
      [
        { kind: "file", name: "one.txt", path: `${a}/one.txt` },
        { kind: "file", name: "two.txt", path: `${a}/two.txt` },
      ],
    ],
  ]);

  const layout = layoutVisibleTree({
    address: root,
    fileTrees: entries,
    expandedPaths: new Set([a]),
  });
  const aNode = layout.nodes.find((node) => node.id === `tree:${a}`);
  const bNode = layout.nodes.find((node) => node.id === `tree:${b}`);

  expect(aNode?.position.y).toBeLessThan(bNode?.position.y ?? 0);
  expect((bNode?.position.y ?? 0) - (aNode?.position.y ?? 0)).toBeGreaterThan(120);
});

test("new pane tabs stay in the target tiled leaf", () => {
  const layout = splitLayoutAt(leaf("left"), "left", "right", "horizontal");
  const next = addPaneToLayoutTab(layout, "left", "left:tab");

  expect(next.type).toBe("split");
  if (next.type !== "split") return;
  expect(next.first.type).toBe("leaf");
  expect(next.second.type).toBe("leaf");
  if (next.first.type !== "leaf" || next.second.type !== "leaf") return;
  expect(leafPaneIds(next.first)).toEqual(["left", "left:tab"]);
  expect(next.first.activePaneId).toBe("left:tab");
  expect(leafPaneIds(next.second)).toEqual(["right"]);
});

test("dragging a tab between tiled leaves moves it without adding a split", () => {
  const layout: TiledLayoutNode = {
    type: "split",
    id: "split:left:right",
    direction: "horizontal",
    ratio: 0.5,
    first: { type: "leaf", paneId: "left", paneIds: ["left", "left:tab"], activePaneId: "left:tab" },
    second: leaf("right"),
  };

  const removed = removePaneFromLayout(layout, "left:tab");
  const moved = addPaneToLayoutTab(removed, "right", "left:tab");

  expect(moved.type).toBe("split");
  if (moved.type !== "split") return;
  expect(moved.first.type).toBe("leaf");
  expect(moved.second.type).toBe("leaf");
  if (moved.first.type !== "leaf" || moved.second.type !== "leaf") return;
  expect(leafPaneIds(moved.first)).toEqual(["left"]);
  expect(leafPaneIds(moved.second)).toEqual(["right", "left:tab"]);
  expect(moved.second.activePaneId).toBe("left:tab");
});

function leaf(paneId: string): Extract<TiledLayoutNode, { type: "leaf" }> {
  return { type: "leaf", paneId, paneIds: [paneId], activePaneId: paneId };
}
