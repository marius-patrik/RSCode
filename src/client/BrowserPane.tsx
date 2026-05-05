import { websocketUrl } from "@/client/endpoints";
import { urlForLauncherQuery } from "@/client/launcher";
import type { BrowserPaneState } from "@/shared/schema";
import { AlertTriangle, ArrowLeft, ArrowRight, ChevronRight, Globe2, RotateCw } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

type BrowserSocketMessage = {
  type?: string;
  image?: string;
  renderer?: string;
  message?: string;
  url?: string;
  browser?: { url: string; canGoBack: boolean; canGoForward: boolean };
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
  const [frame, setFrame] = useState<string | null>(null);
  const [renderer, setRenderer] = useState<string>("connecting");
  const [browserError, setBrowserError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const paneRef = useRef(pane);
  const lastFrameUrlRef = useRef<string | null>(null);

  useEffect(() => setAddress(pane.url), [pane.url]);
  useEffect(() => {
    paneRef.current = pane;
  }, [pane]);

  useEffect(() => {
    const url = new URL(websocketUrl(baseUrl, "/api/browser/stream"));
    url.searchParams.set("workspaceId", workspaceId);
    url.searchParams.set("paneId", pane.id);
    const ws = new WebSocket(url.toString());
    wsRef.current = ws;
    ws.onmessage = (event) => {
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
        setFrame(parsed.image);
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
      setRenderer("closed");
      setBrowserError("Browser connection closed.");
    };
    return () => {
      ws.onmessage = null;
      ws.onclose = null;
      ws.close();
    };
  }, [baseUrl, onBrowserSync, pane.id, workspaceId]);

  useEffect(() => {
    if (lastFrameUrlRef.current === pane.url) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "reload", url: pane.url }));
    }
  }, [pane.url]);

  const sendBrowserMessage = useCallback((payload: Record<string, unknown>) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify(payload));
  }, []);

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
        <ToolbarButton title="Reload" onClick={() => sendBrowserMessage({ type: "reload", url: pane.url })}>
          <RotateCw className="h-4 w-4" />
        </ToolbarButton>
        <input
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          className="min-w-0 flex-1 rounded border border-border bg-secondary px-2 py-1 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
        />
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
        aria-label="Browser viewport"
        className="relative min-h-0 flex-1 appearance-none bg-[var(--panel-bg)] p-0 text-left outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
        onMouseDown={(event) => {
          const point = browserFramePoint(event, imageRef.current);
          if (!point) return;
          event.currentTarget.focus();
          event.preventDefault();
          sendBrowserMessage({ type: "click", ...point, button: browserButton(event.button) });
        }}
        onWheel={(event) => {
          const point = browserFramePoint(event, imageRef.current);
          if (!point) return;
          event.preventDefault();
          sendBrowserMessage({
            type: "wheel",
            ...point,
            deltaX: event.deltaX,
            deltaY: event.deltaY,
          });
        }}
        onKeyDown={(event) => {
          const message = browserKeyMessage(event);
          if (!message) return;
          event.preventDefault();
          sendBrowserMessage(message);
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
            ref={imageRef}
            src={frame}
            alt={pane.url}
            className="h-full w-full select-none object-contain bg-transparent"
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
  image: HTMLImageElement | null,
): { x: number; y: number } | null {
  if (!image) return null;
  const rect = image.getBoundingClientRect();
  const naturalWidth = image.naturalWidth || 1280;
  const naturalHeight = image.naturalHeight || 720;
  const imageAspect = naturalWidth / naturalHeight;
  const boxAspect = rect.width / rect.height;
  let drawWidth = rect.width;
  let drawHeight = rect.height;
  let offsetX = 0;
  let offsetY = 0;
  if (boxAspect > imageAspect) {
    drawWidth = rect.height * imageAspect;
    offsetX = (rect.width - drawWidth) / 2;
  } else {
    drawHeight = rect.width / imageAspect;
    offsetY = (rect.height - drawHeight) / 2;
  }
  const localX = event.clientX - rect.left - offsetX;
  const localY = event.clientY - rect.top - offsetY;
  if (localX < 0 || localY < 0 || localX > drawWidth || localY > drawHeight) return null;
  return {
    x: Math.round(clamp((localX / drawWidth) * naturalWidth, 0, naturalWidth)),
    y: Math.round(clamp((localY / drawHeight) * naturalHeight, 0, naturalHeight)),
  };
}

function browserButton(button: number): "left" | "middle" | "right" {
  if (button === 1) return "middle";
  if (button === 2) return "right";
  return "left";
}

function browserKeyMessage(event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}): { type: "key"; key: string } | { type: "type"; text: string } | null {
  if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
    return { type: "type", text: event.key };
  }
  const key = event.key === " " ? "Space" : event.key;
  const modifier = event.metaKey ? "Meta" : event.ctrlKey ? "Control" : event.altKey ? "Alt" : "";
  return { type: "key", key: modifier ? `${modifier}+${key}` : key };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
