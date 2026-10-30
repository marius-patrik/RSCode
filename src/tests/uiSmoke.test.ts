import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-chromium";

const uiSmoke = process.env.CANVAS_UI_SMOKE === "1" ? test : test.skip;

uiSmoke(
  "Canvas boots in Chromium, supports pane/canvas navigation and captures desktop/mobile snapshots",
  async () => {
    const home = await mkdtemp(join(tmpdir(), "canvas-ui-smoke-"));
    const port = await freePort();
    const server = Bun.spawn(["bun", "src/server/index.ts"], {
      env: { ...process.env, CANVAS_HOME: home, CANVAS_PORT: String(port) },
      stdout: "pipe",
      stderr: "pipe",
    });
    let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
    try {
      await waitForHealth(port);
      browser = await chromium.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
      });
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const response = await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
      if (!response?.ok()) {
        const bodyText = await page.locator("body").innerText().catch(() => "");
        throw new Error(`Canvas UI HTTP ${response?.status()}: ${bodyText.slice(0, 500)}`);
      }
      const launcher = page.getByPlaceholder("Search files or web, / commands, > terminal");
      await launcher.waitFor({ state: "visible", timeout: 12_000 });
      await page.getByTitle("Switch to canvas").click();
      await page.getByTitle("Switch to panes").click();
      await page.getByTitle("Settings").click();
      expect(await page.locator("main").count()).toBeGreaterThan(0);
      expect(errors).toEqual([]);

      // Retain evidence in GitHub CI artifacts; source files remain untouched.
      const snapshotDir = "dist/visual-smoke";
      await mkdir(snapshotDir, { recursive: true });
      await page.screenshot({ path: join(snapshotDir, "desktop.png"), fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await launcher.waitFor({ state: "visible" });
      await page.screenshot({ path: join(snapshotDir, "mobile.png"), fullPage: true });
      expect(errors).toEqual([]);
    } finally {
      await browser?.close();
      if (!server.killed) server.kill("SIGTERM");
      await Promise.race([server.exited, Bun.sleep(5_000)]);
      if (!server.killed) server.kill("SIGKILL");
      await rm(home, { recursive: true, force: true });
    }
  },
  45_000,
);

async function waitForHealth(port: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch {
      // API is still starting.
    }
    await Bun.sleep(100);
  }
  throw new Error("Canvas UI did not start");
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("unable to allocate port")));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}
