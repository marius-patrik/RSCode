import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { type AppContext, lookupHandler } from "@/server/api";
import { BrowserFrameService, type BrowserInteractionMessage, type BrowserStreamHandle } from "@/server/browserService";
import { serveWebAsset } from "@/server/static";
import { CanvasStore } from "@/server/store";
import { getPaths, getServicePort, getServiceUrl } from "@/shared/paths";

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
  const browserFrames = new BrowserFrameService(paths.browserProfilesDir, (line) =>
    logLine(paths.serviceLogFile, `[${new Date().toISOString()}] ${line}`),
  );
  const tmuxExecutable = findTmuxExecutable();
  if (!tmuxExecutable) {
    await logLine(
      paths.serviceLogFile,
      `[${new Date().toISOString()}] tmux unavailable; terminal process persistence disabled`,
    );
  }
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
        workspacePath: process.cwd(),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await logLine(paths.serviceLogFile, `[${new Date().toISOString()}] service boot pid=${process.pid}`);

  const distRoot = resolve(import.meta.dir, "..", "..", "dist", "web");

  type TerminalSession = {
    proc: ReturnType<typeof Bun.spawn>;
    closed: boolean;
    mode: "tmux" | "direct";
  };
  const terminals = new WeakMap<object, TerminalSession>();
  const pendingTerminalMessages = new WeakMap<object, Array<string | BufferSource>>();
  const browserStreams = new WeakMap<object, BrowserStreamHandle>();

  type WSData =
    | { kind: "terminal"; paneId: string; cwd: string }
    | { kind: "browser"; workspaceId: string; paneId: string };
  const server = Bun.serve<WSData>({
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
        const paneId = url.searchParams.get("paneId");
        if (!paneId) {
          return new Response("paneId is required", { status: 400, headers: CORS_HEADERS });
        }
        const cwd = url.searchParams.get("cwd") || paths.root;
        const upgraded = srv.upgrade(request, { data: { kind: "terminal", paneId, cwd } });
        if (upgraded) return undefined as unknown as Response;
        return new Response("websocket upgrade required", { status: 426 });
      }

      if (url.pathname === "/api/browser/stream") {
        const workspaceId = url.searchParams.get("workspaceId");
        const paneId = url.searchParams.get("paneId");
        if (!workspaceId || !paneId) {
          return new Response("workspaceId and paneId are required", { status: 400, headers: CORS_HEADERS });
        }
        const upgraded = srv.upgrade(request, { data: { kind: "browser", workspaceId, paneId } });
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
        if (ws.data.kind === "browser") {
          await openBrowserStream(ws, ws.data.workspaceId, ws.data.paneId);
          return;
        }
        const cwd = ws.data.cwd || paths.root;
        try {
          const session = await spawnTerminalSession(ws, ws.data.paneId, cwd);
          terminals.set(ws as unknown as object, session);
          const pendingMessages = pendingTerminalMessages.get(ws as unknown as object) ?? [];
          pendingTerminalMessages.delete(ws as unknown as object);
          for (const pendingMessage of pendingMessages) handleTerminalMessage(session, pendingMessage);
        } catch (error) {
          pendingTerminalMessages.delete(ws as unknown as object);
          ws.send(`\x1b[31m[terminal failed: ${errorMessage(error)}]\x1b[0m\r\n`);
          ws.close(1011, "terminal failed");
        }
      },
      async message(ws, message) {
        if (ws.data.kind === "browser") {
          await handleBrowserMessage(ws, message);
          return;
        }
        const session = terminals.get(ws as unknown as object);
        if (!session) {
          const pendingMessages = pendingTerminalMessages.get(ws as unknown as object) ?? [];
          pendingMessages.push(message);
          pendingTerminalMessages.set(ws as unknown as object, pendingMessages);
          return;
        }
        handleTerminalMessage(session, message);
      },
      close(ws) {
        const browserStream = browserStreams.get(ws as unknown as object);
        if (browserStream) {
          browserStream.close();
          browserStreams.delete(ws as unknown as object);
          return;
        }
        const session = terminals.get(ws as unknown as object);
        if (!session) return;
        session.closed = true;
        session.proc.kill("SIGTERM");
        session.proc.terminal?.close();
        terminals.delete(ws as unknown as object);
        pendingTerminalMessages.delete(ws as unknown as object);
      },
    },
  });

  await logLine(paths.serviceLogFile, `[${new Date().toISOString()}] listening ${getServiceUrl()}`);
  console.log(`canvas listening on ${getServiceUrl()} (pid ${process.pid})`);

  async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    await logLine(paths.serviceLogFile, `[${new Date().toISOString()}] shutdown ${signal}`);
    await browserFrames.close();
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

  async function openBrowserStream(
    ws: ServerWebSocketLike,
    workspaceId: string,
    paneId: string,
  ): Promise<void> {
    try {
      const session = await store.getBrowserSession(workspaceId, paneId);
      const stream = await browserFrames.stream(session, {
        send: (message) => {
          ws.send(JSON.stringify(message));
        },
        onNavigation: async (url) => {
          const result = await store.navigateBrowserPane({ workspaceId, paneId, url });
          return result.browser;
        },
      });
      browserStreams.set(ws as unknown as object, stream);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ws.send(JSON.stringify({ type: "error", message }));
    }
  }

  async function handleBrowserMessage(
    ws: ServerWebSocketLike & { data: WSData },
    message: string | BufferSource,
  ) {
    if (ws.data.kind !== "browser") return;
    const source = typeof message === "string" ? message : new TextDecoder().decode(bufferSourceToBytes(message));
    let parsed: unknown;
    try {
      parsed = JSON.parse(source);
    } catch {
      ws.send(JSON.stringify({ type: "error", message: "invalid browser message json" }));
      return;
    }
    const command = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    if (command.type === "navigate" && typeof command.url === "string") {
      try {
        const persisted = await store.navigateBrowserPane({
          workspaceId: ws.data.workspaceId,
          paneId: ws.data.paneId,
          url: command.url,
          replace: command.replace === true,
        });
        await browserFrames.interact(persisted.browser, {
          type: "navigate",
          url: persisted.browser.url,
          replace: true,
        });
      } catch (error) {
        ws.send(JSON.stringify({ type: "error", message: errorMessage(error) }));
      }
      return;
    }
    if (isBrowserInteractionMessage(command)) {
      try {
        const session = await store.getBrowserSession(ws.data.workspaceId, ws.data.paneId);
        await browserFrames.interact(session, command);
        return;
      } catch (error) {
        ws.send(JSON.stringify({ type: "error", message: errorMessage(error) }));
      }
    }
    try {
      ws.send(JSON.stringify(await browserFrames.stateFor(await store.getBrowserSession(ws.data.workspaceId, ws.data.paneId))));
    } catch (error) {
      ws.send(JSON.stringify({ type: "error", message: errorMessage(error) }));
    }
  }

  async function spawnTerminalSession(ws: ServerWebSocketLike, paneId: string, cwd: string): Promise<TerminalSession> {
    if (tmuxExecutable) {
      return spawnTmuxTerminalSession(ws, tmuxExecutable, tmuxSessionName(paths.root, paneId), resolve(cwd));
    }
    return spawnDirectTerminalSession(ws, cwd, "tmux unavailable; live terminal persistence disabled");
  }

  async function spawnTmuxTerminalSession(
    ws: ServerWebSocketLike,
    tmux: string,
    sessionName: string,
    cwd: string,
  ): Promise<TerminalSession> {
    const exists = await tmuxHasSession(tmux, sessionName);
    if (!exists) await tmuxNewSession(tmux, sessionName, cwd);
    if (exists) {
      const history = await tmuxCaptureHistory(tmux, sessionName);
      if (history.trim()) ws.send(normalizeTerminalOutput(history));
    }
    const session: TerminalSession = {
      proc: undefined as unknown as ReturnType<typeof Bun.spawn>,
      closed: false,
      mode: "tmux",
    };
    const proc = Bun.spawn([tmux, "attach-session", "-t", sessionName], {
      env: { ...process.env, TERM: "xterm-256color" },
      terminal: {
        cols: 80,
        rows: 24,
        data(_terminal, data) {
          if (!session.closed) ws.send(data);
        },
      },
    });
    session.proc = proc;
    if (!proc.terminal) {
      ws.send("PTY unavailable\r\n");
      ws.close(1011, "pty unavailable");
      return session;
    }
    void proc.exited.finally(() => {
      session.closed = true;
      ws.close(1000, "terminal detached");
      proc.terminal?.close();
    });
    return session;
  }

  function spawnDirectTerminalSession(
    ws: ServerWebSocketLike,
    cwd: string,
    warning?: string,
  ): TerminalSession {
    const session: TerminalSession = {
      proc: undefined as unknown as ReturnType<typeof Bun.spawn>,
      closed: false,
      mode: "direct",
    };
    if (warning) ws.send(`\x1b[33m[${warning}]\x1b[0m\r\n`);
    const proc = Bun.spawn([process.env.SHELL ?? "/bin/bash", "-l"], {
      cwd,
      env: { ...process.env, TERM: "xterm-256color" },
      terminal: {
        cols: 80,
        rows: 24,
        data(_terminal, data) {
          if (!session.closed) ws.send(data);
        },
      },
    });
    session.proc = proc;
    if (!proc.terminal) {
      ws.send("PTY unavailable\r\n");
      ws.close(1011, "pty unavailable");
      return session;
    }
    void proc.exited.finally(() => {
      session.closed = true;
      ws.close(1000, "shell exited");
      proc.terminal?.close();
    });
    return session;
  }
}

