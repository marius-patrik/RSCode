import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lookupHandler } from "@/api.ts";
import type { AppContext } from "@/api.ts";
import type { CanvasSession } from "@/schema.ts";
import { CanvasStore, validateGraph } from "@/store.ts";

let canvasHome = "";

beforeEach(async () => {
  canvasHome = await mkdtemp(join(tmpdir(), "canvas-store-"));
  process.env.CANVAS_HOME = canvasHome;
});

afterEach(async () => {
  process.env.CANVAS_HOME = undefined;
  if (canvasHome) await rm(canvasHome, { recursive: true, force: true });
});

test("creates and persists an initial canvas session", async () => {
  const store = new CanvasStore();
  await store.ensureInitialized();

  const list = await store.listSessions();
  expect(list.sessions).toHaveLength(1);
  expect(list.sessions[0]?.label).toBe("Canvas 1");
  expect(list.sessions[0]?.rootPath).toBe(process.cwd());

  const active = await store.getActiveSession();
  expect(active.id).toBe(list.activeSessionId);
  expect(active.address).toBe(process.cwd());
  expect(active.openPanels).toEqual([]);
});

test("imports legacy graph into first session when no sessions exist", async () => {
  await writeFile(
    join(canvasHome, "graph.json"),
    JSON.stringify({
      version: 1,
      nodes: [
        {
          id: "graph-fs-read-legacy",
          kind: "fs.read",
          position: { x: 10, y: 20 },
          config: { path: "/tmp/example.txt" },
        },
      ],
      edges: [],
      updatedAt: new Date().toISOString(),
    }),
  );

  const store = new CanvasStore();
  await store.ensureInitialized();
  const active = await store.getActiveSession();
  expect(active.graph.nodes).toHaveLength(1);
  expect(active.graph.nodes[0]?.id).toBe("graph-fs-read-legacy");
});

test("switches, saves, and closes sessions", async () => {
  const store = new CanvasStore();
  await store.ensureInitialized();
  const created = await store.createSession({ label: "Work", rootPath: "/" });
  expect((await store.listSessions()).activeSessionId).toBe(created.id);

  const saved = await store.saveSession({
    ...created,
    address: "/tmp",
    expandedPaths: ["/tmp"],
  });
  expect(saved.address).toBe("/tmp");
  expect((await store.getSession(created.id)).expandedPaths).toEqual(["/tmp"]);

  const closed = await store.closeSession(created.id);
  expect(closed.sessions.some((session) => session.id === created.id)).toBe(false);
  expect(closed.activeSessionId).toBeTruthy();
});

test("session API handlers expose list, create, save, and close contracts", async () => {
  const store = new CanvasStore();
  await store.ensureInitialized();
  const ctx: AppContext = { store };

  const create = lookupHandler("session.create");
  const list = lookupHandler("session.list");
  const save = lookupHandler("session.save");
  const close = lookupHandler("session.close");
  expect(create).toBeFunction();
  expect(list).toBeFunction();
  expect(save).toBeFunction();
  expect(close).toBeFunction();

  const created = (await create?.(ctx, { label: "API Canvas", rootPath: "/" })) as { session: CanvasSession };
  expect(created.session.label).toBe("API Canvas");

  const saved = (await save?.(ctx, { session: { ...created.session, address: "/tmp" } })) as {
    session: CanvasSession;
  };
  expect(saved.session.address).toBe("/tmp");

  const listed = (await list?.(ctx, undefined)) as Awaited<ReturnType<CanvasStore["listSessions"]>>;
  expect(listed.sessions.length).toBeGreaterThanOrEqual(2);

  const closed = (await close?.(ctx, { id: created.session.id })) as Awaited<
    ReturnType<CanvasStore["closeSession"]>
  >;
  expect(closed.sessions.some((session) => session.id === created.session.id)).toBe(false);
});

test("graph validation catches required config before execution", () => {
  const issues = validateGraph({
    version: 1,
    nodes: [
      {
        id: "graph-terminal-run-empty",
        kind: "terminal.run",
        position: { x: 0, y: 0 },
        config: {},
      },
    ],
    edges: [],
    updatedAt: new Date().toISOString(),
  });

  expect(issues.map((issue) => issue.message)).toContain("missing command");
  expect(issues.map((issue) => issue.message)).toContain("missing cwd");
});
