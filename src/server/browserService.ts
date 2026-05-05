import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { BrowserSession } from "@/shared/schema";
import { chromium, type BrowserContext, type Page } from "playwright-chromium";

type BrowserRenderer = "chromium" | "fallback";

export type BrowserFrameMessage = {
  type: "frame";
  url: string;
  image: string;
  mimeType: "image/png" | "image/svg+xml";
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

  renderer(): BrowserRenderer {
    return this.executablePath ? "chromium" : "fallback";
  }

  async frameFor(session: BrowserSession): Promise<BrowserFrameMessage> {
    if (this.executablePath) {
      try {
        const live = await this.liveBrowserFor(session);
        await this.ensurePageUrl(live, session.url);
        const bytes = await live.page.screenshot({ type: "png", fullPage: false });
        return {
          type: "frame",
          url: live.page.url(),
          image: `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`,
          mimeType: "image/png",
          renderer: "chromium",
          ts: Date.now(),
        };
      } catch (error) {
        await this.log(`browser chromium capture failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return {
      type: "frame",
      url: session.url,
      image: fallbackSvgDataUrl(session.url),
      mimeType: "image/svg+xml",
      renderer: "fallback",
      ts: Date.now(),
    };
  }

  async stateFor(session: BrowserSession): Promise<BrowserStateMessage> {
    await mkdir(resolve(this.profilesRoot, encodeURIComponent(session.workspaceId)), { recursive: true });
    const live = await this.tryLiveBrowser(session);
    const title = live ? await safePageTitle(live.page, session.title) : session.title;
    return {
      type: "state",
      browser: { ...session, title },
      renderer: live ? "chromium" : "fallback",
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
    return this.frameFor({ ...session, url: live.page.url() });
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

  private async tryLiveBrowser(session: BrowserSession): Promise<LiveBrowser | null> {
    if (!this.executablePath) return null;
    try {
      return await this.liveBrowserFor(session);
    } catch (error) {
      await this.log(`browser chromium launch failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
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
    if (!this.executablePath) throw new Error("Chromium executable not configured");
    await mkdir(session.profilePath, { recursive: true });
    const context = await chromium.launchPersistentContext(session.profilePath, {
      executablePath: this.executablePath,
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
    const targetUrl = normalizeBrowserUrl(url);
    if (live.currentUrl === targetUrl && live.page.url() === targetUrl) return;
    await live.page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 12_000 });
    live.currentUrl = targetUrl;
  }
}

function normalizeBrowserUrl(url: string): string {
  if (!url || url === "about:blank") {
    return "data:text/html,<title>Blank</title><body style='background:%23111111;color:white'></body>";
  }
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(url)) return url;
  return `https://${url}`;
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

function fallbackSvgDataUrl(url: string): string {
  const escaped = escapeXml(url || "about:blank");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <rect width="1280" height="720" fill="#000000"/>
  <rect x="0" y="0" width="1280" height="54" fill="#0d0d0d"/>
  <rect x="104" y="12" width="1058" height="30" rx="6" fill="#000000" stroke="rgba(255,255,255,0.16)"/>
  <text x="120" y="32" fill="#ffffff" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="14">${escaped}</text>
  <text x="44" y="132" fill="#ffffff" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="30">Browser unavailable</text>
  <text x="44" y="174" fill="#9b9b9b" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="16">Install Playwright Chromium or set CHROMIUM_EXECUTABLE_PATH to enable rendered browser panes.</text>
</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

async function safePageTitle(page: Page, fallback: string): Promise<string> {
  try {
    return (await page.title()) || fallback;
  } catch {
    return fallback;
  }
}
