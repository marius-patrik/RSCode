import { expect, test, type Page } from "@playwright/test";
import { installGithubMock, MOCK_REPOSITORY } from "./github-mock";

/**
 * GHC-00 evidence tests. All accounts, tokens, repositories and contents are synthetic.
 * Tests encode the REQUIRED safety invariant. A failure is evidence, not a reason
 * to weaken the assertion or alter production implementation in this dispatch.
 */
const surface = (page: Page, kind: "main" | "primary") =>
  page.locator(`[data-workbench-surface="${kind}"]`);

async function installAccountA(page: Page) {
  await installGithubMock(page);
  await page.evaluate(() => {
    sessionStorage.setItem("workbench-github-token", JSON.stringify({ token: "test-token" }));
  });
  await page.reload();
  await expect(page.getByTitle("Sign out")).toContainText("octocat");
}

async function openSyntheticPrivateRepo(page: Page) {
  await page.locator(".workspace-repository-button").click();
  await page.getByRole("textbox", { name: "Repository" }).fill(MOCK_REPOSITORY);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.locator(".workspace-repository-button")).toContainText(MOCK_REPOSITORY);
}

async function openReadme(page: Page) {
  await surface(page, "primary").locator(".dv-tab").filter({ hasText: "Explorer" }).first().click();
  await surface(page, "primary").getByTitle("README.md").click();
  await expect(surface(page, "main").locator(".dv-tab").filter({ hasText: "README.md" }).first()).toBeVisible();
  await expect(surface(page, "main").locator(".monaco-editor").last()).toBeVisible();
}

async function storeRecords(page: Page, store: string) {
  return page.evaluate(async (name) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("darkfactory-workbench", 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
        const transaction = database.transaction(name, "readonly");
        const request = transaction.objectStore(name).getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  }, store);
}

async function editSyntheticReadme(page: Page, content: string) {
  const editor = surface(page, "main").locator(".monaco-editor").last();
  await editor.click();
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText(content);
  await expect(editor.locator(".view-lines")).toContainText(content.trim());
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();
});

test("GHC-00 private cached workspace is not exposed to an anonymous session after sign-out", async ({ page }) => {
  await installAccountA(page);
  await openSyntheticPrivateRepo(page);
  await openReadme(page);
  // The private source blob has now been retrieved and cached for Account A.
  expect((await storeRecords(page, "blobs")).length).toBeGreaterThan(0);

  await page.getByTitle("Sign out").click();
  await expect(page.getByTitle("Sign in with GitHub")).toBeVisible();
  await page.reload();
  // Synthetic private blob remains visible to the anonymous browser.
  await openReadme(page);
  await expect(surface(page, "main").locator(".view-lines").last()).toContainText("Private repository");
  // Anonymous users must not be automatically mounted into Account A's private workspace.
  await expect(page.locator(".workspace-repository-button")).not.toContainText(MOCK_REPOSITORY);
});

test("GHC-00 Account B cannot inherit Account A's cached private workspace when GitHub denies access", async ({ page }) => {
  await installAccountA(page);
  await openSyntheticPrivateRepo(page);
  await openReadme(page);

  await page.route("https://api.github.com/**", async (route) => {
    const authorization = route.request().headers().authorization || "";
    if (!authorization.includes("account-b")) return route.fallback();
    const path = new URL(route.request().url()).pathname;
    const fulfill = (body: object, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/user") {
      return fulfill({ login: "account-b", avatar_url: "https://example.invalid/b.png", html_url: "https://github.com/account-b" });
    }
    if (path === "/user/repos") return fulfill([]);
    if (path.startsWith("/repos/acme/private")) return fulfill({ message: "Resource not found for Account B" }, 404);
    return route.fallback();
  });
  await page.evaluate(() => {
    sessionStorage.setItem("workbench-github-token", JSON.stringify({ token: "account-b" }));
  });
  await page.reload();
  await expect(page.getByTitle("Sign out")).toContainText("account-b");
  // Account B was refused by the mock API, but the private cached blob can still render.
  await openReadme(page);
  await expect(surface(page, "main").locator(".view-lines").last()).toContainText("Private repository");
  // A local snapshot is NOT an authorization grant to B, even when offline.
  await expect(page.locator(".workspace-repository-button")).not.toContainText(MOCK_REPOSITORY);
});

