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
let previousDisableTmux: string | undefined;
let previousCanvasTmux: string | undefined;

beforeEach(async () => {
  previousCanvasHome = process.env.CANVAS_HOME;
  previousCanvasPort = process.env.CANVAS_PORT;
  previousCanvasUrl = process.env.CANVAS_URL;
  previousDisableTmux = process.env.CANVAS_DISABLE_TMUX;
  previousCanvasTmux = process.env.CANVAS_TMUX;
  canvasHome = await mkdtemp(join(tmpdir(), "canvas-terminal-"));
  process.env.CANVAS_HOME = canvasHome;
  process.env.CANVAS_URL = undefined;
  process.env.CANVAS_DISABLE_TMUX = undefined;
  process.env.CANVAS_TMUX = undefined;
});

afterEach(async () => {
  process.env.CANVAS_HOME = previousCanvasHome;
  process.env.CANVAS_PORT = previousCanvasPort;
  process.env.CANVAS_URL = previousCanvasUrl;
  process.env.CANVAS_DISABLE_TMUX = previousDisableTmux;
  process.env.CANVAS_TMUX = previousCanvasTmux;
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
      const output = await terminalOutput(port, `terminal:test:${Date.now()}`, "printf terminal-ok\nexit\n");
      expect(output).toContain("terminal-ok");
    } finally {
      server.stop(true);
    }
  },
  15_000,
);

test(
  "tmux terminal sessions survive server restart and replay scrollback",
  async () => {
    if (!(await commandAvailable("tmux"))) return;
    const port = await freePort();
    const paneId = `terminal:persist:${Date.now()}`;
    process.env.CANVAS_PORT = String(port);
    let server = await startServer();
    try {
      const firstOutput = await terminalOutput(
        port,
        paneId,
        "export CANVAS_TMUX_TEST=survived\nprintf \"__scrollback__\\n\"\nprintf \"__cmd_done__:$CANVAS_TMUX_TEST\\n\"\n",
        {
          resolveWhen: (output) => output.includes("__cmd_done__:survived"),
          closeWhenResolved: true,
        },
      );
      expect(firstOutput).toContain("__scrollback__");
      expect(firstOutput).toContain("__cmd_done__:survived");
    } finally {
      server.stop(true);
    }

    await Bun.sleep(250);
    server = await startServer();
    try {
      const output = await terminalOutput(port, paneId, "printf \"var:$CANVAS_TMUX_TEST\\n\"\nexit\n");
      expect(output).toContain("__scrollback__");
      expect(output).toContain("var:survived");
    } finally {
      server.stop(true);
    }
  },
  25_000,
);

test(
  "terminal websocket falls back to direct PTY when tmux is disabled",
  async () => {
    process.env.CANVAS_DISABLE_TMUX = "1";
    const port = await freePort();
    process.env.CANVAS_PORT = String(port);
    const server = await startServer();
    try {
      const output = await terminalOutput(port, `terminal:fallback:${Date.now()}`, "printf fallback-ok\nexit\n");
      expect(output).toContain("live terminal persistence disabled");
      expect(output).toContain("fallback-ok");
    } finally {
      server.stop(true);
    }
  },
  15_000,
);

function terminalOutput(
  port: number,
  paneId: string,
  input: string,
  options: {
    resolveWhen?: (output: string) => boolean;
    closeWhenResolved?: boolean;
  } = {},
): Promise<string> {
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
    }, 8_000);
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "input", data: input }));
    };
    ws.onmessage = (event) => {
      output += messageText(event.data);
      if (settled || !options.resolveWhen?.(output)) return;
      settled = true;
      clearTimeout(timer);
      if (options.closeWhenResolved) ws.close();
      resolve(output);
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

async function commandAvailable(command: string): Promise<boolean> {
  const proc = Bun.spawn(["/bin/sh", "-lc", `command -v ${command}`], {
    stdout: "ignore",
    stderr: "ignore",
  });
  return (await proc.exited) === 0;
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