function isBrowserInteractionMessage(command: Record<string, unknown>): command is BrowserInteractionMessage {
  if (command.type === "viewport") {
    return typeof command.width === "number" && typeof command.height === "number";
  }
  if (command.type === "mouse") {
    return (
      (command.event === "move" || command.event === "down" || command.event === "up" || command.event === "dblclick") &&
      typeof command.x === "number" &&
      typeof command.y === "number"
    );
  }
  if (command.type === "reload") return command.url === undefined || typeof command.url === "string";
  if (command.type === "click") {
    return typeof command.x === "number" && typeof command.y === "number";
  }
  if (command.type === "wheel") {
    return (
      typeof command.x === "number" &&
      typeof command.y === "number" &&
      typeof command.deltaX === "number" &&
      typeof command.deltaY === "number"
    );
  }
  if (command.type === "key") {
    return (command.event === "down" || command.event === "up") && typeof command.key === "string";
  }
  if (command.type === "text") return typeof command.text === "string";
  if (command.type === "paste") return typeof command.text === "string";
  if (command.type === "type") return typeof command.text === "string";
  return false;
}

function bufferSourceToBytes(source: BufferSource): Uint8Array {
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
}

function handleTerminalMessage(
  session: { proc: ReturnType<typeof Bun.spawn> },
  message: string | BufferSource,
) {
  const source = typeof message === "string" ? message : new TextDecoder().decode(bufferSourceToBytes(message));
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return;
  }
  if (!parsed || typeof parsed !== "object") return;
  const command = parsed as Record<string, unknown>;
  if (command.type === "input" && typeof command.data === "string") {
    session.proc.terminal?.write(command.data);
  }
  if (
    command.type === "resize" &&
    typeof command.cols === "number" &&
    typeof command.rows === "number"
  ) {
    session.proc.terminal?.resize(Math.max(1, Math.floor(command.cols)), Math.max(1, Math.floor(command.rows)));
  }
}

