import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lookupHandler } from "@/server/api";
import type { AppContext } from "@/server/api";
import { CanvasStore } from "@/server/store";
import type { Workspace } from "@/shared/schema";

let canvasHome = "";

beforeEach(async () => {
  canvasHome = await mkdtemp(join(tmpdir(), "canvas-store-"));
  process.env.CANVAS_HOME = canvasHome;
});

afterEach(async () => {
  process.env.CANVAS_HOME = undefined;
  if (canvasHome) await rm(canvasHome, { recursive: true, force: true });
});

test("creates and persists an initial workspace", async () => {
  const store = new CanvasStore();
  await store.ensureInitialized();

  const list = await store.listWorkspaces();
  expect(list.workspaces).toHaveLength(1);
  expect(list.workspaces[0]?.label).toBe("Workspace 1");
  expect(list.workspaces[0]?.rootPath).toBe(process.cwd());

  const active = await store.getActiveWorkspace();
  expect(active.id).toBe(list.activeWorkspaceId);
  expect(active.rootPath).toBe(process.cwd());
  expect(active.activeView).toBe("panes");
  expect(active.panes[0]?.type).toBe("explorer");
  expect(active.tiledLayout?.type).toBe("leaf");
});

test("migrates legacy sessions to workspaces and discards graph data", async () => {
  const sessionsDir = join(canvasHome, "sessions");
  await mkdir(sessionsDir, { recursive: true });
  await writeFile(
    join(sessionsDir, "index.json"),
    JSON.stringify({
      version: 1,
      activeSessionId: "legacy",
      sessionIds: ["legacy"],
    }),
  );
  await writeFile(
    join(sessionsDir, "legacy.json"),
    JSON.stringify({
      id: "legacy",
      label: "Legacy Canvas",
      rootPath: process.cwd(),
      address: process.cwd(),
      openPanels: [
        {
          id: "editor:legacy",
          kind: "editor",
          title: "legacy.txt",
          path: join(process.cwd(), "legacy.txt"),
          draftBody: "draft",
          dirty: true,
          rect: { x: 10, y: 20, width: 500, height: 300 },
          z: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      graph: {
        version: 1,
        nodes: [{ id: "graph-fs-read-legacy", kind: "fs.read" }],
        edges: [],
      },
      viewport: { x: 0, y: 0, zoom: 1 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastOpenedAt: new Date().toISOString(),
    }),
  );

  const store = new CanvasStore();
  await store.ensureInitialized();
  const active = await store.getActiveWorkspace();
  expect(active.label).toBe("Legacy Canvas");
  expect(active.panes.some((pane) => pane.type === "editor")).toBe(true);
  expect("graph" in (active as unknown as Record<string, unknown>)).toBe(false);
});

test("switches, saves, and closes workspaces", async () => {
  const store = new CanvasStore();
  await store.ensureInitialized();
  const created = await store.createWorkspace({ label: "Work", rootPath: "/" });
  expect((await store.listWorkspaces()).activeWorkspaceId).toBe(created.id);

  const saved = await store.saveWorkspace({
    ...created,
    activeView: "canvas",
    canvasViewport: { x: 20, y: 30, zoom: 1.2 },
  });
  expect(saved.activeView).toBe("canvas");
  expect((await store.getWorkspace(created.id)).canvasViewport.x).toBe(20);

  const closed = await store.closeWorkspace(created.id);
  expect(closed.workspaces.some((workspace) => workspace.id === created.id)).toBe(false);
  expect(closed.activeWorkspaceId).toBeTruthy();
});

test("workspace API handlers expose list, create, save, and close contracts", async () => {
  const store = new CanvasStore();
  await store.ensureInitialized();
  const ctx: AppContext = { store };

  const create = lookupHandler("workspace.create");
  const list = lookupHandler("workspace.list");
  const save = lookupHandler("workspace.save");
  const close = lookupHandler("workspace.close");
  expect(create).toBeFunction();
  expect(list).toBeFunction();
  expect(save).toBeFunction();
  expect(close).toBeFunction();

  const created = (await create?.(ctx, { label: "API Workspace", rootPath: "/" })) as { workspace: Workspace };
  expect(created.workspace.label).toBe("API Workspace");

  const saved = (await save?.(ctx, { workspace: { ...created.workspace, activeView: "canvas" } })) as {
    workspace: Workspace;
  };
  expect(saved.workspace.activeView).toBe("canvas");

  const listed = (await list?.(ctx, undefined)) as Awaited<ReturnType<CanvasStore["listWorkspaces"]>>;
  expect(listed.workspaces.length).toBeGreaterThanOrEqual(2);

  const closed = (await close?.(ctx, { id: created.workspace.id })) as Awaited<
    ReturnType<CanvasStore["closeWorkspace"]>
  >;
  expect(closed.workspaces.some((workspace) => workspace.id === created.workspace.id)).toBe(false);
});

test("discovers git repositories and returns readonly status and diff", async () => {
  const repo = await mkdtemp(join(tmpdir(), "canvas-git-"));
  try {
    await run("git", ["init"], repo);
    await run("git", ["config", "user.email", "test@example.com"], repo);
    await run("git", ["config", "user.name", "Test User"], repo);
    await writeFile(join(repo, "file.txt"), "one\n");
    await run("git", ["add", "file.txt"], repo);
    await run("git", ["commit", "-m", "initial"], repo);
    await writeFile(join(repo, "file.txt"), "two\n");

    const store = new CanvasStore();
    await store.ensureInitialized();
    const repositories = await store.listGitRepositories(repo);
    expect(repositories[0]?.rootPath).toBe(repo);

    const status = await store.getGitStatus(repo);
    expect(status.clean).toBe(false);
    expect(status.files[0]?.path).toBe("file.txt");

    const diff = await store.getGitDiff(repo, "file.txt");
    expect(diff.diff).toContain("-one");
    expect(diff.diff).toContain("+two");
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("browser sessions persist pane navigation state", async () => {
  const store = new CanvasStore();
  await store.ensureInitialized();
  const workspace = await store.getActiveWorkspace();
  const now = new Date().toISOString();
  const browserPane = {
    id: "browser:test",
    type: "browser" as const,
    title: "Browser",
    url: "about:blank",
    history: ["about:blank"],
    historyIndex: 0,
    sessionId: "browser:test:session",
    placement: "tiled" as const,
    rect: { x: 0, y: 0, width: 800, height: 500 },
    z: 1,
    createdAt: now,
    updatedAt: now,
  };
  await store.saveWorkspace({
    ...workspace,
    panes: [...workspace.panes, browserPane],
    tiledLayout: {
      type: "split",
      id: "split:browser",
      direction: "horizontal",
      ratio: 0.5,
      first: workspace.tiledLayout ?? { type: "leaf", paneId: workspace.panes[0]!.id },
      second: { type: "leaf", paneId: browserPane.id },
    },
  });

  const navigated = await store.navigateBrowserPane({
    workspaceId: workspace.id,
    paneId: browserPane.id,
    url: "data:text/html,<h1>Canvas</h1>",
  });
  expect(navigated.browser.url).toContain("data:text/html");
  expect(navigated.browser.profilePath).toContain(encodeURIComponent(workspace.id));
});

async function run(command: string, args: string[], cwd: string) {
  const proc = Bun.spawn([command, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  if (exitCode !== 0) throw new Error(`${command} ${args.join(" ")} failed: ${stdout}${stderr}`);
}
