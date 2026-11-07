// Real Chromium acceptance for an injected asynchronous Canvas repository adapter.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const require = createRequire(resolve("package.json"));
const { chromium } = require("playwright");
const bundle = readFileSync(resolve(process.argv[2] || "../../.github/tests/runtime-repository-browser.bundle.js"), "utf8");
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
const exceptions = [];
page.on("pageerror", (error) => exceptions.push(error.message));
page.setDefaultTimeout(10000);
try {
  await page.goto("about:blank");
  await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>');
  await page.addScriptTag({ content: bundle, type: "module" });
  await page.locator("#repo-b").waitFor();
  // Switching before the initial A fetch completes must not reveal A's private content.
  await page.locator("#repo-b").click();
  await page.waitForFunction(() => document.querySelector("#source")?.textContent === "PRIVATE_SOURCE_202");
  if (await page.locator("#selected").innerText() !== "202")
    throw new Error("Immutable B identity not selected");
  await page.waitForTimeout(350);
  if (await page.locator("#source").innerText() !== "PRIVATE_SOURCE_202")
    throw new Error("Stale A fetch leaked contents after repository B switch");

  // Switching back must clear B content immediately, then load A under new identity.
  await page.locator("#repo-a").click();
  if (await page.locator("#source").innerText() !== "")
    throw new Error("Repository B content was not cleared at the A selection boundary");
  await page.waitForFunction(() => document.querySelector("#source")?.textContent === "PRIVATE_SOURCE_101");

  // Malformed selection must invalidate the prior in-flight A promise even
  // though it does not select a replacement repository.
  await page.locator("#repo-b").click();
  await page.waitForFunction(() => document.querySelector("#source")?.textContent === "PRIVATE_SOURCE_202");
  await page.locator("#repo-a").click();
  await page.locator("#repo-invalid").click();
  await page.waitForTimeout(350);
  if (await page.locator("#selected").innerText() !== "none" ||
      await page.locator("#source").innerText() !== "")
    throw new Error("Pending A request leaked private source after malformed identity revocation");
  if (!(await page.getByRole("alert").innerText()).includes("Invalid repository identity"))
    throw new Error("Malformed identity was not rejected");

  // An adapter response forged for A while C is selected must be rejected.
  await page.locator("#repo-forged").click();
  if (await page.locator("#source").innerText() !== "")
    throw new Error("Private A source visible while C is unresolved");
  await page.getByRole("alert").waitFor();
  if (!(await page.getByRole("alert").innerText()).includes("immutable identity"))
    throw new Error("Forged runtime repository identity not rejected");
  if (await page.locator("#source").innerText() !== "")
    throw new Error("Forged response exposed a private repository document");

  // Recovery after an invalid adapter result must retain no old document state.
  await page.locator("#repo-b").click();
  await page.waitForFunction(() => document.querySelector("#source")?.textContent === "PRIVATE_SOURCE_202");
  if (await page.getByRole("alert").count())
    throw new Error("Old forged adapter error persisted into the next valid selection");
  if (exceptions.length) throw new Error("Chromium page exceptions: " + exceptions.join("; "));
  console.log(JSON.stringify({ browser: "Chromium", adapter: "INJECTED", staleA: "REJECTED",
    forgedC: "REJECTED", recovery: "PASS", secondWriter: "NONE", result: "PASS" }));
} finally {
  await browser.close();
}
