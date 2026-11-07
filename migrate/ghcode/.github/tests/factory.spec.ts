import { canonicalSourceDirectory, isGeneratedDocument } from "../../src/workspace/governance";
import { expect, test } from "@playwright/test";
import {
  assembleIssueDrafts,
  calculateDiscrepancies,
  compileContract,
  parseContract,
  validateContract,
  type Contract,
} from "../../src/factory/contracts";

const target: Contract = {
  kind: "prd",
  schema_version: "1.0.0",
  policy: { file_tree_complete: false },
  requirements: [{ id: "REQ-001", title: "Working contract" }],
  files: [{ id: "FIL-001", path: "src/app.tsx", kind: "file" }],
};

test("generated documents can be parsed from embedded canonical source records", () => {
  const generated = '# Product requirements\n\n## Approved source\n\n' + '\`\`\`json\n' + JSON.stringify(target) + '\n\`\`\`';
  expect(parseContract(generated).contract).toEqual(target);
});

test("frontmatter compiler round trips and validates stable contracts", () => {
  const markdown = compileContract(target, "# Narrative\n\nOnly the contract is machine-readable.");
  const parsed = parseContract(markdown);
  expect(parsed.contract).toEqual(target);
  expect(parsed.prose).toContain("# Narrative");
  expect(validateContract(parsed.contract)).toEqual([]);
});

test("file absence is not reported against incomplete repository evidence", () => {
  expect(calculateDiscrepancies(target, null, [], false)).toEqual([]);
  const delta = calculateDiscrepancies(target, null, [], true);
  expect(delta).toHaveLength(1);
  expect(delta[0]).toMatchObject({ kind: "file", status: "missing", path: "src/app.tsx" });
});

test("unexpected files require an explicitly exhaustive target manifest", () => {
  const observed = [
    { path: "src/app.tsx", type: "file" as const },
    { path: "src/other.ts", type: "file" as const },
  ];
  expect(calculateDiscrepancies(target, null, observed, true)).toEqual([]);
  const strictTarget = { ...target, policy: { file_tree_complete: true } };
  const delta = calculateDiscrepancies(strictTarget, null, observed, true);
  expect(delta).toHaveLength(1);
  expect(delta[0]).toMatchObject({ status: "unexpected", path: "src/other.ts" });
});

test("undocumented architecture is unverified, never classified as missing implementation", () => {
  const reported: Contract = { kind: "architecture", schema_version: "1.0.0", requirements: [] };
  const delta = calculateDiscrepancies(target, reported, [{ path: "src/app.tsx", type: "file" }], true);
  expect(delta).toHaveLength(1);
  expect(delta[0]).toMatchObject({ status: "unverified", kind: "contract" });
  expect(assembleIssueDrafts(delta)[0].body).toContain("Confirm discrepancies before implementation");
});


test("all workspace perspectives are native main Dockview tabs with a visible tab strip", async ({ page }) => {
  await page.goto("/");
  const main = page.locator('[data-workbench-surface="main"]');
  const strip = main.locator(".dv-tabs-container").first();
  await expect(strip).toBeVisible();
  for (const name of ["Overview", "Specification", "Delta", "Repository"]) {
    const tab = main.locator(".dv-tab").filter({ hasText: name });
    await expect(tab).toHaveCount(1);
    await expect(tab).toBeVisible();
    await page.getByRole("navigation", { name: "Workspace perspectives" }).getByRole("button", { name }).click();
    await expect(main.locator(".dv-active-tab")).toContainText(name);
  }
  await expect(main.locator(".dv-tab").filter({ hasText: "Software Factory" })).toHaveCount(0);
  await page.getByRole("button", { name: /Open repository/i }).first().click();
  await expect(page.getByRole("dialog", { name: "Open GitHub repository" })).toBeVisible();
});

