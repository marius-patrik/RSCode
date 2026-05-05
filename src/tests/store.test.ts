import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lookupHandler } from "@/server/api";
import type { AppContext } from "@/server/api";
import { CanvasStore } from "@/server/store";
import { DEFAULT_THEME_COLORS, DEFAULT_WORKSPACE_SETTINGS, type Workspace, workspaceSchema } from "@/shared/schema";

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
  expect(active.settings).toEqual(DEFAULT_WORKSPACE_SETTINGS);
  expect(active.panes[0]?.type).toBe("explorer");
  expect(active.tiledLayout?.type).toBe("leaf");
  if (active.tiledLayout?.type === "leaf") {
    expect(active.tiledLayout.paneIds).toEqual([active.panes[0]!.id]);
    expect(active.tiledLayout.activePaneId).toBe(active.panes[0]!.id);
  }
});

test("defaults missing workspace settings during schema parsing", () => {
  const now = new Date().toISOString();
  const parsed = workspaceSchema.parse({
    id: "workspace:missing-settings",
    label: "Missing Settings",
    rootPath: process.cwd(),
    activeView: "panes",
    panes: [],
    tiledLayout: null,
    canvasViewport: { x: 0, y: 0, zoom: 1 },
    activePaneId: null,
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
  });

  expect(parsed.settings).toEqual(DEFAULT_WORKSPACE_SETTINGS);
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

test("persists workspace settings and tabbed tiled leaves", async () => {
  const store = new CanvasStore();
  await store.ensureInitialized();
  const workspace = await store.getActiveWorkspace();
  const now = new Date().toISOString();
  const editorOne = {
    id: "editor:one",
    type: "editor" as const,
    title: "one.ts",
    filePath: join(process.cwd(), "one.ts"),
    draftBody: "const one = 1;\n",
    dirty: false,
    placement: "tiled" as const,
    rect: { x: 0, y: 0, width: 600, height: 400 },
    z: 1,
    createdAt: now,
    updatedAt: now,
  };
  const editorTwo = {
    ...editorOne,
    id: "editor:two",
    title: "two.ts",
    filePath: join(process.cwd(), "two.ts"),
    draftBody: "const two = 2;\n",
  };
  const explorerId = workspace.panes[0]!.id;
  const customTheme = {
    id: "custom:test",
    label: "Test Theme",
    mode: "light" as const,
    colors: {
      ...DEFAULT_THEME_COLORS.light,
      primary: "#2563eb",
      panelBg: "rgba(255, 255, 255, 0.82)",
    },
  };

  const saved = await store.saveWorkspace({
    ...workspace,
    settings: {
      theme: "custom:test",
      defaultView: "canvas",
      backgroundStyle: "dot",
      accentColor: "blue",
      customThemes: [customTheme],
      tabbedPanes: false,
    },
    panes: [...workspace.panes, editorOne, editorTwo],
    tiledLayout: {
      type: "leaf",
      paneId: editorTwo.id,
      paneIds: [explorerId, editorOne.id, editorTwo.id],
      activePaneId: editorTwo.id,
    },
    activePaneId: editorTwo.id,
  });

  expect(saved.settings).toEqual({
    theme: "custom:test",
    defaultView: "canvas",
    backgroundStyle: "dot",
    accentColor: "blue",
    customThemes: [customTheme],
    tabbedPanes: false,
  });
  expect(saved.tiledLayout?.type).toBe("leaf");
  if (saved.tiledLayout?.type === "leaf") {
    expect(saved.tiledLayout.paneIds).toEqual([explorerId, editorOne.id, editorTwo.id]);
    expect(saved.tiledLayout.activePaneId).toBe(editorTwo.id);
  }

  const pruned = await store.saveWorkspace({
    ...saved,
    panes: saved.panes.filter((pane) => pane.id !== editorTwo.id),
  });
  expect(pruned.tiledLayout?.type).toBe("leaf");
  if (pruned.tiledLayout?.type === "leaf") {
    expect(pruned.tiledLayout.paneIds).toEqual([explorerId, editorOne.id]);
    expect(pruned.tiledLayout.activePaneId).toBe(explorerId);
  }
});

test("persists settings panes as workspace pane state", async () => {
  const store = new CanvasStore();
  await store.ensureInitialized();
  const workspace = await store.getActiveWorkspace();
  const explorerId = workspace.panes[0]!.id;
  const now = new Date().toISOString();
  const settingsPane = {
    id: "settings:test",
    type: "settings" as const,
    title: "Settings",
    placement: "tiled" as const,
    rect: { x: 20, y: 30, width: 720, height: 480 },
    z: 2,
    createdAt: now,
    updatedAt: now,
  };

  const saved = await store.saveWorkspace({
    ...workspace,
    panes: [...workspace.panes, settingsPane],
    tiledLayout: {
      type: "leaf",
      paneId: settingsPane.id,
      paneIds: [explorerId, settingsPane.id],
      activePaneId: settingsPane.id,
    },
    activePaneId: settingsPane.id,
  });

  expect(saved.panes.some((pane) => pane.type === "settings")).toBe(true);
  expect((await store.getWorkspace(workspace.id)).panes.some((pane) => pane.type === "settings")).toBe(true);
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