test("GHC-00 closing an editor before its 250-ms debounce must retain the edited document", async ({ page }) => {
  await installAccountA(page);
  await openSyntheticPrivateRepo(page);
  await openReadme(page);

  // Deterministically prevent the existing 250-ms writer from firing before close.
  await page.evaluate(() => {
    const original = window.setTimeout.bind(window);
    window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) =>
      original(handler, timeout === 250 ? 60_000 : timeout, ...args)) as typeof window.setTimeout;
  });
  const contents = "# SYNTHETIC_EDIT_UNSAVED_BEFORE_CLOSE";
  await editSyntheticReadme(page, contents);
  const readmeTab = surface(page, "main").locator(".dv-tab").filter({ hasText: "README.md" }).first();
  await readmeTab.locator(".dv-default-tab-action").first().click();
  await expect(readmeTab).toHaveCount(0);

  // Durable contents, not a retained Monaco buffer, establish survival.
  const overlays = await storeRecords(page, "overlays");
  expect(overlays.find((item) => item.path === "README.md")?.content).toBe(contents);
});

test("GHC-00 aborted IndexedDB overlay transaction must reject the apparent save", async ({ page }) => {
  await installAccountA(page);
  await openSyntheticPrivateRepo(page);
  await openReadme(page);

  // Abort AFTER the put request succeeds; this is legal IDB ordering.
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    (window as Window & { __ghcAbortCount?: number }).__ghcAbortCount = 0;
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
      const request = key === undefined ? original.call(this, value) : original.call(this, value, key);
      if (this.name === "overlays") {
        request.addEventListener("success", () => {
          (window as Window & { __ghcAbortCount?: number }).__ghcAbortCount! += 1;
          this.transaction.abort();
        });
      }
      return request;
    } as typeof IDBObjectStore.prototype.put;
  });
  await editSyntheticReadme(page, "# SYNTHETIC_IDB_ABORT");
  await expect.poll(() =>
    page.evaluate(() => (window as Window & { __ghcAbortCount?: number }).__ghcAbortCount ?? 0),
  ).toBeGreaterThan(0);
  expect((await storeRecords(page, "overlays")).filter((item) => item.path === "README.md")).toHaveLength(0);
  // A failed durable write MUST surface to the user, never be acknowledged as success.
  await expect(surface(page, "main").getByText(/transaction.*abort|indexeddb.*fail|save.*fail/i)).toBeVisible();
});

test("GHC-00 aborted commit record must not leave partially committed multi-store state", async ({ page }) => {
  await installAccountA(page);
  await openSyntheticPrivateRepo(page);
  await openReadme(page);
  await editSyntheticReadme(page, "# SYNTHETIC_ATOMIC_COMMIT");
  await expect.poll(async () => (await storeRecords(page, "overlays")).length).toBeGreaterThan(0);
  await surface(page, "primary").locator(".dv-tab").filter({ hasText: "Source Control" }).first().click();
  const row = surface(page, "primary").locator(".scm-change-row").filter({ hasText: "README.md" });
  await row.getByTitle("Stage", { exact: true }).click();
  await expect(row.getByTitle("Unstage", { exact: true })).toBeVisible();

  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
      const request = key === undefined ? original.call(this, value) : original.call(this, value, key);
      if (this.name === "commits") {
        request.addEventListener("success", () => this.transaction.abort());
      }
      return request;
    } as typeof IDBObjectStore.prototype.put;
  });
  await surface(page, "primary").getByLabel("Commit message").fill("synthetic atomicity boundary");
  await surface(page, "primary").getByRole("button", { name: /Commit staged/ }).click();
  await expect.poll(async () => {
    const committed = await storeRecords(page, "committed");
    return committed.length;
  }).toBeGreaterThan(0);

  const [commits, committed, staged] = await Promise.all([
    storeRecords(page, "commits"),
    storeRecords(page, "committed"),
    storeRecords(page, "staged"),
  ]);
  // Either the whole commit is durable, or original staged work remains and no
  // committed projection exists. A partial transition is never acceptable.
  expect(commits.length > 0 || (committed.length === 0 && staged.length > 0)).toBe(true);
});

