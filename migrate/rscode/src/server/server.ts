import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { type AppContext, lookupHandler } from "@/server/api";
import { BrowserFrameService, type BrowserInteractionMessage, type BrowserStreamHandle } from "@/server/browserService";
import { serveWebAsset } from "@/server/static";
import { CanvasStore } from "@/server/store";
import { getPaths, getServicePort, getServiceUrl } from "@/shared/paths";
import { ZodError } from "zod";

const CORS_HEADERS = {
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const MAX_JSON_BODY_BYTES = 16 * 1024 * 1024;
const MAX_BROWSER_MESSAGE_BYTES = 16 * 1024 * 1024;
const MAX_TERMINAL_MESSAGE_BYTES = 128 * 1024;
const MAX_PENDING_TERMINAL_MESSAGES = 16;

class PayloadTooLarge extends Error {}

async function logLine(path: string, line: string) {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${line}\n`, "utf8");
}

async function readBody(request: Request): Promise<unknown> {
  // A Content-Length check alone is insufficient: chunked requests can omit it.
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_JSON_BODY_BYTES) throw new PayloadTooLarge("JSON request too large");
  if (!request.body) return undefined;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_JSON_BODY_BYTES) {
        await reader.cancel();
        throw new PayloadTooLarge("JSON request too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (bytes === 0) return undefined;
  return JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)));
}

async function dispatchApi(
  ctx: AppContext,
  path: string,
  request: Request,
  logPath: string,
): Promise<Response> {
  // Every API call uses JSON POST (including reads). In particular, GET
  // must never be able to delete a file through an image/script URL.
  if (request.method !== "POST") {
    return Response.json({ error: "API requests require POST" }, { status: 405, headers: CORS_HEADERS });
  }
  if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    return Response.json({ error: "API requests require application/json" }, { status: 415, headers: CORS_HEADERS });
  }
  const handler = lookupHandler(path);
  if (!handler) {
    return Response.json({ error: `unknown api path: ${path}` }, { status: 404, headers: CORS_HEADERS });
  }
  let input: unknown;
  try {
    input = await readBody(request);
  } catch (error) {
    const status = error instanceof PayloadTooLarge ? 413 : 400;
    return Response.json(
      { error: status === 413 ? "JSON request too large" : "invalid JSON request body" },
      { status, headers: CORS_HEADERS },
    );
  }
  try {
    const result = await handler(ctx, input);
    return Response.json(result, { headers: CORS_HEADERS });
  } catch (error) {
    if (error instanceof ZodError) {
      return Response.json({ error: "invalid API arguments" }, { status: 400, headers: CORS_HEADERS });
    }
    const message = error instanceof Error ? error.message : String(error);
    void logLine(logPath, `[${new Date().toISOString()}] api:${path} ${message.replace(/[\r\n]/g, " ").slice(0, 1000)}`);
    // Store and OS exceptions can contain private filesystem paths or command output.
    return Response.json({ error: "API operation failed" }, { status: 500, headers: CORS_HEADERS });
  }
}

export function isTrustedLocalRequest(
  request: Request,
  servicePort = getServicePort(),
  devWebPort = Number(process.env.CANVAS_DEV_WEB_PORT),
): boolean {
  // Browser origins are security principals, not interchangeable loopback addresses.
  // The service binds to 127.0.0.1; an unrelated process can serve [::1] on
  // the *same port*. Trust only the exact first-party authority and dev proxy.
  const validPort = (port: number) => Number.isInteger(port) && port >= 1 && port <= 65535;
  if (!validPort(servicePort)) return false;
  const authorities = [`127.0.0.1:${servicePort}`];
  if (validPort(devWebPort)) authorities.push(`127.0.0.1:${devWebPort}`);
  if (!authorities.includes(request.headers.get("host") ?? "")) return false;

  const origin = request.headers.get("origin");
  if (origin === null) return true; // Intentional originless local CLI access.
  // Exact serialized-origin matching excludes IPv6/localhost aliases, DNS
  // rebinding, malformed URLs, user-info, paths, fragments and extra ports.
  return authorities.some((authority) => origin === `http://${authority}`);
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
  const closedSockets = new WeakSet<object>();
  const activeTerminals = new Set<TerminalSession>();

  type WSData =
    | { kind: "terminal"; paneId: string; cwd: string }
    | { kind: "browser"; workspaceId: string; paneId: string };
  const server = Bun.serve<WSData>({
    port: getServicePort(),
    hostname: "127.0.0.1",
    async fetch(request, srv) {
      // The local filesystem, terminals and browser profiles are privileged.
      // Reject remote website origins and DNS-rebinding hostnames before
      // responding to CORS preflights, HTTP requests or WebSocket upgrades.
      if (!isTrustedLocalRequest(request)) {
        return new Response("Forbidden origin or host", { status: 403 });
      }
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
        if (!paneId || paneId.length > 256) {
          return new Response("invalid paneId", { status: 400, headers: CORS_HEADERS });
        }
        const cwd = url.searchParams.get("cwd") || paths.root;
        const upgraded = srv.upgrade(request, { data: { kind: "terminal", paneId, cwd } });
        if (upgraded) return undefined as unknown as Response;
        return new Response("websocket upgrade required", { status: 426 });
      }

      if (url.pathname === "/api/browser/stream") {
        const workspaceId = url.searchParams.get("workspaceId");
        const paneId = url.searchParams.get("paneId");
        if (!workspaceId || !paneId || workspaceId.length > 256 || paneId.length > 256) {
          return new Response("invalid workspaceId or paneId", { status: 400, headers: CORS_HEADERS });
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
          if (closedSockets.has(ws as unknown as object)) {
            session.closed = true;
            session.proc.kill("SIGTERM");
            session.proc.terminal?.close();
            return;
          }
          terminals.set(ws as unknown as object, session);
          activeTerminals.add(session);
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
        if (closedSockets.has(ws as unknown as object)) return;
        const bytes = typeof message === "string" ? Buffer.byteLength(message) : bufferSourceToBytes(message).byteLength;
        const limit = ws.data.kind === "browser" ? MAX_BROWSER_MESSAGE_BYTES : MAX_TERMINAL_MESSAGE_BYTES;
        if (bytes > limit) {
          ws.close(1009, "message too large");
          return;
        }
        if (ws.data.kind === "browser") {
          await handleBrowserMessage(ws, message);
          return;
        }
        const session = terminals.get(ws as unknown as object);
        if (!session) {
          const pendingMessages = pendingTerminalMessages.get(ws as unknown as object) ?? [];
          if (pendingMessages.length >= MAX_PENDING_TERMINAL_MESSAGES) {
            ws.close(1009, "too many pending messages");
            pendingTerminalMessages.delete(ws as unknown as object);
            return;
          }
          pendingMessages.push(message);
          pendingTerminalMessages.set(ws as unknown as object, pendingMessages);
          return;
        }
        handleTerminalMessage(session, message);
      },
      close(ws) {
        closedSockets.add(ws as unknown as object);
        pendingTerminalMessages.delete(ws as unknown as object);
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
        activeTerminals.delete(session);
      },
    },
  });

  await logLine(paths.serviceLogFile, `[${new Date().toISOString()}] listening ${getServiceUrl()}`);
  console.log(`canvas listening on ${getServiceUrl()} (pid ${process.pid})`);

  async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    await logLine(paths.serviceLogFile, `[${new Date().toISOString()}] shutdown ${signal}`);
    for (const session of activeTerminals) {
      session.closed = true;
      session.proc.kill("SIGTERM");
      session.proc.terminal?.close();
    }
    activeTerminals.clear();
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
          if (!closedSockets.has(ws as unknown as object)) ws.send(JSON.stringify(message));
        },
        onNavigation: async (url) => {
          const result = await store.navigateBrowserPane({ workspaceId, paneId, url });
          return result.browser;
        },
      });
      if (closedSockets.has(ws as unknown as object)) stream.close();
      else browserStreams.set(ws as unknown as object, stream);
    } catch (error) {
      if (!closedSockets.has(ws as unknown as object)) {
        ws.send(JSON.stringify({ type: "error", message: "browser stream unavailable" }));
      }
      void logLine(paths.serviceLogFile, `browser stream: ${errorMessage(error).replace(/[\r\n]/g, " ").slice(0, 1000)}`);
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
        reportBrowserFailure(ws, "navigation", error);
      }
      return;
    }
    if (isBrowserInteractionMessage(command)) {
      try {
        const session = await store.getBrowserSession(ws.data.workspaceId, ws.data.paneId);
        await browserFrames.interact(session, command);
        return;
      } catch (error) {
        reportBrowserFailure(ws, "interaction", error);
        return;
      }
    }
    ws.send(JSON.stringify({ type: "error", message: "unsupported browser command" }));
  }

  function reportBrowserFailure(ws: ServerWebSocketLike, activity: "navigation" | "interaction", error: unknown): void {
    // Errors from workspace storage, Chromium and the OS may contain absolute
    // paths, process details, or privileged command output. Keep those in logs.
    const message = activity === "interaction" && error instanceof Error &&
      error.message === "file chooser rejected invalid paths or oversized files"
      ? "file chooser rejected invalid paths or oversized files"
      : `browser ${activity} failed`;
    if (!closedSockets.has(ws as unknown as object)) {
      try {
        ws.send(JSON.stringify({ type: "error", message }));
      } catch {
        // The client may have disconnected while the browser command ran.
      }
    }
    void logLine(
      paths.serviceLogFile,
      `[${new Date().toISOString()}] browser ${activity}: ${errorMessage(error).replace(/[\r\n]/g, " ").slice(0, 1000)}`,
    ).catch(() => undefined);
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

export function isBrowserInteractionMessage(command: Record<string, unknown>): command is BrowserInteractionMessage {
  const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value);
  const shortText = (value: unknown) => typeof value === "string" && value.length <= 65_536;
  if (command.type === "viewport") {
    return finite(command.width) && finite(command.height) &&
      (command.width as number) > 0 && (command.height as number) > 0 &&
      (command.deviceScaleFactor === undefined ||
        (finite(command.deviceScaleFactor) && (command.deviceScaleFactor as number) > 0));
  }
  if (command.type === "mouse") {
    return (
      (command.event === "move" || command.event === "down" || command.event === "up" || command.event === "dblclick") &&
      finite(command.x) &&
      finite(command.y)
    );
  }
  if (command.type === "reload") return command.url === undefined || shortText(command.url);
  if (command.type === "click") {
    return finite(command.x) && finite(command.y);
  }
  if (command.type === "wheel") {
    return (
      finite(command.x) &&
      finite(command.y) &&
      finite(command.deltaX) &&
      finite(command.deltaY)
    );
  }
  if (command.type === "key") {
    return (command.event === "down" || command.event === "up") &&
      typeof command.key === "string" && command.key.length <= 128;
  }
  if (command.type === "text") return shortText(command.text);
  if (command.type === "paste") return shortText(command.text);
  if (command.type === "type") return shortText(command.text);
  if (command.type === "dialogResponse") {
    return typeof command.accept === "boolean" &&
      (command.promptText === undefined || shortText(command.promptText));
  }
  if (command.type === "chooseFiles") {
    const paths = command.paths;
    const files = command.files;
    return (paths === undefined || (Array.isArray(paths) && paths.length <= 20 &&
      paths.every((path: unknown) => typeof path === "string" && path.length <= 4096))) &&
      (files === undefined || (Array.isArray(files) && files.length <= 20 &&
        files.reduce((total: number, file: unknown) => total +
          (file && typeof file === "object" && typeof (file as Record<string, unknown>).data === "string"
            ? ((file as { data: string }).data.length) : 0), 0) <= 12_000_000 &&
        files.every((file: unknown) => {
          if (!file || typeof file !== "object") return false;
          const candidate = file as Record<string, unknown>;
          return typeof candidate.name === "string" && candidate.name.length <= 255 &&
            typeof candidate.mimeType === "string" && candidate.mimeType.length <= 255 &&
            typeof candidate.data === "string" && candidate.data.length <= 8_000_000;
        })));
  }
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
  if (command.type === "input" && typeof command.data === "string" && command.data.length <= 65_536) {
    session.proc.terminal?.write(command.data);
  }
  if (
    command.type === "resize" &&
    typeof command.cols === "number" && Number.isFinite(command.cols) && command.cols >= 1 && command.cols <= 1000 &&
    typeof command.rows === "number" && Number.isFinite(command.rows) && command.rows >= 1 && command.rows <= 1000
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
