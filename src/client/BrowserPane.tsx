import { websocketUrl } from "@/client/endpoints";
import { urlForLauncherQuery } from "@/client/launcher";
import type { BrowserPaneState } from "@/shared/schema";
import { AlertTriangle, ArrowLeft, ArrowRight, ChevronRight, Globe2, Loader2, RotateCw } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

type BrowserSocketMessage = {
  type?: string;
  image?: string;
  renderer?: string;
  message?: string;
  url?: string;
  width?: number;
  height?: number;
  title?: string;
  loading?: boolean;
  browser?: { url: string; canGoBack: boolean; canGoForward: boolean };
};

type BrowserFrame = {
  image: string;
  width: number;
  height: number;
};

export function BrowserPane({
  workspaceId,
  pane,
  baseUrl,
  onBrowserNavigate,
  onBrowserHistory,
  onBrowserSync,
}: {
  workspaceId: string;
  pane: BrowserPaneState;
  baseUrl?: string;
  onBrowserNavigate: (workspaceId: string, paneId: string, url: string, replace?: boolean) => Promise<void>;
  onBrowserHistory: (workspaceId: string, paneId: string, direction: "back" | "forward") => Promise<void>;
  onBrowserSync: (workspaceId: string) => Promise<void>;
}) {
  const [address, setAddress] = useState(pane.url);
  const [frame, setFrame] = useState<BrowserFrame | null>(null);
  const [renderer, setRenderer] = useState<string>("connecting");
  const [browserError, setBrowserError] = useState<string | null>(null);
  const [pageTitle, setPageTitle] = useState(pane.title);
  const [loading, setLoading] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const viewportRef = useRef<HTMLButtonElement | null>(null);
  const paneRef = useRef(pane);
  const lastFrameUrlRef = useRef<string | null>(null);
  const lastViewportRef = useRef<{ width: number; height: number } | null>(null);

  useEffect(() => setAddress(pane.url), [pane.url]);
  useEffect(() => {
    paneRef.current = pane;
  }, [pane]);

  const sendBrowserMessage = useCallback((payload: Record<string, unknown>) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify(payload));
  }, []);

  const sendViewport = useCallback(() => {
    const ws = wsRef.current;
    const element = viewportRef.current;
    if (!element || ws?.readyState !== WebSocket.OPEN) return;
    const rect = element.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    const previous = lastViewportRef.current;
    if (previous?.width === width && previous.height === height) return;
    lastViewportRef.current = { width, height };
    ws.send(JSON.stringify({ type: "viewport", width, height, deviceScaleFactor: 1 }));
  }, []);

  useEffect(() => {
    const url = new URL(websocketUrl(baseUrl, "/api/browser/stream"));
    url.searchParams.set("workspaceId", workspaceId);
    url.searchParams.set("paneId", pane.id);
    const ws = new WebSocket(url.toString());
    let disposed = false;
    wsRef.current = ws;
    ws.onopen = () => {
      if (disposed || wsRef.current !== ws) return;
      setRenderer("chromium");
      sendViewport();
    };
    ws.onmessage = (event) => {
      if (disposed || wsRef.current !== ws) return;
      if (typeof event.data !== "string") return;
      let parsed: BrowserSocketMessage;
      try {
        parsed = JSON.parse(event.data) as BrowserSocketMessage;
      } catch {
        setBrowserError("Browser sent an invalid message.");
        return;
      }
      if (parsed.type === "state" && parsed.browser) {
        const currentPane = paneRef.current;
        setAddress(parsed.browser.url);
        setPageTitle(parsed.title || parsed.browser.url || currentPane.title);
        setLoading(parsed.loading === true);
        const canGoBack = currentPane.historyIndex > 0;
        const canGoForward = currentPane.historyIndex < currentPane.history.length - 1;
        if (
          parsed.browser.url !== currentPane.url ||
          parsed.browser.canGoBack !== canGoBack ||
          parsed.browser.canGoForward !== canGoForward
        ) {
          void onBrowserSync(workspaceId);
        }
      }
      if (parsed.type === "frame" && parsed.image) {
        setFrame({
          image: parsed.image,
          width: parsed.width || lastViewportRef.current?.width || 1280,
          height: parsed.height || lastViewportRef.current?.height || 720,
        });
        setBrowserError(null);
        if (parsed.url) {
          const currentPane = paneRef.current;
          lastFrameUrlRef.current = parsed.url;
          setAddress(parsed.url);
          if (parsed.url !== currentPane.url) void onBrowserSync(workspaceId);
        }
      }
      if (parsed.renderer) setRenderer(parsed.renderer);
      if (parsed.type === "error") {
        setFrame(null);
        setBrowserError(parsed.message ?? "Browser failed.");
      }
    };
    ws.onclose = () => {
      if (disposed || wsRef.current !== ws) return;
      setRenderer("closed");
      setBrowserError("Browser connection closed.");
    };
    return () => {
      disposed = true;
      ws.onmessage = null;
      ws.onclose = null;
      if (wsRef.current === ws) wsRef.current = null;
      ws.close();
    };
  }, [baseUrl, onBrowserSync, pane.id, sendViewport, workspaceId]);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      sendViewport();
    });
    observer.observe(element);
    sendViewport();
    return () => observer.disconnect();
  }, [sendViewport]);

  useEffect(() => {
    if (lastFrameUrlRef.current === pane.url) return;
    sendBrowserMessage({ type: "navigate", url: pane.url, replace: true });
  }, [pane.url, sendBrowserMessage]);

  const navigate = async () => {
    const next = urlForLauncherQuery(address) ?? "about:blank";
    setAddress(next);
    await onBrowserNavigate(workspaceId, pane.id, next);
  };

  const canGoBack = pane.historyIndex > 0;
  const canGoForward = pane.historyIndex < pane.history.length - 1;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <form
        className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-2"
        onSubmit={(event) => {
          event.preventDefault();
          void navigate();
        }}
      >
        <Globe2 className="h-4 w-4 text-muted-foreground" />
        <ToolbarButton
          title="Back"
          disabled={!canGoBack}
          onClick={() => void onBrowserHistory(workspaceId, pane.id, "back")}
        >
          <ArrowLeft className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          title="Forward"
          disabled={!canGoForward}
          onClick={() => void onBrowserHistory(workspaceId, pane.id, "forward")}
        >
          <ArrowRight className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton title="Reload" onClick={() => sendBrowserMessage({ type: "reload" })}>
          <RotateCw className="h-4 w-4" />
        </ToolbarButton>
        <input
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          className="min-w-0 flex-1 rounded border border-border bg-secondary px-2 py-1 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
        />
        <div
          className="hidden max-w-[140px] items-center gap-1 truncate font-mono text-[10px] text-muted-foreground sm:flex"
          title={pageTitle}
        >
          {loading ? <Loader2 className="h-3 w-3 shrink-0 animate-spin" /> : null}
          <span className="truncate">{loading ? "loading" : pageTitle}</span>
        </div>
        <button
          type="submit"
          title="Go"
          className="inline-flex h-7 w-7 items-center justify-center rounded bg-secondary text-muted-foreground hover:text-foreground"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </form>
      <button
        type="button"
        ref={viewportRef}
        aria-label="Browser viewport"
        className="relative min-h-0 flex-1 appearance-none bg-[var(--panel-bg)] p-0 text-left outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
        onMouseMove={(event) => {
          const point = browserFramePoint(event, viewportRef.current);
          if (!point) return;
          sendBrowserMessage({ type: "mouse", event: "move", ...point, modifiers: browserModifiers(event) });
        }}
        onMouseDown={(event) => {
          const point = browserFramePoint(event, viewportRef.current);
          if (!point) return;
          event.currentTarget.focus();
          event.preventDefault();
          sendBrowserMessage({
            type: "mouse",
            event: "down",
            ...point,
            button: browserButton(event.button),
            modifiers: browserModifiers(event),
          });
        }}
        onMouseUp={(event) => {
          const point = browserFramePoint(event, viewportRef.current);
          if (!point) return;
          event.preventDefault();
          sendBrowserMessage({
            type: "mouse",
            event: "up",
            ...point,
            button: browserButton(event.button),
            modifiers: browserModifiers(event),
          });
        }}
        onDoubleClick={(event) => {
          const point = browserFramePoint(event, viewportRef.current);
          if (!point) return;
          event.preventDefault();
          sendBrowserMessage({
            type: "mouse",
            event: "dblclick",
            ...point,
            button: browserButton(event.button),
            modifiers: browserModifiers(event),
          });
        }}
        onContextMenu={(event) => {
          event.preventDefault();
        }}
        onWheel={(event) => {
          const point = browserFramePoint(event, viewportRef.current);
          if (!point) return;
          event.preventDefault();
          sendBrowserMessage({
            type: "wheel",
            ...point,
            deltaX: event.deltaX,
            deltaY: event.deltaY,
            modifiers: browserModifiers(event),
          });
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          event.preventDefault();
          sendBrowserMessage({
            type: "key",
            event: "down",
            key: browserKey(event.key),
            code: event.code,
            modifiers: browserModifiers(event),
          });
          if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
            sendBrowserMessage({ type: "text", text: event.key });
          }
        }}
        onKeyUp={(event) => {
          if (event.nativeEvent.isComposing) return;
          event.preventDefault();
          sendBrowserMessage({
            type: "key",
            event: "up",
            key: browserKey(event.key),
            code: event.code,
            modifiers: browserModifiers(event),
          });
        }}
        onPaste={(event) => {
          const text = event.clipboardData.getData("text/plain");
          if (!text) return;
          event.preventDefault();
          sendBrowserMessage({ type: "paste", text });
        }}
      >
        {browserError ? (
          <div className="flex h-full items-center justify-center bg-transparent p-6 text-center">
            <div className="max-w-md">
              <AlertTriangle className="mx-auto h-8 w-8 text-muted-foreground" />
              <div className="mt-3 text-sm font-semibold text-foreground">Browser unavailable</div>
              <div className="mt-2 break-words font-mono text-xs leading-relaxed text-muted-foreground">
                {browserError}
              </div>
            </div>
          </div>
        ) : frame ? (
          <img
            src={frame.image}
            width={frame.width}
            height={frame.height}
            alt={pane.url}
            className="h-full w-full select-none bg-transparent object-fill"
            draggable={false}
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-transparent font-mono text-xs text-muted-foreground">
            waiting for frame
          </div>
        )}
        {renderer !== "chromium" ? (
          <div className="absolute bottom-2 right-2 rounded border border-border bg-[var(--panel-bg)] px-2 py-1 font-mono text-[10px] text-muted-foreground backdrop-blur-xl">
            {renderer}
          </div>
        ) : null}
      </button>
    </div>
  );
}

function ToolbarButton({
  title,
  disabled,
  onClick,
  children,
}: {
  title: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded bg-secondary text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-muted-foreground"
    >
      {children}
    </button>
  );
}

function browserFramePoint(
  event: { clientX: number; clientY: number },
  viewport: HTMLElement | null,
): { x: number; y: number } | null {
  if (!viewport) return null;
  const rect = viewport.getBoundingClientRect();
  const localX = event.clientX - rect.left;
  const localY = event.clientY - rect.top;
  if (localX < 0 || localY < 0 || localX > rect.width || localY > rect.height) return null;
  return {
    x: Math.round(clamp(localX, 0, rect.width)),
    y: Math.round(clamp(localY, 0, rect.height)),
  };
}

function browserButton(button: number): "left" | "middle" | "right" {
  if (button === 1) return "middle";
  if (button === 2) return "right";
  return "left";
}

function browserKey(key: string): string {
  return key === " " ? "Space" : key;
}

function browserModifiers(event: {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): number {
  let modifiers = 0;
  if (event.altKey) modifiers |= 1;
  if (event.ctrlKey) modifiers |= 2;
  if (event.metaKey) modifiers |= 4;
  if (event.shiftKey) modifiers |= 8;
  return modifiers;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
