import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
const fixture = JSON.parse(readFileSync(new URL("./fixtures/ghc00-synthetic-v2.json", import.meta.url), "utf8"));
import { inspectWorkbench } from "./ghc00-db-inspection";

/**
 * Synthetic, clean-origin v2 -> future v3 acceptance.
 * The six legacy stores and unattributed localStorage must not be destroyed
 * or silently claimed by whichever GitHub account next authenticates.
 */
test("GHC-02 migration: v2 data is quarantined losslessly without current-principal attribution", async ({ page }) => {
  await page.route("**/__ghc00_seed", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<html><body>GHC-00 seed</body></html>" }),
  );
  await page.route("https://api.github.com/**", (route) =>
    route.fulfill({ status: 404, contentType: "application/json", body: '{"message":"denied"}' }),
  );
  await page.goto("/__ghc00_seed");
  const input = {
    workspaces: fixture.workspaces,
    blobs: fixture.blobs,
    overlays: fixture.overlays,
    staged: fixture.staged,
    committed: fixture.committed,
    commits: fixture.commits,
  };
  await page.evaluate(async (data) => {
    const stores = Object.keys(data) as Array<keyof typeof data>;
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open("darkfactory-workbench", 2);
      open.onupgradeneeded = () => {
        const database = open.result;
        for (const name of stores) {
          database.createObjectStore(name, { keyPath: name === "workspaces" || name === "commits" ? "id" : "key" });
        }
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error ?? new Error("v2 fixture seed open failed"));
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(stores, "readwrite");
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("v2 seed error"));
        tx.onabort = () => reject(tx.error ?? new Error("v2 seed aborted"));
        for (const name of stores) {
          for (const value of data[name]) tx.objectStore(name).put(value);
        }
      });
    } finally {
      db.close();
    }
  }, input);

  const recent = JSON.stringify(fixture.localStorage["workbench-recent-workspaces-v1"]);
  await page.evaluate((value) => {
    localStorage.setItem("workbench-recent-workspaces-v1", value);
  }, recent);
  await page.goto("/");
  const migrated = await inspectWorkbench(page);
  expect(migrated.version).toBeGreaterThanOrEqual(3);
  // Physical schema count/names for new stores are deliberately unspecified.
  for (const [name, values] of Object.entries(input)) {
    const actual = migrated.stores.find((store) => store.name === name);
    expect(actual, "legacy v2 store retained: " + name).toBeDefined();
    expect(actual?.records).toEqual(values);
  }
  await expect(page.locator(".workspace-repository-button")).not.toContainText("acme/private");
  await expect(page.locator(".view-lines")).not.toContainText("SYNTHETIC_PRIVATE_A");
  expect(await page.evaluate(() => localStorage.getItem("workbench-recent-workspaces-v1"))).toBe(recent);
  // Re-entering the app must not double-import or consume the unattributed input.
  await page.reload();
  const retried = await inspectWorkbench(page);
  expect(retried.version).toBeGreaterThanOrEqual(migrated.version);
  for (const [name, values] of Object.entries(input)) {
    expect(retried.stores.find((store) => store.name === name)?.records).toEqual(values);
  }
});
