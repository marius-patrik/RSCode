import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-chromium";

const mode = process.argv[2];
if (mode !== "first" && mode !== "restart") throw new Error("Expected first or restart probe mode");
const canvasHome = process.env.CANVAS_HOME;
if (!canvasHome) throw new Error("CANVAS_HOME missing");
const profile = join(canvasHome, "distribution-browser-probe");
await mkdir(profile, { recursive: true });
const context = await chromium.launchPersistentContext(profile, {
  headless: true,
  args: ["--disable-dev-shm-usage"],
});
try {
  const page = context.pages()[0] ?? await context.newPage();
  const response = await page.goto(`http://127.0.0.1:${process.env.CANVAS_PORT}/`, { waitUntil: "domcontentloaded", timeout: 20000 });
  if (!response || !response.ok()) throw new Error("Frontend not available in bundled Chromium");
  await page.getByPlaceholder("Search files or web, / commands, > terminal").waitFor({ timeout: 15000 });
  const html = await page.locator("body").innerText();
  if (!html.trim()) throw new Error("Bundled browser rendered an empty application");
  const storage = await page.evaluate((probeMode) => {
    const prior = localStorage.getItem("rscode-distribution-probe");
    if (probeMode === "first") localStorage.setItem("rscode-distribution-probe", "persisted");
    return prior;
  }, mode);
  if (mode === "restart" && storage !== "persisted") throw new Error("Persistent Chromium profile did not survive restart");
  console.log(JSON.stringify({ chromium: "PASS", ui: "PASS", browserProfile: mode === "restart" ? "PRESERVED" : "CREATED" }));
} finally {
  await context.close();
}