type ServerWebSocketLike = {
  send: (data: string | Uint8Array) => unknown;
  close: (code?: number, reason?: string) => void;
};

function findTmuxExecutable(): string | null {
  if (process.env.CANVAS_TMUX === "0" || process.env.CANVAS_DISABLE_TMUX === "1") return null;
  const candidates = [
    process.env.CANVAS_TMUX_PATH,
    process.env.TMUX_EXECUTABLE_PATH,
    "/opt/homebrew/bin/tmux",
    "/usr/local/bin/tmux",
    "/usr/bin/tmux",
    "/bin/tmux",
  ].filter((candidate): candidate is string => Boolean(candidate));
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function tmuxSessionName(root: string, paneId: string): string {
  const hash = createHash("sha1").update(`${root}\0${paneId}`).digest("hex").slice(0, 24);
  return `canvas_${hash}`;
}

async function tmuxHasSession(tmux: string, sessionName: string): Promise<boolean> {
  const result = await runProcess([tmux, "has-session", "-t", sessionName]);
  return result.code === 0;
}

async function tmuxNewSession(tmux: string, sessionName: string, cwd: string): Promise<void> {
  const result = await runProcess([tmux, "new-session", "-d", "-s", sessionName, "-c", cwd]);
  if (result.code !== 0) {
    throw new Error(`tmux new-session failed: ${result.stderr || result.stdout || `exit ${result.code}`}`);
  }
}

async function tmuxCaptureHistory(tmux: string, sessionName: string): Promise<string> {
  const result = await runProcess([tmux, "capture-pane", "-p", "-e", "-J", "-S", "-2000", "-t", `${sessionName}:0.0`]);
  if (result.code !== 0) return "";
  return result.stdout;
}

async function runProcess(command: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(command, {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    streamText(proc.stdout),
    streamText(proc.stderr),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

async function streamText(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) return "";
  return new Response(stream).text();
}

function normalizeTerminalOutput(output: string): string {
  return `${output.replace(/\r?\n/g, "\r\n")}\r\n`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
