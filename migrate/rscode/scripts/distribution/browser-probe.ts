import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-chromium";

const mode = process.argv[2];
if (mode !== "first" && mode !== "restart") throw new Error("Expected first or restart probe mode");
const canvasHome = process.env.CANVAS_HOME;
if (!canvasHome) throw new Error("CANVAS_HOME missing");
const profile = join(canvasHome, "distribution-browser-probe");
await mkdir(profile, { recursive: true });
console.error(`[native-browser-probe] ${mode}: launching Chromium persistent context`);
const context = await chromium.launchPersistentContext(profile, {
  timeout: 25_000,
  // The Windows headless-shell process starts but fails its Playwright CDP
  // handshake on Windows-2025. Prefer the bundled full Chromium in new headless
  // mode there; the source package already provisions both browser builds.
  channel: process.platform === "win32" ? "chromium" : undefined,
  headless: true,
  args: ["--disable-dev-shm-usage"],
});
console.error(`[native-browser-probe] ${mode}: Chromium context launched`);
try {
  const page = context.pages()[0] ?? await context.newPage();
  console.error(`[native-browser-probe] ${mode}: navigating to installed frontend`);
  const response = await page.goto(`http://127.0.0.1:${process.env.CANVAS_PORT}/`, { waitUntil: "domcontentloaded", timeout: 20000 });
  if (!response || !response.ok()) throw new Error("Frontend not available in bundled Chromium");
  console.error(`[native-browser-probe] ${mode}: waiting for UI selector`);
  await page.getByPlaceholder("Search files or web, / commands, > terminal").waitFor({ timeout: 15000 });
  const html = await page.locator("body").innerText();
  if (!html.trim()) throw new Error("Bundled browser rendered an empty application");
  console.error(`[native-browser-probe] ${mode}: reading persistent browser storage`);
  const storage = await page.evaluate((probeMode) => {
    const prior = localStorage.getItem("rscode-distribution-probe");
    if (probeMode === "first") localStorage.setItem("rscode-distribution-probe", "persisted");
    return prior;
  }, mode);
  if (mode === "restart" && storage !== "persisted") throw new Error("Persistent Chromium profile did not survive restart");
  console.log(JSON.stringify({ chromium: "PASS", ui: "PASS", browserProfile: mode === "restart" ? "PRESERVED" : "CREATED" }));
} finally {
  console.error(`[native-browser-probe] ${mode}: closing Chromium context`);
  await context.close();
  console.error(`[native-browser-probe] ${mode}: Chromium context closed`);
}
