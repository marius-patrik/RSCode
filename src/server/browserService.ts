import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { browserRuntimeUrl, browserStoredUrl } from "@/shared/browser";
import type { BrowserSession } from "@/shared/schema";
import { type BrowserContext, type CDPSession, type Frame, type Page, chromium } from "playwright-chromium";

type BrowserRenderer = "chromium";

type BrowserViewport = {
  width: number;
  height: number;
  deviceScaleFactor: number;
};

export type BrowserFrameMessage = {
  type: "frame";
  url: string;
  image: string;
  mimeType: "image/png";
  renderer: BrowserRenderer;
  width: number;
  height: number;
  ts: number;
};

export type BrowserStateMessage = {
  type: "state";
  browser: BrowserSession;
  renderer: BrowserRenderer;
  title?: string;
  loading?: boolean;
};

export type BrowserErrorMessage = {
  type: "error";
  message: string;
};

export type BrowserServerMessage = BrowserFrameMessage | BrowserStateMessage | BrowserErrorMessage;

export type BrowserViewportMessage = {
  type: "viewport";
  width: number;
  height: number;
  deviceScaleFactor?: number;
};

export type BrowserMouseMessage = {
  type: "mouse";
  event: "move" | "down" | "up" | "dblclick";
  x: number;
  y: number;
  button?: "left" | "middle" | "right";
  modifiers?: BrowserModifiers;
};

export type BrowserWheelMessage = {
  type: "wheel";
  x: number;
  y: number;
  deltaX: number;
  deltaY: number;
  modifiers?: BrowserModifiers;
};

export type BrowserKeyMessage = {
  type: "key";
  event: "down" | "up";
  key: string;
  code?: string;
  modifiers?: BrowserModifiers;
};

export type BrowserInteractionMessage =
  | BrowserViewportMessage
  | BrowserMouseMessage
  | BrowserWheelMessage
  | BrowserKeyMessage
  | { type: "text"; text: string }
  | { type: "paste"; text: string }
  | { type: "reload"; url?: string }
  | { type: "navigate"; url: string; replace?: boolean }
  | { type: "click"; x: number; y: number; button?: "left" | "middle" | "right" }
  | { type: "type"; text: string };

export type BrowserStreamSubscriber = {
  send: (message: BrowserServerMessage) => void | Promise<void>;
  onNavigation?: (url: string, title: string) => Promise<BrowserSession>;
};

export type BrowserStreamHandle = {
  close: () => void;
};

type BrowserModifiers = number | string[];

type LiveBrowser = {
  context: BrowserContext;
  page: Page;
  cdp: CDPSession;
  session: BrowserSession;
  currentUrl: string | null;
  title: string;
  loading: boolean;
  viewport: BrowserViewport;
  screencastStarted: boolean;
  lastFrame: BrowserFrameMessage | null;
  subscribers: Map<number, BrowserStreamSubscriber>;
  persistSubscriberId: number | null;
};

type ScreencastEvent = {
  data: string;
  sessionId: number;
};

const DEFAULT_VIEWPORT: BrowserViewport = { width: 1280, height: 720, deviceScaleFactor: 1 };
const MAX_VIEWPORT = { width: 4096, height: 4096 };

export class BrowserFrameService {
  readonly executablePath = findChromiumExecutable();
  private readonly liveBrowsers = new Map<string, Promise<LiveBrowser>>();
  private nextSubscriberId = 1;

  constructor(
    private readonly profilesRoot: string,
    private readonly log: (line: string) => void | Promise<void>,
  ) {}

  async stream(session: BrowserSession, subscriber: BrowserStreamSubscriber): Promise<BrowserStreamHandle> {
    const live = await this.liveBrowserFor(session);
    live.session = session;
    const subscriberId = this.nextSubscriberId++;
    live.subscribers.set(subscriberId, subscriber);
    if (subscriber.onNavigation && live.persistSubscriberId === null) live.persistSubscriberId = subscriberId;

    await this.startScreencast(live);
    await this.ensurePageUrl(live, session.url);
    await this.sendToSubscriber(subscriber, await this.stateForLive(live));
    if (live.lastFrame) await this.sendToSubscriber(subscriber, live.lastFrame);

    return {
      close: () => {
        live.subscribers.delete(subscriberId);
        if (live.persistSubscriberId === subscriberId) {
          live.persistSubscriberId = null;
          for (const [id, candidate] of live.subscribers) {
            if (!candidate.onNavigation) continue;
            live.persistSubscriberId = id;
            break;
          }
        }
      },
    };
  }

