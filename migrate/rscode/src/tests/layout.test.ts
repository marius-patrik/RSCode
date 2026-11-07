import { expect, test } from "bun:test";
import { contextMenuPosition } from "@/client/ActionsMenu";
import {
  addPaneToLayoutTab,
  canvasDeltaToWorld,
  insertPaneIntoLayout,
  leafPaneIds,
  panCanvasViewport,
  removePaneFromLayout,
  splitLayoutAt,
  zoomCanvasViewport,
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

test("context menu placement stays inside narrow and desktop viewports", () => {
  expect(contextMenuPosition(390, 850, 390, 844)).toEqual({ left: 102, top: 356 });
  expect(contextMenuPosition(-100, -100, 200, 240)).toEqual({ left: 8, top: 8 });
  expect(contextMenuPosition(1180, 760, 1200, 800)).toEqual({ left: 912, top: 312 });
});

function leaf(paneId: string): Extract<TiledLayoutNode, { type: "leaf" }> {
  return { type: "leaf", paneId, paneIds: [paneId], activePaneId: paneId };
}

test("canvas zoom preserves the world point beneath the cursor", () => {
  const viewport = { x: 100, y: -20, zoom: 1 };
  const result = zoomCanvasViewport(viewport, 400, 200, 2);
  expect(result).toEqual({ x: -200, y: -240, zoom: 2 });
  expect((400 - result.x) / result.zoom).toBe((400 - viewport.x) / viewport.zoom);
  expect((200 - result.y) / result.zoom).toBe((200 - viewport.y) / viewport.zoom);
});

test("canvas pan and pane drag use independent screen and world coordinates", () => {
  expect(panCanvasViewport({ x: 10, y: 20, zoom: 2 }, -30, 50)).toEqual({ x: -20, y: 70, zoom: 2 });
  expect(canvasDeltaToWorld(100, 2)).toBe(50);
  expect(canvasDeltaToWorld(-80, 0.5)).toBe(-160);
});

test("canvas zoom clamps to usable limits", () => {
  expect(zoomCanvasViewport({ x: 0, y: 0, zoom: 1 }, 0, 0, 100).zoom).toBe(4);
  expect(zoomCanvasViewport({ x: 0, y: 0, zoom: 1 }, 0, 0, 0.001).zoom).toBe(0.25);
});
