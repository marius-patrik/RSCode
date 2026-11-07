import { websocketUrl } from "@/client/endpoints";
import type { IDisposable, ITheme, Terminal as XTerm } from "@xterm/xterm";
import { useEffect, useRef } from "react";

export const TERMINAL_INPUT_EVENT = "canvas:terminal-input";

const pendingInputs = new Map<string, string[]>();

export function sendTerminalInput(paneId: string, input: string): void {
  const queue = pendingInputs.get(paneId) ?? [];
  queue.push(input);
  pendingInputs.set(paneId, queue);
  window.dispatchEvent(new CustomEvent(TERMINAL_INPUT_EVENT, { detail: { paneId } }));
}

export function TerminalNodeView({ cwd, paneId, baseUrl }: { cwd: string; paneId: string; baseUrl?: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let disposed = false;
    let term: XTerm | null = null;
    let dataDisposable: IDisposable | null = null;
    let resizeObs: ResizeObserver | null = null;
    let themeObs: MutationObserver | null = null;

    void (async () => {
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");
      // Side-effect CSS — Monaco-style: load on first open.
      // biome-ignore lint/style/noUnusedTemplateLiteral: import side-effect path
      await import(`@xterm/xterm/css/xterm.css`);
      if (disposed || !containerRef.current) return;

      const t = new Terminal({
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 12,
        allowTransparency: true,
        cursorBlink: true,
        convertEol: true,
        theme: terminalTheme(),
      });
      const fit = new FitAddon();
      t.loadAddon(fit);
      t.open(containerRef.current);
      fit.fit();
      term = t;

      themeObs = new MutationObserver(() => {
        t.options.theme = terminalTheme();
      });
      themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });

      const url = new URL(websocketUrl(baseUrl, "/api/terminal/spawn"));
      url.searchParams.set("paneId", paneId);
      url.searchParams.set("cwd", cwd);
      const ws = new WebSocket(url.toString());
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;
      ws.onopen = () => {
        sendTerminalResize(ws, t);
        flushPendingInput(paneId, ws);
      };

      ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          t.write(new Uint8Array(event.data));
        } else if (typeof event.data === "string") {
          t.write(event.data);
        }
      };
      ws.onclose = () => {
        t.write("\r\n\x1b[33m[shell exited]\x1b[0m\r\n");
      };

      dataDisposable = t.onData((data) => {
        sendTerminalInputEnvelope(ws, data);
      });

      resizeObs = new ResizeObserver(() => {
        fit.fit();
        sendTerminalResize(ws, t);
      });
      resizeObs.observe(containerRef.current);
    })();

    return () => {
      disposed = true;
      try { dataDisposable?.dispose(); } catch { /* */ }
      try { resizeObs?.disconnect(); } catch { /* */ }
      try { themeObs?.disconnect(); } catch { /* */ }
      try { wsRef.current?.close(); } catch { /* */ }
      try { term?.dispose(); } catch { /* */ }
    };
  }, [baseUrl, cwd, paneId]);

  useEffect(() => {
    function handleInput(event: Event) {
      const detail = (event as CustomEvent<{ paneId: string }>).detail;
      if (detail?.paneId !== paneId) return;
      const ws = wsRef.current;
      if (!ws) return;
      flushPendingInput(paneId, ws);
    }
    window.addEventListener(TERMINAL_INPUT_EVENT, handleInput);
    return () => window.removeEventListener(TERMINAL_INPUT_EVENT, handleInput);
  }, [paneId]);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: terminal swallows its own keys; the click handler just blocks canvas-level pan/expand
    <div
      ref={containerRef}
      className="h-full w-full"
      onClick={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    />
  );
}

function flushPendingInput(paneId: string, ws: WebSocket): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  const queue = pendingInputs.get(paneId);
  if (!queue?.length) return;
  pendingInputs.delete(paneId);
  for (const input of queue) sendTerminalInputEnvelope(ws, `${input}\n`);
}

function sendTerminalInputEnvelope(ws: WebSocket, data: string): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: "input", data }));
}

function sendTerminalResize(ws: WebSocket, term: XTerm): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
}

function terminalTheme(): ITheme {
  const styles = getComputedStyle(document.documentElement);
  const foreground = styles.getPropertyValue("--foreground").trim() || "#ffffff";
  const muted = styles.getPropertyValue("--muted-foreground").trim() || "#9b9b9b";
  const surface = styles.getPropertyValue("--surface-hover").trim() || "rgba(255, 255, 255, 0.12)";
  return {
    background: "#00000000",
    foreground,
    cursor: foreground,
    cursorAccent: styles.getPropertyValue("--background").trim() || "#000000",
    selectionBackground: surface,
    black: foreground,
    red: foreground,
    green: foreground,
    yellow: foreground,
    blue: foreground,
    magenta: foreground,
    cyan: foreground,
    white: foreground,
    brightBlack: muted,
    brightRed: foreground,
    brightGreen: foreground,
    brightYellow: foreground,
    brightBlue: foreground,
    brightMagenta: foreground,
    brightCyan: foreground,
    brightWhite: foreground,
  };
}