  async frameFor(session: BrowserSession): Promise<BrowserFrameMessage> {
    return new Promise((resolveFrame, rejectFrame) => {
      let settled = false;
      let handle: BrowserStreamHandle | null = null;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        handle?.close();
        rejectFrame(new Error("timed out waiting for browser screencast frame"));
      }, 8_000);
      void this.stream(session, {
        send: (message) => {
          if (settled || message.type !== "frame") return;
          settled = true;
          clearTimeout(timer);
          handle?.close();
          resolveFrame(message);
        },
      })
        .then((streamHandle) => {
          handle = streamHandle;
          if (settled) handle.close();
        })
        .catch((error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          rejectFrame(error);
        });
    });
  }

  async stateFor(session: BrowserSession): Promise<BrowserStateMessage> {
    const live = await this.liveBrowserFor(session);
    live.session = session;
    await this.ensurePageUrl(live, session.url);
    return this.stateForLive(live);
  }

  async interact(session: BrowserSession, message: BrowserInteractionMessage): Promise<void> {
    const live = await this.liveBrowserFor(session);
    live.session = session;
    await this.startScreencast(live);

    if (message.type === "viewport") {
      await this.setViewport(live, message);
      await this.broadcastState(live);
      return;
    }

    if (message.type === "navigate") {
      await this.ensurePageUrl(live, message.url);
      await this.broadcastState(live);
      return;
    }

    await this.ensurePageUrl(live, session.url);
    if (message.type === "reload") {
      if (message.url) await this.ensurePageUrl(live, message.url);
      live.loading = true;
      await this.broadcastState(live);
      await live.page.reload({ waitUntil: "domcontentloaded", timeout: 12_000 }).catch(() => undefined);
    } else if (message.type === "mouse") {
      await this.dispatchMouse(live, message);
    } else if (message.type === "click") {
      await this.dispatchLegacyClick(live, message);
    } else if (message.type === "wheel") {
      await this.dispatchWheel(live, message);
    } else if (message.type === "key") {
      await this.dispatchKey(live, message);
    } else if (message.type === "text" || message.type === "type") {
      await live.cdp.send("Input.insertText", { text: message.text });
    } else if (message.type === "paste") {
      await this.dispatchPaste(live, message.text);
    }

    await live.page.waitForLoadState("domcontentloaded", { timeout: 1_000 }).catch(() => undefined);
    await this.updateTitle(live);
    await this.broadcastState(live);
  }

  async close(): Promise<void> {
    const liveBrowsers = await Promise.allSettled(this.liveBrowsers.values());
    this.liveBrowsers.clear();
    await Promise.all(
      liveBrowsers.map(async (result) => {
        if (result.status === "fulfilled") await result.value.context.close().catch(() => undefined);
      }),
    );
  }

  private async liveBrowserFor(session: BrowserSession): Promise<LiveBrowser> {
    const key = session.profilePath;
    let pending = this.liveBrowsers.get(key);
    if (!pending) {
      pending = this.createLiveBrowser(session).catch((error) => {
        this.liveBrowsers.delete(key);
        throw error;
      });
      this.liveBrowsers.set(key, pending);
    }
    return pending;
  }

  private async createLiveBrowser(session: BrowserSession): Promise<LiveBrowser> {
    const executablePath = this.requireExecutablePath();
    await mkdir(resolve(this.profilesRoot, encodeURIComponent(session.workspaceId)), { recursive: true });
    const userDataDir = join(session.profilePath, "chromium");
    await mkdir(userDataDir, { recursive: true });
    await clearChromiumSingletonFiles(userDataDir);
    const context = await chromium.launchPersistentContext(userDataDir, {
      executablePath,
      headless: true,
      viewport: { width: DEFAULT_VIEWPORT.width, height: DEFAULT_VIEWPORT.height },
      deviceScaleFactor: DEFAULT_VIEWPORT.deviceScaleFactor,
      ignoreHTTPSErrors: true,
      args: [
        "--disable-background-networking",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--no-default-browser-check",
        "--no-first-run",
      ],
    });
    const page = context.pages()[0] ?? (await context.newPage());
    await page.setViewportSize({ width: DEFAULT_VIEWPORT.width, height: DEFAULT_VIEWPORT.height });
    const cdp = await context.newCDPSession(page);
    const live: LiveBrowser = {
      context,
      page,
      cdp,
      session,
      currentUrl: null,
      title: session.title,
      loading: false,
      viewport: DEFAULT_VIEWPORT,
      screencastStarted: false,
      lastFrame: null,
      subscribers: new Map(),
      persistSubscriberId: null,
    };
    this.bindPageEvents(live);
    return live;
  }

  private bindPageEvents(live: LiveBrowser): void {
    live.page.on("request", (request) => {
      if (!request.isNavigationRequest() || request.frame() !== live.page.mainFrame()) return;
      live.loading = true;
      void this.broadcastState(live);
    });
    live.page.on("domcontentloaded", () => {
      live.loading = false;
      void this.updateTitle(live).finally(() => this.broadcastState(live));
    });
    live.page.on("load", () => {
      live.loading = false;
      void this.updateTitle(live).finally(() => this.broadcastState(live));
    });
    live.page.on("framenavigated", (frame) => {
      if (!isMainFrame(live.page, frame)) return;
      void this.handleNavigation(live);
    });
    live.page.on("crash", () => {
      void this.broadcast(live, { type: "error", message: "Chromium page crashed." });
    });
  }

  private async startScreencast(live: LiveBrowser): Promise<void> {
    if (live.screencastStarted) return;
    live.screencastStarted = true;
    await live.cdp.send("Page.enable");
    live.cdp.on("Page.screencastFrame", (event) => {
      void this.handleScreencastFrame(live, event as ScreencastEvent);
    });
    await live.cdp.send("Page.startScreencast", { format: "png", everyNthFrame: 1 });
  }

  private async handleScreencastFrame(live: LiveBrowser, event: ScreencastEvent): Promise<void> {
    try {
      // Chromium's screencast metadata may describe a requested viewport while
      // its encoded PNG still contains an older compositor surface.
      const dimensions = pngDimensions(event.data);
      if (!dimensions) {
        await this.log("browser chromium screencast produced an invalid PNG frame");
        return;
      }
      const frame: BrowserFrameMessage = {
        type: "frame",
        url: browserStoredUrl(live.page.url()),
        image: `data:image/png;base64,${event.data}`,
        mimeType: "image/png",
        renderer: "chromium",
        width: dimensions.width,
        height: dimensions.height,
        ts: Date.now(),
      };
      live.currentUrl = live.page.url();
      live.lastFrame = frame;
      await this.broadcast(live, frame);
    } finally {
      await live.cdp.send("Page.screencastFrameAck", { sessionId: event.sessionId }).catch(async (error) => {
        await this.log(`browser chromium screencast ack failed: ${errorMessage(error)}`);
      });
    }
  }

  private async ensurePageUrl(live: LiveBrowser, url: string): Promise<void> {
    const targetUrl = browserRuntimeUrl(url);
    if (live.currentUrl === targetUrl && live.page.url() === targetUrl) return;
    live.loading = true;
    await this.broadcastState(live);
    await live.page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 12_000 });
    live.currentUrl = live.page.url();
    live.loading = false;
    await this.updateTitle(live);
  }

  private async setViewport(live: LiveBrowser, message: BrowserViewportMessage): Promise<void> {
    const viewport = sanitizeViewport(message);
    if (
      viewport.width === live.viewport.width &&
      viewport.height === live.viewport.height &&
      viewport.deviceScaleFactor === live.viewport.deviceScaleFactor
    ) {
      return;
    }
    live.viewport = viewport;
    await live.page.setViewportSize({ width: viewport.width, height: viewport.height });
    await live.cdp.send("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: viewport.deviceScaleFactor,
      mobile: false,
    });

    // Force the requested capture rectangle; Chromium can temporarily expose
    // a shorter compositor surface immediately after a viewport resize.
    // Never publish claimed dimensions unless the PNG actually matches them.
    let data = "";
    let actual: { width: number; height: number } | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const result = (await live.cdp.send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: true,
        fromSurface: true,
        clip: { x: 0, y: 0, width: viewport.width, height: viewport.height, scale: 1 },
      })) as { data: string };
      data = result.data;
      actual = pngDimensions(data);
      if (actual?.width === viewport.width && actual.height === viewport.height) break;
      if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (actual?.width !== viewport.width || actual.height !== viewport.height) {
      throw new Error(
        `Chromium resize capture dimensions: expected ${viewport.width}x${viewport.height}, got ${actual ? `${actual.width}x${actual.height}` : "invalid PNG"}`,
      );
    }
    const frame: BrowserFrameMessage = {
      type: "frame",
      url: browserStoredUrl(live.page.url()),
      image: `data:image/png;base64,${data}`,
      mimeType: "image/png",
      renderer: "chromium",
      width: actual.width,
      height: actual.height,
      ts: Date.now(),
    };
    live.currentUrl = live.page.url();
    live.lastFrame = frame;
    await this.broadcast(live, frame);
  }

  private async dispatchMouse(live: LiveBrowser, message: BrowserMouseMessage): Promise<void> {
    const button = message.button ?? "left";
    const point = viewportPoint(live, message.x, message.y);
    const eventType =
      message.event === "move"
        ? "mouseMoved"
        : message.event === "down"
          ? "mousePressed"
          : message.event === "up"
            ? "mouseReleased"
            : "mousePressed";
    await live.cdp.send("Input.dispatchMouseEvent", {
      type: eventType,
      x: point.x,
      y: point.y,
      button,
      clickCount: message.event === "dblclick" ? 2 : 1,
      modifiers: modifiersMask(message.modifiers),
    });
    if (message.event === "dblclick") {
      await live.cdp.send("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: point.x,
        y: point.y,
        button,
        clickCount: 2,
        modifiers: modifiersMask(message.modifiers),
      });
    }
  }

  private async dispatchLegacyClick(
    live: LiveBrowser,
    message: { type: "click"; x: number; y: number; button?: "left" | "middle" | "right" },
  ): Promise<void> {
    const point = viewportPoint(live, message.x, message.y);
    await live.cdp.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: point.x,
      y: point.y,
      button: message.button ?? "left",
      clickCount: 1,
    });
    await live.cdp.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: point.x,
      y: point.y,
      button: message.button ?? "left",
      clickCount: 1,
    });
  }

  private async dispatchWheel(live: LiveBrowser, message: BrowserWheelMessage): Promise<void> {
    const point = viewportPoint(live, message.x, message.y);
    await live.cdp.send("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: point.x,
      y: point.y,
      deltaX: message.deltaX,
      deltaY: message.deltaY,
      modifiers: modifiersMask(message.modifiers),
    });
  }

  private async dispatchKey(live: LiveBrowser, message: BrowserKeyMessage): Promise<void> {
    const type = message.event === "down" ? "keyDown" : "keyUp";
    await live.cdp.send("Input.dispatchKeyEvent", {
      type,
      key: message.key,
      code: message.code ?? message.key,
      windowsVirtualKeyCode: virtualKeyCode(message.key),
      nativeVirtualKeyCode: virtualKeyCode(message.key),
      modifiers: modifiersMask(message.modifiers),
    });
  }

  private async dispatchPaste(live: LiveBrowser, text: string): Promise<void> {
    await live.page.evaluate((value) => {
      const active = document.activeElement;
      const target = active instanceof HTMLElement ? active : document.body;
      const data = new DataTransfer();
      data.setData("text/plain", value);
      const event = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: data,
      });
      const accepted = target.dispatchEvent(event);
      if (accepted) document.execCommand("insertText", false, value);
    }, text);
  }

  private async handleNavigation(live: LiveBrowser): Promise<void> {
    live.currentUrl = live.page.url();
    live.loading = false;
    await this.updateTitle(live);
    const url = browserStoredUrl(live.page.url());
    if (url !== live.session.url) {
      const subscriber = live.persistSubscriberId === null ? null : live.subscribers.get(live.persistSubscriberId);
      if (subscriber?.onNavigation) {
        live.session = await subscriber.onNavigation(url, live.title);
      }
    }
    await this.broadcastState(live);
  }

  private async updateTitle(live: LiveBrowser): Promise<void> {
    live.title = (await live.page.title().catch(() => "")) || live.session.title;
  }

  private async stateForLive(live: LiveBrowser): Promise<BrowserStateMessage> {
    await this.updateTitle(live);
    return {
      type: "state",
      browser: live.session,
      renderer: "chromium",
      title: live.title,
      loading: live.loading,
    };
  }

  private async broadcastState(live: LiveBrowser): Promise<void> {
    await this.broadcast(live, await this.stateForLive(live));
  }

  private async broadcast(live: LiveBrowser, message: BrowserServerMessage): Promise<void> {
    await Promise.all([...live.subscribers.values()].map((subscriber) => this.sendToSubscriber(subscriber, message)));
  }

  private async sendToSubscriber(subscriber: BrowserStreamSubscriber, message: BrowserServerMessage): Promise<void> {
    await subscriber.send(message);
  }

  private requireExecutablePath(): string {
    if (!this.executablePath) {
      throw new Error("Chromium executable not found. Install Playwright Chromium or set CHROMIUM_EXECUTABLE_PATH.");
    }
    return this.executablePath;
  }
}

