import { useEffect, useRef } from "react";

// xterm.js terminal hosted inside a workspace pane. Lazy-imports the
// xterm bundle on mount so the main chunk stays small. Talks to the
// /api/terminal/spawn WebSocket — server-side spawns a Bun.spawn shell
// at the requested cwd, pipes stdout/stderr → ws.send and ws.message →
// proc.stdin. No PTY (vim/htop won't render perfectly).

export function TerminalNodeView({ cwd }: { cwd: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let disposed = false;
    let term: { dispose: () => void; write: (data: string | Uint8Array) => void; onData: (handler: (data: string) => void) => { dispose: () => void } } | null = null;
    let dataDisposable: { dispose: () => void } | null = null;
    let resizeObs: ResizeObserver | null = null;

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
        cursorBlink: true,
        convertEol: true,
        theme: {
          background: "#1e1e1e",
          foreground: "#d4d4d4",
          cursor: "#d4d4d4",
        },
      });
      const fit = new FitAddon();
      t.loadAddon(fit);
      t.open(containerRef.current);
      fit.fit();
      term = t as unknown as typeof term;

      const url = new URL("/api/terminal/spawn", window.location.origin);
      url.searchParams.set("cwd", cwd);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(url.toString());
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

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
        if (ws.readyState === WebSocket.OPEN) ws.send(data);
      });

      resizeObs = new ResizeObserver(() => {
        try { fit.fit(); } catch { /* */ }
      });
      resizeObs.observe(containerRef.current);
    })();

    return () => {
      disposed = true;
      try { dataDisposable?.dispose(); } catch { /* */ }
      try { resizeObs?.disconnect(); } catch { /* */ }
      try { wsRef.current?.close(); } catch { /* */ }
      try { term?.dispose(); } catch { /* */ }
    };
  }, [cwd]);

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
