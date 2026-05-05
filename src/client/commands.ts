import type { ActionGroup, ActionItem } from "@/client/ActionsMenu";

export type CommandScope =
  | "global"
  | "workspace"
  | "filesystem"
  | "pane"
  | "browser"
  | "git"
  | "navigation";

export type CommandAvailability =
  | { enabled: true }
  | { enabled: false; reason: string };

export type CommandDefinition = {
  id: string;
  label: string;
  scope: CommandScope;
  group: string;
  hint?: string;
  destructive?: boolean;
  confirmation?: {
    title: string;
    message: string;
  };
  enabled: () => CommandAvailability;
  run: () => void | Promise<void>;
};

export type CommandContext = {
  rootPath: string;
  selectedPath: string | null;
  activePaneId: string | null;
};

export function enabled(): CommandAvailability {
  return { enabled: true };
}

export function disabled(reason: string): CommandAvailability {
  return { enabled: false, reason };
}

export function runCommand(command: CommandDefinition): void {
  const available = command.enabled();
  if (!available.enabled) {
    throw new Error(`${command.label}: ${available.reason}`);
  }
  void command.run();
}

export function commandGroupsFor(commands: CommandDefinition[]): ActionGroup[] {
  const grouped = new Map<string, ActionItem[]>();
  for (const command of commands) {
    const availability = command.enabled();
    const item: ActionItem = {
      id: command.id,
      label: command.label,
      hint: availability.enabled ? command.hint : availability.reason,
      destructive: command.destructive,
      disabledReason: availability.enabled ? null : availability.reason,
      onSelect: () => runCommand(command),
    };
    grouped.set(command.group, [...(grouped.get(command.group) ?? []), item]);
  }
  return Array.from(grouped.entries()).map(([id, items]) => ({
    id,
    label: labelForGroup(id),
    items,
  }));
}

function labelForGroup(group: string): string {
  if (group === "workspace") return "Workspace";
  if (group === "new") return "New";
  if (group === "item") return "Item";
  if (group === "pane") return "Pane";
  if (group === "browser") return "Browser";
  if (group === "git") return "Source Control";
  if (group === "navigation") return "Navigation";
  return group;
}
