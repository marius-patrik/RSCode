import { expect, test, type Page } from "@playwright/test";
import { installGithubMock, MOCK_REPOSITORY, MOCK_ACCOUNT_A_ID, MOCK_ACCOUNT_B_ID } from "./github-mock";
import { frozenV2Records, persistedMarker, inspectWorkbench } from "./ghc00-db-inspection";

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
  await surface(page, "primary").locator(".explorer-entry-main[title=\"README.md\"]").click();
  await expect(surface(page, "main").locator(".dv-tab").filter({ hasText: "README.md" }).first()).toBeVisible();
  await expect(surface(page, "main").locator(".monaco-editor").last()).toBeVisible();
}

// Frozen v2 stores remain readable after migration; do not open a pinned DB version.
async function storeRecords(page: Page, store: string) {
  return frozenV2Records(page, store);
}

async function deferredLegacyDebounce(page: Page) {
  await page.evaluate(() => {
    const original = window.setTimeout.bind(window);
    window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) =>
      original(handler, timeout === 250 ? 60_000 : timeout, ...args)) as typeof window.setTimeout;
  });
}

const unsavedFeedback = (page: Page) =>
  page.getByText(/unsaved|not saved|saving|pending|failed|error|abort|quota|cannot close|keep editing/i).filter({ visible: true }).first();

async function expectGuardedUnsaved(page: Page, content: string) {
  await expect(page.locator(".monaco-editor .view-lines").last()).toContainText(content);
  await expect(unsavedFeedback(page)).toBeVisible();
}

// The real IndexedDB request succeeds before the *actual* transaction aborts.
// No transaction success or completion is synthesized.
async function abortWriteContaining(page: Page, content: string) {
  await page.evaluate((needle) => {
    (window as Window & { __ghcAbortCount?: number }).__ghcAbortCount = 0;
    for (const method of ["put", "add"] as const) {
      const original = IDBObjectStore.prototype[method];
      IDBObjectStore.prototype[method] = function (value: unknown, key?: IDBValidKey) {
        const request = key === undefined ? original.call(this, value) : original.call(this, value, key);
        if (JSON.stringify(value).includes(needle)) {
          request.addEventListener("success", () => {
            const state = window as Window & { __ghcAbortCount?: number };
            state.__ghcAbortCount = (state.__ghcAbortCount ?? 0) + 1;
            if (this.transaction.readyState === "active") this.transaction.abort();
          });
        }
        return request;
      } as typeof IDBObjectStore.prototype.put;
    }
  }, content);
}

async function expectAborted(page: Page) {
  await expect.poll(() => page.evaluate(() =>
    (window as Window & { __ghcAbortCount?: number }).__ghcAbortCount ?? 0
  )).toBeGreaterThan(0);
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

test("GHC-01 isolation: anonymous cannot mount, render or reopen A private workspace", async ({ page }) => {
  expect(MOCK_ACCOUNT_A_ID).not.toBe(MOCK_ACCOUNT_B_ID);
  await installAccountA(page);
  await openSyntheticPrivateRepo(page);
  await openReadme(page);
  await expect(surface(page, "main").locator(".view-lines").last()).toContainText("Private repository");
  const original = (await storeRecords(page, "blobs")).length;
  expect(original).toBeGreaterThan(0);

  await page.getByTitle("Sign out").click();
  await expect(page.getByTitle("Sign in with GitHub")).toBeVisible();
  await page.reload();
  // Prohibited content must never be reopened as a precondition to testing isolation.
  await expect(page.locator(".workspace-repository-button")).not.toContainText(MOCK_REPOSITORY);
  await expect(surface(page, "main").locator(".view-lines")).not.toContainText("Private repository");
  expect((await storeRecords(page, "blobs")).length).toBeGreaterThanOrEqual(original);
  // Exercise the supported repository-open path; the API denies the private repo.
  await page.locator(".workspace-repository-button").click();
  await page.getByRole("textbox", { name: "Repository" }).fill(MOCK_REPOSITORY);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.locator(".workspace-repository-button")).not.toContainText(MOCK_REPOSITORY);
  await expect(surface(page, "main").locator(".view-lines")).not.toContainText("Private repository");
});


