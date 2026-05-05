import { expect, test } from "bun:test";
import { workspaceForCurrentView, workspaceForEntry } from "@/client/App";
import { type CommandDefinition, commandGroupsFor, disabled, enabled, runCommand } from "@/client/commands";
import { urlForLauncherQuery } from "@/client/launcher";
import { DEFAULT_WORKSPACE_SETTINGS, type Workspace } from "@/shared/schema";

test("command registry surfaces disabled reasons and prevents disabled execution", () => {
  let ran = false;
  const commands: CommandDefinition[] = [
    {
      id: "enabled",
      label: "Enabled",
      scope: "global",
      group: "workspace",
      enabled,
      run: () => {
        ran = true;
      },
    },
    {
      id: "disabled",
      label: "Disabled",
      scope: "global",
      group: "workspace",
      enabled: () => disabled("missing context"),
      run: () => {
        throw new Error("should not run");
      },
    },
  ];

  const groups = commandGroupsFor(commands);
  expect(groups[0]?.items[0]?.disabledReason).toBeNull();
  expect(groups[0]?.items[1]?.disabledReason).toBe("missing context");

  runCommand(commands[0] as CommandDefinition);
  expect(ran).toBe(true);
  expect(() => runCommand(commands[1] as CommandDefinition)).toThrow("missing context");
});

test("launcher input resolves URLs and web searches", () => {
  expect(urlForLauncherQuery("https://example.com/path")).toBe("https://example.com/path");
  expect(urlForLauncherQuery("localhost:4567")).toBe("http://localhost:4567");
  expect(urlForLauncherQuery("example.com/docs")).toBe("https://example.com/docs");
  expect(urlForLauncherQuery("pane workspace")).toBe("https://www.google.com/search?q=pane%20workspace");
  expect(urlForLauncherQuery("   ")).toBeNull();
});

test("workspace entry applies default view without clobbering current view updates", () => {
  const workspace = makeWorkspaceFixture({
    activeView: "panes",
    settings: { ...DEFAULT_WORKSPACE_SETTINGS, defaultView: "canvas" },
  });
  const current = makeWorkspaceFixture({
    id: workspace.id,
    activeView: "panes",
    settings: { ...DEFAULT_WORKSPACE_SETTINGS, defaultView: "canvas" },
  });

  expect(workspaceForEntry(workspace).activeView).toBe("canvas");
  expect(workspaceForCurrentView({ ...workspace, activeView: "canvas" }, current).activeView).toBe("panes");
});

function makeWorkspaceFixture(overrides: Partial<Workspace> = {}): Workspace {
  const now = new Date().toISOString();
  return {
    id: "workspace:test",
    label: "Test",
    rootPath: process.cwd(),
    activeView: "panes",
    settings: DEFAULT_WORKSPACE_SETTINGS,
    panes: [],
    tiledLayout: null,
    canvasViewport: { x: 0, y: 0, zoom: 1 },
    activePaneId: null,
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
    ...overrides,
  };
}
