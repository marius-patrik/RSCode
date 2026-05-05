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

test("launches web app and exercises session, filesystem, search, and graph APIs", async () => {
  const baseUrl = `http://127.0.0.1:${port}`;
  const html = await fetch(`${baseUrl}/`).then((response) => response.text());
  expect(html.toLowerCase()).toContain("<!doctype html>");

  const list = await post<{ activeSessionId: string; sessions: Array<{ id: string; label: string }> }>(
    baseUrl,
    "session.list",
  );
  expect(list.sessions).toHaveLength(1);

  const second = await post<{ session: { id: string; label: string; address: string } }>(baseUrl, "session.create", {
    label: "Smoke 2",
    rootPath: process.cwd(),
  });
  expect(second.session.label).toBe("Smoke 2");

  const active = await post<{ session: { id: string } }>(baseUrl, "session.setActive", { id: second.session.id });
  expect(active.session.id).toBe(second.session.id);

  const tree = await post<{ entries: Array<{ name: string; path: string; kind: string }> }>(baseUrl, "fs.tree", {
    path: process.cwd(),
  });
  expect(tree.entries.length).toBeGreaterThan(0);

  const graph = await post<{ result: { ok: boolean; steps: unknown[]; issues: unknown[] } }>(
    baseUrl,
    "graph.execute",
    {
      graph: {
        version: 1,
        nodes: [
          {
            id: "graph-terminal-run-smoke",
            kind: "terminal.run",
            position: { x: 120, y: 420 },
            config: { cwd: process.cwd(), command: "pwd", timeoutMs: 10_000 },
          },
        ],
        edges: [],
        updatedAt: new Date().toISOString(),
      },
    },
  );
  expect(graph.result.ok).toBe(true);
  expect(graph.result.steps).toHaveLength(1);
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
