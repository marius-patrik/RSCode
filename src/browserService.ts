import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { BrowserSession } from "@/schema.ts";

export type BrowserFrameMessage = {
  type: "frame";
  url: string;
  image: string;
  mimeType: "image/png" | "image/svg+xml";
  renderer: "chromium" | "fallback";
  ts: number;
};

export type BrowserStateMessage = {
  type: "state";
  browser: BrowserSession;
  renderer: "chromium" | "fallback";
};

export type BrowserErrorMessage = {
  type: "error";
  message: string;
};

export class BrowserFrameService {
  readonly executablePath = findChromiumExecutable();

  constructor(
    private readonly profilesRoot: string,
    private readonly log: (line: string) => void | Promise<void>,
  ) {}

  renderer(): "chromium" | "fallback" {
    return this.executablePath ? "chromium" : "fallback";
  }

  async frameFor(session: BrowserSession): Promise<BrowserFrameMessage> {
    await mkdir(session.profilePath, { recursive: true });
    if (this.executablePath) {
      try {
        const image = await this.captureWithChromium(session.url, session.profilePath);
        return {
          type: "frame",
          url: session.url,
          image,
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
    return {
      type: "state",
      browser: session,
      renderer: this.renderer(),
    };
  }

  private async captureWithChromium(url: string, profilePath: string): Promise<string> {
    if (!this.executablePath) throw new Error("Chromium executable not configured");
    const captureDir = join(profilePath, "captures");
    await mkdir(captureDir, { recursive: true });
    const screenshotPath = join(captureDir, `${Date.now().toString(36)}.png`);
    const targetUrl = normalizeBrowserUrl(url);
    const proc = Bun.spawn(
      [
        this.executablePath,
        "--headless=new",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--hide-scrollbars",
        "--no-first-run",
        "--no-default-browser-check",
        "--window-size=1280,720",
        `--user-data-dir=${profilePath}`,
        `--screenshot=${screenshotPath}`,
        targetUrl,
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
    }, 12_000);
    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]).finally(() => clearTimeout(timer));
    void stdout;
    if (timedOut) throw new Error("timed out waiting for Chromium screenshot");
    if (exitCode !== 0) throw new Error(stderr.trim() || `Chromium exited ${exitCode}`);

    const bytes = await readFile(screenshotPath);
    await rm(screenshotPath, { force: true });
    return `data:image/png;base64,${bytes.toString("base64")}`;
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

function fallbackSvgDataUrl(url: string): string {
  const escaped = escapeXml(url || "about:blank");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <rect width="1280" height="720" fill="#101319"/>
  <rect x="0" y="0" width="1280" height="54" fill="#181c24"/>
  <rect x="18" y="15" width="14" height="14" rx="7" fill="#ef4444"/>
  <rect x="42" y="15" width="14" height="14" rx="7" fill="#f59e0b"/>
  <rect x="66" y="15" width="14" height="14" rx="7" fill="#22c55e"/>
  <rect x="104" y="12" width="1058" height="30" rx="6" fill="#0d1117" stroke="#2b3240"/>
  <text x="120" y="32" fill="#d7dde8" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="14">${escaped}</text>
  <text x="44" y="132" fill="#f4f7fb" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="30">Browser pane</text>
  <text x="44" y="174" fill="#9aa4b2" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="16">Chromium was not available; this fallback frame preserves browser pane state and navigation.</text>
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
