import { expect, test } from "bun:test";
import { DEFAULT_FOLDER_LIMIT, layoutVisibleTree } from "@/server/layout";
import type { FsEntry } from "@/shared/schema";

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
