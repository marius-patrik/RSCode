import { expect, test } from "bun:test";
import {
  addPaneToLayoutTab,
  insertPaneIntoLayout,
  leafPaneIds,
  removePaneFromLayout,
  splitLayoutAt,
} from "@/client/paneLayout";
import type { TiledLayoutNode } from "@/shared/schema";

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

test("pane insertion falls back when active pane is not in the tiled layout", () => {
  const next = insertPaneIntoLayout(leaf("visible"), "canvas-only", "new-pane");

  expect(next.type).toBe("split");
  if (next.type !== "split") return;
  expect(next.first.type).toBe("leaf");
  expect(next.second.type).toBe("leaf");
  if (next.first.type !== "leaf" || next.second.type !== "leaf") return;
  expect(leafPaneIds(next.first)).toEqual(["visible"]);
  expect(leafPaneIds(next.second)).toEqual(["new-pane"]);
});

test("tab insertion stays visible when requested target is not tiled", () => {
  const next = addPaneToLayoutTab(leaf("visible"), "floating-only", "new-tab");

  expect(next.type).toBe("split");
  if (next.type !== "split") return;
  expect(next.first.type).toBe("leaf");
  expect(next.second.type).toBe("leaf");
  if (next.first.type !== "leaf" || next.second.type !== "leaf") return;
  expect(leafPaneIds(next.first)).toEqual(["visible"]);
  expect(leafPaneIds(next.second)).toEqual(["new-tab"]);
});

function leaf(paneId: string): Extract<TiledLayoutNode, { type: "leaf" }> {
  return { type: "leaf", paneId, paneIds: [paneId], activePaneId: paneId };
}
