import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { browserRuntimeUrl, browserStoredUrl } from "@/shared/browser";
import type { BrowserSession } from "@/shared/schema";
import { type BrowserContext, type Page, chromium } from "playwright-chromium";

type BrowserRenderer = "chromium";

export type BrowserFrameMessage = {
  type: "frame";
  url: string;
  image: string;
  mimeType: "image/png";
  renderer: BrowserRenderer;
  ts: number;
};

export type BrowserStateMessage = {
  type: "state";
  browser: BrowserSession;
  renderer: BrowserRenderer;
};

export type BrowserErrorMessage = {
  type: "error";
  message: string;
};

export type BrowserInteractionMessage =
  | { type: "reload"; url?: string }
  | { type: "click"; x: number; y: number; button?: "left" | "middle" | "right" }
  | { type: "wheel"; x: number; y: number; deltaX: number; deltaY: number }
  | { type: "key"; key: string }
  | { type: "type"; text: string };

type LiveBrowser = {
  context: BrowserContext;
  page: Page;
  currentUrl: string | null;
};

const VIEWPORT = { width: 1280, height: 720 };

export class BrowserFrameService {
  readonly executablePath = findChromiumExecutable();
  private readonly liveBrowsers = new Map<string, Promise<LiveBrowser>>();

  constructor(
    private readonly profilesRoot: string,
    private readonly log: (line: string) => void | Promise<void>,
  ) {}

  async frameFor(session: BrowserSession): Promise<BrowserFrameMessage> {
    const live = await this.liveBrowserFor(session);
    await this.ensurePageUrl(live, session.url);
    return this.captureFrame(live);
  }

  async stateFor(session: BrowserSession): Promise<BrowserStateMessage> {
    this.requireExecutablePath();
    await mkdir(resolve(this.profilesRoot, encodeURIComponent(session.workspaceId)), { recursive: true });
    return {
      type: "state",
      browser: session,
      renderer: "chromium",
    };
  }

  async interact(session: BrowserSession, message: BrowserInteractionMessage): Promise<BrowserFrameMessage> {
    const live = await this.liveBrowserFor(session);
    await this.ensurePageUrl(live, session.url);
    if (message.type === "reload") {
      if (message.url) await this.ensurePageUrl(live, message.url);
      await live.page.reload({ waitUntil: "domcontentloaded", timeout: 12_000 }).catch(() => undefined);
    } else if (message.type === "click") {
      await live.page.mouse.click(clamp(message.x, 0, VIEWPORT.width), clamp(message.y, 0, VIEWPORT.height), {
        button: message.button ?? "left",
      });
    } else if (message.type === "wheel") {
      await live.page.mouse.move(clamp(message.x, 0, VIEWPORT.width), clamp(message.y, 0, VIEWPORT.height));
      await live.page.mouse.wheel(message.deltaX, message.deltaY);
    } else if (message.type === "key") {
      await live.page.keyboard.press(message.key);
    } else if (message.type === "type") {
      await live.page.keyboard.type(message.text);
    }
    await live.page.waitForLoadState("domcontentloaded", { timeout: 3_000 }).catch(() => undefined);
    live.currentUrl = live.page.url();
    return this.captureFrame(live);
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
    const userDataDir = join(session.profilePath, "chromium");
    await mkdir(userDataDir, { recursive: true });
    await clearChromiumSingletonFiles(userDataDir);
    const context = await chromium.launchPersistentContext(userDataDir, {
      executablePath,
      headless: true,
      viewport: VIEWPORT,
      deviceScaleFactor: 1,
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
    await page.setViewportSize(VIEWPORT);
    return { context, page, currentUrl: null };
  }

  private async ensurePageUrl(live: LiveBrowser, url: string): Promise<void> {
    const targetUrl = browserRuntimeUrl(url);
    if (live.currentUrl === targetUrl && live.page.url() === targetUrl) return;
    await live.page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 12_000 });
    live.currentUrl = targetUrl;
  }

  private async captureFrame(live: LiveBrowser): Promise<BrowserFrameMessage> {
    const bytes = await live.page.screenshot({ type: "png", fullPage: false }).catch(async (error) => {
      await this.log(`browser chromium capture failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    });
    live.currentUrl = live.page.url();
    return {
      type: "frame",
      url: browserStoredUrl(live.page.url()),
      image: `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`,
      mimeType: "image/png",
      renderer: "chromium",
      ts: Date.now(),
    };
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

async function clearChromiumSingletonFiles(profilePath: string): Promise<void> {
  await Promise.all(
    ["SingletonCookie", "SingletonLock", "SingletonSocket"].map((name) =>
      rm(join(profilePath, name), { force: true, recursive: true }),
    ),
  );
}