test("sidebar collapse and restore never obscure the main tab strip or active content", async ({ page }) => {
  await page.goto("/");
  const main = page.locator(".root-main");
  const mainTabs = page.locator('[data-workbench-surface="main"] .dv-tab');
  await expect(mainTabs.filter({ hasText: "Overview" })).toBeVisible();
  const initial = await main.boundingBox();
  expect(initial?.width).toBeGreaterThan(250);
  await page.getByTitle("Toggle Primary Sidebar (Cmd/Ctrl+B)").click();
  await expect(mainTabs.filter({ hasText: "Overview" })).toBeVisible();
  expect((await main.boundingBox())?.width).toBeGreaterThan(initial?.width ?? 0);
  await page.getByTitle("Toggle Secondary Sidebar (Cmd+Option/Ctrl+Alt+B)").click();
  await expect(mainTabs.filter({ hasText: "Specification" })).toBeVisible();
  await page.getByTitle("Toggle Primary Sidebar (Cmd/Ctrl+B)").click();
  await expect(mainTabs.filter({ hasText: "Delta" })).toBeVisible();
  await expect(page.locator(".workbench-statusbar")).toHaveCount(1);
  await expect(page.locator(".factory-footer, .factory-header, .factory-panes")).toHaveCount(0);
  await expect(main.locator(".workbench-dockview")).toBeVisible();
});

test("editor and workspace perspective are peers in a single Dockview tab strip", async ({ page }) => {
  await page.goto("/");
  const main = page.locator('[data-workbench-surface="main"]');
  const field = page.getByLabel("Workbench omnibar");
  await field.fill(">Open Browser");
  await field.press("Enter");
  await expect(main.locator(".dv-tab").filter({ hasText: "Browser" })).toBeVisible();
  await expect(main.locator(".dv-tab").filter({ hasText: "Specification" })).toBeVisible();
  await page.getByRole("navigation", { name: "Workspace perspectives" }).getByRole("button", { name: "Specification" }).click();
  await expect(main.locator(".dv-active-tab")).toContainText("Specification");
  await main.locator(".dv-tab").filter({ hasText: "Browser" }).click();
  await expect(main.locator(".dv-active-tab")).toContainText("Browser");
  await expect(main.locator(".dv-tab").filter({ hasText: "Overview" })).toBeVisible();
  await page.reload();
  await expect(main.locator(".dv-tab").filter({ hasText: "Specification" })).toBeVisible();
  await expect(main.locator(".dv-tab").filter({ hasText: "Browser" })).toBeVisible();
});

test("mobile viewport preserves a visible native main tab strip and center pane", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const main = page.locator('[data-workbench-surface="main"]');
  await expect(main.locator(".dv-tab").filter({ hasText: "Overview" })).toBeVisible();
  await page.getByTitle("Toggle Primary Sidebar (Cmd/Ctrl+B)").click();
  await expect(main.locator(".dv-tabs-container").first()).toBeVisible();
  await page.getByRole("navigation", { name: "Workspace perspectives" }).getByRole("button", { name: "Delta" }).click();
  await expect(main.locator(".dv-active-tab")).toContainText("Delta");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect((await page.locator(".root-main").boundingBox())?.width).toBeGreaterThan(250);
});

test("only generated agent projections are read-only and each has an authored source", () => {
  for (const [path, dir] of [
    [".agents/README.md", ".agents/notes/"],
    [".agents/PRD.md", ".agents/requests/"],
    [".agents/ARCHITECTURE.md", ".agents/decisions/"],
    [".agents/AGENTS.md", ".agents/rules/"],
  ]) {
    expect(isGeneratedDocument(path)).toBe(true);
    expect(canonicalSourceDirectory(path)).toBe(dir);
  }
  expect(isGeneratedDocument(".agents/requests/0001-product.md")).toBe(false);
  expect(isGeneratedDocument("PRD.md")).toBe(false);
  expect(canonicalSourceDirectory("src/workbench/shell.tsx")).toBeNull();
});
