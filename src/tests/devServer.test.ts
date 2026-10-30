import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
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