test("GHC-01 isolation: B's numeric ID, denied 404 and matching name do not authorize A cache", async ({ page }) => {
  await installAccountA(page);
  await openSyntheticPrivateRepo(page);
  await openReadme(page);
  const legacy = (await storeRecords(page, "blobs")).length;
  expect(legacy).toBeGreaterThan(0);
  await page.evaluate(() => {
    sessionStorage.setItem("workbench-github-token", JSON.stringify({ token: "account-b" }));
  });
  await page.reload();
  await expect(page.getByTitle("Sign out")).toContainText("account-b");
  await expect(page.locator(".workspace-repository-button")).not.toContainText(MOCK_REPOSITORY);
  await expect(surface(page, "main").locator(".view-lines")).not.toContainText("Private repository");
  await page.locator(".workspace-repository-button").click();
  await page.getByRole("textbox", { name: "Repository" }).fill(MOCK_REPOSITORY);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.locator(".workspace-repository-button")).not.toContainText(MOCK_REPOSITORY);
  await expect(surface(page, "main").locator(".view-lines")).not.toContainText("Private repository");
  expect((await storeRecords(page, "blobs")).length).toBeGreaterThanOrEqual(legacy);
  // Legitimate principal can still recover its own preserved data.
  await page.evaluate(() => {
    sessionStorage.setItem("workbench-github-token", JSON.stringify({ token: "test-token" }));
  });
  await page.reload();
  await openSyntheticPrivateRepo(page);
  await openReadme(page);
  await expect(surface(page, "main").locator(".view-lines").last()).toContainText("Private repository");
});


test("GHC-03 durability: close succeeds only after save or retains visibly unsaved live text", async ({ page }) => {
  await installAccountA(page);
  await openSyntheticPrivateRepo(page);
  await openReadme(page);
  await deferredLegacyDebounce(page);
  const content = "# SYNTHETIC_EDIT_UNSAVED_BEFORE_CLOSE";
  await editSyntheticReadme(page, content);
  const tab = surface(page, "main").locator(".dv-tab").filter({ hasText: "README.md" }).first();
  await tab.locator(".dv-default-tab-action").first().click();
  if (await tab.count()) {
    await expectGuardedUnsaved(page, content);
  } else {
    await expect.poll(() => persistedMarker(page, content)).toBe(true);
    await openReadme(page);
    await expect(surface(page, "main").locator(".view-lines").last()).toContainText(content);
  }
});


test("GHC-02 transaction: request success then real abort must never acknowledge durable save", async ({ page }) => {
  await installAccountA(page);
  await openSyntheticPrivateRepo(page);
  await openReadme(page);
  const content = "# SYNTHETIC_IDB_ABORT";
  await abortWriteContaining(page, content);
  await editSyntheticReadme(page, content);
  await expectAborted(page);
  // The injected transaction itself was aborted. A subsequent retry that
  // completes a NEW transaction is allowed, but cannot be acknowledged early.
  // A non-retried failed revision must remain visibly unsaved and editable.
  await expect.poll(async () =>
    (await persistedMarker(page, content)) || (await unsavedFeedback(page).isVisible())
  ).toBe(true);
  if (await persistedMarker(page, content)) {
    await page.reload();
    await openReadme(page);
    await expect(surface(page, "main").locator(".view-lines").last()).toContainText(content);
  } else {
    await expect(unsavedFeedback(page)).toBeVisible();
    await expect(surface(page, "main").locator(".view-lines").last()).toContainText(content);
  }
});


test("GHC-02 source-control: aborted commit never consumes staged data or acknowledges phantom commit", async ({ page }) => {
  await installAccountA(page);
  await openSyntheticPrivateRepo(page);
  await openReadme(page);
  const content = "# SYNTHETIC_ATOMIC_COMMIT";
  await editSyntheticReadme(page, content);
  await expect.poll(() => persistedMarker(page, content)).toBe(true);
  await surface(page, "primary").locator(".dv-tab").filter({ hasText: "Source Control" }).first().click();
  const row = surface(page, "primary").locator(".scm-change-row").filter({ hasText: "README.md" });
  await row.getByTitle("Stage", { exact: true }).click();
  await expect(row.getByTitle("Unstage", { exact: true })).toBeVisible();
  const message = "synthetic atomicity boundary";
  await abortWriteContaining(page, message);
  await surface(page, "primary").getByLabel("Commit message").fill(message);
  await surface(page, "primary").getByRole("button", { name: /Commit staged/ }).click();
  await expectAborted(page);
  // A retry is legitimate; the key guarantee is a consistent final commit
  // OR fully recoverable staged input. An operation-intent journal may contain
  // the message without representing a completed commit.
  await page.reload();
  const database = await inspectWorkbench(page);
  if (database.version === 2) {
    // Only the frozen v2 forensic path knows legacy store names.
    const records = (name: string) => database.stores.find((store) => store.name === name)?.records ?? [];
    const commits = records("commits");
    const staged = records("staged");
    const committed = records("committed");
    if (commits.length > 0) {
      // A successful logical commit must have the matching committed projection,
      // and must not leave its input staged in the frozen v2 data model.
      expect(committed.length).toBeGreaterThan(0);
      expect(staged).toHaveLength(0);
    } else {
      // An unsuccessful transition must not consume the original staged edit.
      expect(committed).toHaveLength(0);
      expect(staged.length).toBeGreaterThan(0);
    }
  } else {
    // Do not encode an RFC's provisional v3 physical stores into acceptance.
    await surface(page, "primary").locator(".dv-tab").filter({ hasText: "Source Control" }).first().click();
    const recovered = surface(page, "primary").locator(".scm-change-row").filter({ hasText: "README.md" });
    const stillStaged = await recovered.getByTitle("Unstage", { exact: true }).isVisible();
    const completeCommit = await surface(page, "primary").locator(".local-commit-header")
      .filter({ hasText: message }).isVisible();
    expect(stillStaged || completeCommit).toBe(true);
  }
});