test("GHC-00 a reload before debounce must not silently discard unsaved editor contents", async ({ page }) => {
  await installAccountA(page);
  await openSyntheticPrivateRepo(page);
  await openReadme(page);
  await page.evaluate(() => {
    const original = window.setTimeout.bind(window);
    window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) =>
      original(handler, timeout === 250 ? 60_000 : timeout, ...args)) as typeof window.setTimeout;
  });
  const contents = "# SYNTHETIC_RELOAD_BEFORE_SAVE";
  await editSyntheticReadme(page, contents);
  await page.reload();
  const overlays = await storeRecords(page, "overlays");
  expect(overlays.find((item) => item.path === "README.md")?.content).toBe(contents);
});

test("GHC-00 switching repositories cannot discard a pending private edit", async ({ page }) => {
  await installAccountA(page);
  await openSyntheticPrivateRepo(page);
  await openReadme(page);
  await page.evaluate(() => {
    const original = window.setTimeout.bind(window);
    window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) =>
      original(handler, timeout === 250 ? 60_000 : timeout, ...args)) as typeof window.setTimeout;
  });
  const contents = "# SYNTHETIC_SWITCH_BEFORE_SAVE";
  await editSyntheticReadme(page, contents);
  await page.locator(".workspace-repository-button").click();
  await page.getByRole("textbox", { name: "Repository" }).fill("acme/public");
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.locator(".workspace-repository-button")).toContainText("acme/public");
  const overlays = await storeRecords(page, "overlays");
  expect(overlays.find((item) => item.workspaceId === "acme/private@main" && item.path === "README.md")?.content).toBe(contents);
});

test("GHC-00 storage quota failures must be reported rather than acknowledged as saved", async ({ page }) => {
  await installAccountA(page);
  await openSyntheticPrivateRepo(page);
  await openReadme(page);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
      if (this.name === "overlays") throw new DOMException("Synthetic storage quota exceeded", "QuotaExceededError");
      return key === undefined ? original.call(this, value) : original.call(this, value, key);
    } as typeof IDBObjectStore.prototype.put;
  });
  await editSyntheticReadme(page, "# SYNTHETIC_QUOTA_FAILURE");
  await expect(surface(page, "main").getByText("Synthetic storage quota exceeded")).toBeVisible();
  expect((await storeRecords(page, "overlays")).filter((item) => item.path === "README.md")).toHaveLength(0);
});

test("GHC-00 moving the editor between Dockview surfaces must retain pending contents", async ({ page }) => {
  await installAccountA(page);
  await openSyntheticPrivateRepo(page);
  await openReadme(page);
  await page.evaluate(() => {
    const original = window.setTimeout.bind(window);
    window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) =>
      original(handler, timeout === 250 ? 60_000 : timeout, ...args)) as typeof window.setTimeout;
  });
  const contents = "# SYNTHETIC_MOVE_BEFORE_SAVE";
  await editSyntheticReadme(page, contents);
  const from = surface(page, "main").locator(".dv-tab").filter({ hasText: "README.md" }).first();
  const to = page.locator('[data-workbench-surface="panel"]');
  await expect(to).toBeVisible();
  const box = await to.boundingBox();
  if (!box) throw new Error("No panel drag geometry");
  await from.dragTo(to, {
    force: true,
    targetPosition: {
      x: Math.max(20, Math.min(box.width - 20, box.width / 2)),
      y: Math.max(20, Math.min(box.height - 20, box.height / 2)),
    },
  });
  await expect(to.locator(".dv-tab").filter({ hasText: "README.md" }).first()).toBeVisible();
  const overlays = await storeRecords(page, "overlays");
  expect(overlays.find((item) => item.path === "README.md")?.content).toBe(contents);
});
