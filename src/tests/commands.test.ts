import { expect, test } from "bun:test";
import { urlForLauncherQuery } from "@/client/App";
import { type CommandDefinition, commandGroupsFor, disabled, enabled, runCommand } from "@/client/commands";

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
