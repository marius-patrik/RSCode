import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { type AppContext, lookupHandler } from "@/api.ts";
import { getPaths, getServicePort, getServiceUrl } from "@/paths.ts";
import { serveWebAsset } from "@/static.ts";
import { CanvasStore } from "@/store.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

async function logLine(path: string, line: string) {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${line}\n`, "utf8");
}

async function readBody(request: Request): Promise<unknown> {
  if (request.method === "GET") {
    const q = new URL(request.url).searchParams.get("input");
    if (!q) return undefined;
    try {
      return JSON.parse(q);
    } catch {
      return undefined;
    }
  }
  const text = await request.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

async function dispatchApi(
  ctx: AppContext,
  path: string,
  request: Request,
  logPath: string,
): Promise<Response> {
  const handler = lookupHandler(path);
  if (!handler) {
    return Response.json({ error: `unknown api path: ${path}` }, { status: 404, headers: CORS_HEADERS });
  }
  let input: unknown;
  try {
    input = await readBody(request);
  } catch (error) {
    return Response.json(
      { error: `invalid input json: ${(error as Error).message}` },
      { status: 400, headers: CORS_HEADERS },
    );
  }
  try {
    const result = await handler(ctx, input);
    return Response.json(result, { headers: CORS_HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void logLine(logPath, `[${new Date().toISOString()}] api:${path} ${message}`);
    return Response.json({ error: message, path }, { status: 500, headers: CORS_HEADERS });
  }
}

export async function startServer() {
  const paths = getPaths();
  const store = new CanvasStore();
  await store.ensureInitialized();
  const ctx: AppContext = { store };
  let shuttingDown = false;

  await writeFile(
    paths.runtimeFile,
    `${JSON.stringify(
      {
        pid: process.pid,
        startedAt: new Date().toISOString(),
        port: getServicePort(),
        url: getServiceUrl(),
        logPath: paths.serviceLogFile,
        graphPath: paths.graphFile,
        workspacePath: process.cwd(),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await logLine(paths.serviceLogFile, `[${new Date().toISOString()}] service boot pid=${process.pid}`);

  const distRoot = resolve(import.meta.dir, "..", "dist", "web");

  type TerminalSession = { cwd: string; buffer: string; queue: Promise<void> };
  const terminals = new WeakMap<object, TerminalSession>();

  type WSData = { cwd: string };
  const server = Bun.serve<WSData, "/api/terminal/spawn">({
    port: getServicePort(),
    hostname: "127.0.0.1",
    async fetch(request, srv) {
      const url = new URL(request.url);
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      }

      if (url.pathname === "/health") {
        return Response.json(
          {
            ok: true,
            pid: process.pid,
            port: getServicePort(),
            root: paths.root,
            url: getServiceUrl(),
            workspacePath: process.cwd(),
          },
          { headers: CORS_HEADERS },
        );
      }

      if (url.pathname === "/api/terminal/spawn") {
        const cwd = url.searchParams.get("cwd") || paths.root;
        const upgraded = srv.upgrade(request, { data: { cwd } });
        if (upgraded) return undefined as unknown as Response;
        return new Response("websocket upgrade required", { status: 426 });
      }

      if (url.pathname.startsWith("/api/")) {
        return dispatchApi(ctx, url.pathname.slice("/api/".length), request, paths.serviceLogFile);
      }

      return serveWebAsset(distRoot, url.pathname);
    },

    websocket: {
      async open(ws) {
        const cwd = (ws.data as { cwd?: string } | undefined)?.cwd ?? paths.root;
        terminals.set(ws as unknown as object, { cwd, buffer: "", queue: Promise.resolve() });
        ws.send(`canvas:${cwd}$ `);
      },
      async message(ws, message) {
        const session = terminals.get(ws as unknown as object);
        if (!session) return;
        const chunk =
          typeof message === "string" ? message : new TextDecoder().decode(new Uint8Array(message));
        session.buffer += chunk.replace(/\r/g, "\n");
        const lines = session.buffer.split("\n");
        session.buffer = lines.pop() ?? "";
        for (const rawLine of lines) {
          session.queue = session.queue.then(() => runTerminalLine(ws, session, rawLine));
        }
        await session.queue;
      },
      close(ws) {
        const session = terminals.get(ws as unknown as object);
        if (!session) return;
        terminals.delete(ws as unknown as object);
      },
    },
  });

  await logLine(paths.serviceLogFile, `[${new Date().toISOString()}] listening ${getServiceUrl()}`);
  console.log(`canvas listening on ${getServiceUrl()} (pid ${process.pid})`);

  async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    await logLine(paths.serviceLogFile, `[${new Date().toISOString()}] shutdown ${signal}`);
    server.stop(true);
    process.exit(0);
  }

  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  return server;
}

async function runTerminalLine(
  ws: ServerWebSocketLike,
  session: { cwd: string },
  rawLine: string,
) {
  const line = rawLine.trim();
  if (!line) {
    ws.send(`\r\ncanvas:${session.cwd}$ `);
    return;
  }
  ws.send(`${line}\r\n`);
  if (line === "exit") {
    ws.close(1000, "shell exited");
    return;
  }
  if (line === "pwd") {
    ws.send(`${session.cwd}\r\ncanvas:${session.cwd}$ `);
    return;
  }
  if (line.startsWith("cd ")) {
    session.cwd = resolve(session.cwd, line.slice(3).trim());
    ws.send(`canvas:${session.cwd}$ `);
    return;
  }

  const proc = Bun.spawn([process.env.SHELL ?? "/bin/bash", "-lc", line], {
    cwd: session.cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, TERM: "xterm-256color" },
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  if (stdout) ws.send(stdout.replace(/\n/g, "\r\n"));
  if (stderr) ws.send(stderr.replace(/\n/g, "\r\n"));
  if (exitCode !== 0) ws.send(`[exit ${exitCode}]\r\n`);
  ws.send(`canvas:${session.cwd}$ `);
}

type ServerWebSocketLike = {
  send: (data: string | Uint8Array) => unknown;
  close: (code?: number, reason?: string) => void;
};
