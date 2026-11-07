import { afterEach, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { connect, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

let canvasHome = "";

afterEach(async () => {
  if (canvasHome) await rm(canvasHome, { recursive: true, force: true });
  canvasHome = "";
});

test(
  "bun run dev serves the web app, proxies health, and proxies terminal websockets",
  async () => {
    canvasHome = await mkdtemp(join(tmpdir(), "canvas-dev-server-"));
    const webPort = await freePort();
    const apiPort = await freePort();
    const output: string[] = [];
    const proc = Bun.spawn(["bun", "run", "dev"], {
      env: {
        ...process.env,
        CANVAS_HOME: canvasHome,
        CANVAS_DEV_WEB_PORT: String(webPort),
        CANVAS_DEV_API_PORT: String(apiPort),
        CANVAS_PORT: String(webPort),
        CANVAS_URL: `http://127.0.0.1:${webPort}`,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    void collectOutput(proc.stdout, output);
    void collectOutput(proc.stderr, output);

    try {
      const health = await waitForHealth(webPort, output);
      expect(health.ok).toBe(true);
      expect(health.port).toBe(apiPort);

      const terminal = await terminalOutput(webPort, `terminal:dev-smoke:${Date.now()}`, "printf dev-terminal-ok\nexit\n");
      expect(terminal).toContain("dev-terminal-ok");
      
      // A remote website must never be able to create, delete or modify a local
      // file through fetch, form POST, DNS rebinding or an image URL.
      const target = join(canvasHome, "important.txt");
      await writeFile(target, "preserve me");
      const endpoint = `http://127.0.0.1:${apiPort}/api/fs.delete`;
      const input = JSON.stringify({ path: target });
      const viaGet = await fetch(`${endpoint}?input=${encodeURIComponent(input)}`);
      expect(viaGet.status).toBe(405);
      const viaForm = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: input,
      });
      expect(viaForm.status).toBe(415);
      const viaCrossOrigin = await fetch(endpoint, {
        method: "POST",
        headers: { origin: "https://example.attacker.invalid", "content-type": "application/json" },
        body: input,
      });
      expect(viaCrossOrigin.status).toBe(403);
      const viaSiblingOrigin = await fetch(endpoint, {
        method: "POST",
        headers: { origin: "http://localhost:7123", "content-type": "application/json" },
        body: input,
      });
      expect(viaSiblingOrigin.status).toBe(403);
      expect(await readFile(target, "utf8")).toBe("preserve me");

      const badJson = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      });
      expect(badJson.status).toBe(400);
      const badArguments = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      expect(badArguments.status).toBe(400);
      const oversized = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "x".repeat(16 * 1024 * 1024 + 1),
      });
      expect(oversized.status).toBe(413);
      const missingPath = join(canvasHome, "sensitive-not-found.txt");
      const missingFile = await fetch(`http://127.0.0.1:${apiPort}/api/fs.readFile`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: missingPath }),
      });
      expect(missingFile.status).toBe(500);
      expect(await missingFile.text()).not.toContain(missingPath);

      // Raw WebSocket handshakes exercise the actual HTTP upgrade gate rather
      // than relying on a browser client that may normalize Origin headers.
      const terminalRoute = "/api/terminal/spawn?paneId=untrusted";
      const browserRoute = "/api/browser/stream?workspaceId=x&paneId=y";
      expect(await websocketUpgradeStatus(apiPort, terminalRoute, "http://localhost:7123")).toBe(403);
      expect(await websocketUpgradeStatus(apiPort, browserRoute, "https://attacker.invalid")).toBe(403);
      expect(await websocketUpgradeStatus(apiPort, terminalRoute, `http://127.0.0.1:${webPort}`)).toBe(101);

      // The IPv6 loopback listener can use the SAME numeric port as the IPv4
      // service. Both privileged WebSocket endpoints must reject its Origin.
      for (const route of [terminalRoute, browserRoute]) {
        for (const origin of [
          `http://[::1]:${apiPort}`,
          `http://localhost:${apiPort}`,
          `http://[::1]:${webPort}`,
          `http://localhost:${webPort}`,
          "null",
          `http://127.0.0.1:${apiPort}/path`,
          `http://127.0.0.1:${webPort + 100}`,
          "not-an-origin",
        ]) {
          expect(await websocketUpgradeStatus(apiPort, route, origin)).toBe(403);
        }
        expect(await websocketUpgradeStatus(apiPort, route, `http://127.0.0.1:${webPort}`)).toBe(101);
        expect(await websocketUpgradeStatus(apiPort, route)).toBe(101); // originless CLI
        expect(await websocketUpgradeStatus(apiPort, route, `http://127.0.0.1:${webPort}`, `localhost:${apiPort}`)).toBe(403);
        expect(await websocketUpgradeStatus(apiPort, route, `http://127.0.0.1:${webPort}`, `[::1]:${apiPort}`)).toBe(403);
      }

      // HTTP must use the same first-party authority contract, even if the
      // forged Host is on another loopback address or DNS-rebinding hostname.
      expect(await httpStatus(apiPort, `127.0.0.1:${apiPort}`, `http://127.0.0.1:${apiPort}`)).toBe(200);
      expect(await httpStatus(apiPort, `127.0.0.1:${webPort}`, `http://127.0.0.1:${webPort}`)).toBe(200);
      expect(await httpStatus(apiPort, `127.0.0.1:${apiPort}`)).toBe(200);
      for (const origin of [`http://[::1]:${apiPort}`, `http://localhost:${apiPort}`, `http://[::1]:${webPort}`]) {
        expect(await httpStatus(apiPort, `127.0.0.1:${apiPort}`, origin)).toBe(403);
      }
      for (const host of [`localhost:${apiPort}`, `[::1]:${apiPort}`, `evil.invalid:${apiPort}`]) {
        expect(await httpStatus(apiPort, host, `http://127.0.0.1:${apiPort}`)).toBe(403);
      }

      const privateWorkspacePath = "/private/rscode-sensitive-browser-session";
      const errors = await browserCommandErrors(apiPort, privateWorkspacePath);
      expect(errors).toContain("browser stream unavailable");
      expect(errors).toContain("browser navigation failed");
      expect(errors).toContain("browser interaction failed");
      expect(errors.join(" ")).not.toContain(privateWorkspacePath);
      expect(await readFile(target, "utf8")).toBe("preserve me");
      const legitimate = await fetch(`http://127.0.0.1:${apiPort}/api/workspace.list`, {
        method: "POST",
        headers: { origin: `http://127.0.0.1:${webPort}`, "content-type": "application/json" },
        body: "null",
      });
      expect(legitimate.ok).toBe(true);
    } finally {
      await stopProcess(proc);
    }
  },
  35_000,
);

