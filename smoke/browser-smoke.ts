import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../src/server.ts";

let canvasHome = "";
let port = 0;
let server: Awaited<ReturnType<typeof startServer>> | null = null;

beforeAll(async () => {
  canvasHome = await mkdtemp(join(tmpdir(), "canvas-smoke-"));
  port = 5600 + Math.floor(Math.random() * 1000);
  process.env.CANVAS_HOME = canvasHome;
  process.env.CANVAS_PORT = String(port);
  server = await startServer();
});

afterAll(async () => {
  server?.stop(true);
  process.env.CANVAS_HOME = undefined;
  process.env.CANVAS_PORT = undefined;
  if (canvasHome) await rm(canvasHome, { recursive: true, force: true });
});

test("launches web app and exercises workspace, filesystem, git, and browser APIs", async () => {
  const baseUrl = `http://127.0.0.1:${port}`;
  const html = await fetch(`${baseUrl}/`).then((response) => response.text());
  expect(html.toLowerCase()).toContain("<!doctype html>");

  const list = await post<{ activeWorkspaceId: string; workspaces: Array<{ id: string; label: string }> }>(
    baseUrl,
    "workspace.list",
  );
  expect(list.workspaces).toHaveLength(1);

  const second = await post<{ workspace: { id: string; label: string; panes: Array<{ id: string }> } }>(baseUrl, "workspace.create", {
    label: "Smoke 2",
    rootPath: process.cwd(),
  });
  expect(second.workspace.label).toBe("Smoke 2");

  const active = await post<{ workspace: { id: string } }>(baseUrl, "workspace.setActive", { id: second.workspace.id });
  expect(active.workspace.id).toBe(second.workspace.id);

  const tree = await post<{ entries: Array<{ name: string; path: string; kind: string }> }>(baseUrl, "fs.tree", {
    path: process.cwd(),
  });
  expect(tree.entries.length).toBeGreaterThan(0);

  const repos = await post<{ repositories: Array<{ rootPath: string }> }>(baseUrl, "git.repositories", {
    rootPath: process.cwd(),
  });
  expect(Array.isArray(repos.repositories)).toBe(true);

  const now = new Date().toISOString();
  const browserPane = {
    id: "browser:smoke",
    type: "browser",
    title: "Smoke Browser",
    url: "about:blank",
    history: ["about:blank"],
    historyIndex: 0,
    sessionId: "browser:smoke:session",
    placement: "tiled",
    rect: { x: 0, y: 0, width: 800, height: 500 },
    z: 2,
    createdAt: now,
    updatedAt: now,
  };
  const withBrowser = await post<{ workspace: { id: string } }>(baseUrl, "workspace.save", {
    workspace: {
      ...second.workspace,
      panes: [...second.workspace.panes, browserPane],
      tiledLayout: {
        type: "split",
        id: "split:smoke",
        direction: "horizontal",
        ratio: 0.5,
        first: { type: "leaf", paneId: second.workspace.panes[0]?.id ?? "missing" },
        second: { type: "leaf", paneId: browserPane.id },
      },
    },
  });
  expect(withBrowser.workspace.id).toBe(second.workspace.id);

  const browser = await post<{ browser: { url: string; profilePath: string } }>(baseUrl, "browser.navigate", {
    workspaceId: second.workspace.id,
    paneId: browserPane.id,
    url: "data:text/html,<title>Smoke</title><h1>Canvas Browser</h1>",
  });
  expect(browser.browser.url).toContain("data:text/html");
  expect(browser.browser.profilePath).toContain(encodeURIComponent(second.workspace.id));
});

async function post<T>(baseUrl: string, path: string, input?: unknown): Promise<T> {
  const response = await fetch(`${baseUrl}/api/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input ?? null),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path}: ${response.status} ${text}`);
  return JSON.parse(text) as T;
}
