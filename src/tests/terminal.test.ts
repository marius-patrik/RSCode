import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "@/server/server";

let canvasHome = "";
let previousCanvasHome: string | undefined;
let previousCanvasPort: string | undefined;
let previousCanvasUrl: string | undefined;

beforeEach(async () => {
  previousCanvasHome = process.env.CANVAS_HOME;
  previousCanvasPort = process.env.CANVAS_PORT;
  previousCanvasUrl = process.env.CANVAS_URL;
  canvasHome = await mkdtemp(join(tmpdir(), "canvas-terminal-"));
  process.env.CANVAS_HOME = canvasHome;
  process.env.CANVAS_URL = undefined;
});

afterEach(async () => {
  process.env.CANVAS_HOME = previousCanvasHome;
  process.env.CANVAS_PORT = previousCanvasPort;
  process.env.CANVAS_URL = previousCanvasUrl;
  if (canvasHome) await rm(canvasHome, { recursive: true, force: true });
  canvasHome = "";
});

test(
  "terminal websocket runs a shell through a PTY",
  async () => {
    const port = await freePort();
    process.env.CANVAS_PORT = String(port);
    const server = await startServer();
    try {
      const output = await terminalOutput(port, "printf terminal-ok\nexit\n");
      expect(output).toContain("terminal-ok");
    } finally {
      server.stop(true);
    }
  },
  15_000,
);

function terminalOutput(port: number, input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/api/terminal/spawn?cwd=${encodeURIComponent(process.cwd())}`,
    );
    let output = "";
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`terminal output timed out: ${output}`));
    }, 8_000);
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "input", data: input }));
    };
    ws.onmessage = (event) => {
      output += messageText(event.data);
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error(`terminal websocket failed: ${output}`));
    };
    ws.onclose = () => {
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