async function waitForHealth(port: number, output: string[]): Promise<{ ok: boolean; port: number }> {
  const startedAt = Date.now();
  let lastError = "";
  while (Date.now() - startedAt < 18_000) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return (await response.json()) as { ok: boolean; port: number };
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await Bun.sleep(250);
  }
  throw new Error(`dev server health timed out: ${lastError}\n${output.join("")}`);
}

function terminalOutput(port: number, paneId: string, input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/api/terminal/spawn?paneId=${encodeURIComponent(paneId)}&cwd=${encodeURIComponent(process.cwd())}`,
    );
    let output = "";
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      ws.close();
      reject(new Error(`terminal output timed out: ${output}`));
    }, 10_000);
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "input", data: input }));
    };
    ws.onmessage = (event) => {
      output += messageText(event.data);
    };
    ws.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`terminal websocket failed: ${output}`));
    };
    ws.onclose = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(output);
    };
  });
}

function messageText(data: unknown): string {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data);
  return String(data);
}

async function collectOutput(stream: ReadableStream<Uint8Array> | null, output: string[]): Promise<void> {
  if (!stream) return;
  const text = await new Response(stream).text().catch((error) => String(error));
  output.push(text);
}

async function stopProcess(proc: ReturnType<typeof Bun.spawn>): Promise<void> {
  if (!proc.killed) proc.kill("SIGTERM");
  const exited = await Promise.race([
    proc.exited.then(() => true),
    Bun.sleep(5_000).then(() => false),
  ]);
  if (!exited && !proc.killed) proc.kill("SIGKILL");
  await proc.exited.catch(() => 0);
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("failed to allocate test port")));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

async function websocketUpgradeStatus(
  port: number, path: string, origin?: string, host = `127.0.0.1:${port}`,
): Promise<number> {
  return rawHttpStatus(port, [
    `GET ${path} HTTP/1.1`,
    `Host: ${host}`,
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Key: ${randomBytes(16).toString("base64")}`,
    "Sec-WebSocket-Version: 13",
    ...(origin === undefined ? [] : [`Origin: ${origin}`]),
  ]);
}

async function httpStatus(port: number, host: string, origin?: string): Promise<number> {
  return rawHttpStatus(port, [
    "GET /health HTTP/1.1",
    `Host: ${host}`,
    "Connection: close",
    ...(origin === undefined ? [] : [`Origin: ${origin}`]),
  ]);
}

function rawHttpStatus(port: number, headers: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: "127.0.0.1", port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("HTTP handshake timed out"));
    }, 4_000);
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.once("connect", () => {
      socket.write([...headers, "", ""].join("\r\n"));
    });
    socket.once("data", (data) => {
      clearTimeout(timer);
      const status = /HTTP\/1\.1 (\d{3})/.exec(data.toString("utf8"));
      socket.destroy();
      if (!status) reject(new Error("invalid HTTP status"));
      else resolve(Number(status[1]));
    });
  });
}

function browserCommandErrors(port: number, workspaceId: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/api/browser/stream?workspaceId=${encodeURIComponent(workspaceId)}&paneId=missing`,
    );
    const messages: string[] = [];
    let settled = false;
    const timer = setTimeout(() => {
      ws.close();
      if (!settled) reject(new Error(`browser errors timed out: ${messages.join(", ")}`));
    }, 5_000);
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "navigate", url: "about:blank" }));
      ws.send(JSON.stringify({ type: "viewport", width: 500, height: 320 }));
    };
    ws.onmessage = (event) => {
      const payload = JSON.parse(messageText(event.data)) as { type?: string; message?: string };
      if (payload.type === "error" && typeof payload.message === "string") messages.push(payload.message);
      if (messages.length === 3 && !settled) {
        settled = true;
        clearTimeout(timer);
        ws.close();
        resolve(messages);
      }
    };
    ws.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`browser websocket error: ${messages.join(", ")}`));
    };
  });
}