function findChromiumExecutable(): string | null {
  const candidates = [
    process.env.CHROMIUM_EXECUTABLE_PATH,
    safePlaywrightChromiumPath(),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ].filter((candidate): candidate is string => Boolean(candidate));
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function safePlaywrightChromiumPath(): string | null {
  try {
    const path = chromium.executablePath();
    return existsSync(path) ? path : null;
  } catch {
    return null;
  }
}

function sanitizeViewport(message: BrowserViewportMessage): BrowserViewport {
  return {
    width: clamp(Math.floor(message.width), 1, MAX_VIEWPORT.width),
    height: clamp(Math.floor(message.height), 1, MAX_VIEWPORT.height),
    deviceScaleFactor: clamp(message.deviceScaleFactor ?? 1, 0.25, 4),
  };
}

function viewportPoint(live: LiveBrowser, x: number, y: number): { x: number; y: number } {
  return {
    x: clamp(x, 0, live.viewport.width),
    y: clamp(y, 0, live.viewport.height),
  };
}

function modifiersMask(modifiers: BrowserModifiers | undefined): number {
  if (typeof modifiers === "number" && Number.isFinite(modifiers)) return Math.floor(modifiers);
  if (!Array.isArray(modifiers)) return 0;
  let mask = 0;
  if (modifiers.includes("Alt")) mask |= 1;
  if (modifiers.includes("Control")) mask |= 2;
  if (modifiers.includes("Meta")) mask |= 4;
  if (modifiers.includes("Shift")) mask |= 8;
  return mask;
}

function virtualKeyCode(key: string): number {
  if (key.length === 1) return key.toUpperCase().charCodeAt(0);
  const known: Record<string, number> = {
    Backspace: 8,
    Tab: 9,
    Enter: 13,
    Shift: 16,
    Control: 17,
    Alt: 18,
    Escape: 27,
    Space: 32,
    " ": 32,
    ArrowLeft: 37,
    ArrowUp: 38,
    ArrowRight: 39,
    ArrowDown: 40,
    Delete: 46,
  };
  return known[key] ?? 0;
}

function isMainFrame(page: Page, frame: Frame): boolean {
  return frame === page.mainFrame();
}

function pngDimensions(base64: string): { width: number; height: number } | null {
  // The first 32 base64 characters cover the PNG signature and IHDR dimensions.
  const header = Buffer.from(base64.slice(0, 32), "base64");
  if (
    header.length < 24 ||
    header.toString("hex", 0, 8) !== "89504e470d0a1a0a" ||
    header.toString("ascii", 12, 16) !== "IHDR"
  ) {
    return null;
  }
  const width = header.readUInt32BE(16);
  const height = header.readUInt32BE(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function clearChromiumSingletonFiles(profilePath: string): Promise<void> {
  await Promise.all(
    ["SingletonCookie", "SingletonLock", "SingletonSocket"].map((name) =>
      rm(join(profilePath, name), { force: true, recursive: true }),
    ),
  );
}