test("GHC-03 durability: a confirmed persisted revision survives normal reload", async ({ page }) => {
  await installAccountA(page);
  await openSyntheticPrivateRepo(page);
  await openReadme(page);
  const content = "# SYNTHETIC_ACKNOWLEDGED_REVISION";
  await editSyntheticReadme(page, content);
  // Never force a crash while deliberately preventing all persistence.
  await expect.poll(() => persistedMarker(page, content)).toBe(true);
  await page.reload();
  await openReadme(page);
  await expect(surface(page, "main").locator(".view-lines").last()).toContainText(content);
});


test("GHC-03 durability: switch either persists old revision or blocks with recoverable live text", async ({ page }) => {
  await installAccountA(page);
  await openSyntheticPrivateRepo(page);
  await openReadme(page);
  await deferredLegacyDebounce(page);
  const content = "# SYNTHETIC_SWITCH_BEFORE_SAVE";
  await editSyntheticReadme(page, content);
  await page.locator(".workspace-repository-button").click();
  await page.getByRole("textbox", { name: "Repository" }).fill("acme/public");
  await page.getByRole("button", { name: "Open", exact: true }).click();
  // Wait for the asynchronous transition to settle before choosing its
  // contract branch. Reading the old button immediately is a harness race.
  await expect.poll(async () => {
    const label = await page.locator(".workspace-repository-button").innerText();
    return label.includes("acme/public") || (await unsavedFeedback(page).isVisible());
  }).toBe(true);
  if ((await page.locator(".workspace-repository-button").innerText()).includes("acme/public")) {
    await expect.poll(() => persistedMarker(page, content)).toBe(true);
    await openSyntheticPrivateRepo(page);
    await openReadme(page);
    await expect(surface(page, "main").locator(".view-lines").last()).toContainText(content);
  } else {
    await expect(page.locator(".workspace-repository-button")).toContainText(MOCK_REPOSITORY);
    await expectGuardedUnsaved(page, content);
  }
});


test("GHC-02 transaction: synthetic quota exception is visible and not acknowledged", async ({ page }) => {
  await installAccountA(page);
  await openSyntheticPrivateRepo(page);
  await openReadme(page);
  const content = "# SYNTHETIC_QUOTA_FAILURE";
  await page.evaluate((needle) => {
    for (const method of ["put", "add"] as const) {
      const original = IDBObjectStore.prototype[method];
      IDBObjectStore.prototype[method] = function (value: unknown, key?: IDBValidKey) {
        if (JSON.stringify(value).includes(needle)) {
          throw new DOMException("Synthetic storage quota exceeded", "QuotaExceededError");
        }
        return key === undefined ? original.call(this, value) : original.call(this, value, key);
      } as typeof IDBObjectStore.prototype.put;
    }
  }, content);
  await editSyntheticReadme(page, content);
  await expect(unsavedFeedback(page)).toBeVisible();
  // Recovery drafts may legitimately retain failed bytes; storage presence
  // alone does not establish a successful final save acknowledgment.
  await expect(surface(page, "main").locator(".view-lines").last()).toContainText(content);
});


test("GHC-03 durability: Dockview move preserves live buffer and persists or marks unsaved", async ({ page }) => {
  await installAccountA(page);
  await openSyntheticPrivateRepo(page);
  await openReadme(page);
  await deferredLegacyDebounce(page);
  const content = "# SYNTHETIC_MOVE_BEFORE_SAVE";
  await editSyntheticReadme(page, content);
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
  const moved = to.locator(".dv-tab").filter({ hasText: "README.md" }).first();
  if (await moved.count()) {
    await expect(moved).toBeVisible();
    await expect(to.locator(".view-lines").last()).toContainText(content);
    if (!(await persistedMarker(page, content))) await expect(unsavedFeedback(page)).toBeVisible();
  } else {
    await expect(from).toBeVisible();
    await expectGuardedUnsaved(page, content);
  }
  expect((await inspectWorkbench(page)).version).toBeGreaterThanOrEqual(2);
});

