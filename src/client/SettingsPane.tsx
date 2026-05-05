import { THEME_COLOR_FIELDS, colorInputValue, makeCustomTheme, resolveWorkspaceTheme } from "@/client/theme";
import {
  BUILTIN_WORKSPACE_THEMES,
  type SettingsPaneState,
  type Workspace,
  type WorkspaceSettings,
  type WorkspaceThemeDefinition,
} from "@/shared/schema";
import { cn } from "@/shared/utils";
import { Plus, X } from "lucide-react";
import type { ReactNode } from "react";

export function SettingsPane({
  workspace,
  onUpdateSettings,
}: {
  workspace: Workspace;
  pane: SettingsPaneState;
  onUpdateSettings: (patch: Partial<WorkspaceSettings>) => void;
}) {
  const settings = workspace.settings;
  const activeTheme = resolveWorkspaceTheme(settings);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="mx-auto grid max-w-2xl gap-4">
          <SettingRow
            title="Theme"
            detail="Active palette."
            control={
              <ThemeSelector
                settings={settings}
                activeTheme={activeTheme}
                onUpdateSettings={onUpdateSettings}
              />
            }
          />
          <SettingRow
            title="Default View"
            detail="Choose the workspace view to return to by default."
            control={
              <SegmentedControl
                value={settings.defaultView}
                options={[
                  { value: "panes", label: "Panes" },
                  { value: "canvas", label: "Canvas" },
                ]}
                onChange={(value) => onUpdateSettings({ defaultView: value as WorkspaceSettings["defaultView"] })}
              />
            }
          />
          <SettingRow
            title="Background"
            detail="Choose the workspace backdrop pattern."
            control={
              <SegmentedControl
                value={settings.backgroundStyle}
                options={[
                  { value: "grid", label: "Grid" },
                  { value: "flat", label: "Flat" },
                  { value: "dot", label: "Dot" },
                ]}
                onChange={(value) =>
                  onUpdateSettings({ backgroundStyle: value as WorkspaceSettings["backgroundStyle"] })
                }
              />
            }
          />
          <SettingPanel title="Theme Colors" detail={activeTheme.label}>
            <ThemeColorEditor settings={settings} activeTheme={activeTheme} onUpdateSettings={onUpdateSettings} />
          </SettingPanel>
          <SettingRow
            title="Tabbed Panes"
            detail="Allow tiled panes to hold multiple tabs."
            control={
              <button
                type="button"
                role="switch"
                aria-checked={settings.tabbedPanes}
                onClick={() => onUpdateSettings({ tabbedPanes: !settings.tabbedPanes })}
                className={cn(
                  "relative h-6 w-11 rounded-full border border-border bg-[var(--control-bg)] transition-colors",
                  settings.tabbedPanes && "border-ring",
                )}
              >
                <span
                  className={cn(
                    "absolute top-0.5 h-[18px] w-[18px] rounded-full bg-muted-foreground transition-transform",
                    settings.tabbedPanes ? "translate-x-5" : "translate-x-0.5",
                  )}
                />
              </button>
            }
          />
        </div>
      </div>
    </div>
  );
}

function ThemeSelector({
  settings,
  activeTheme,
  onUpdateSettings,
}: {
  settings: WorkspaceSettings;
  activeTheme: WorkspaceThemeDefinition;
  onUpdateSettings: (patch: Partial<WorkspaceSettings>) => void;
}) {
  const themes = [...BUILTIN_WORKSPACE_THEMES, ...settings.customThemes];
  return (
    <div className="flex items-center justify-end gap-1.5">
      <select
        value={settings.theme}
        onChange={(event) => onUpdateSettings({ theme: event.target.value })}
        className="h-8 min-w-40 rounded-md border border-border bg-[var(--control-bg)] px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
      >
        {themes.map((theme) => (
          <option key={theme.id} value={theme.id}>
            {theme.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        title="Create custom theme"
        onClick={() => {
          const customTheme = makeCustomTheme(activeTheme, settings.customThemes.length + 1);
          onUpdateSettings({ theme: customTheme.id, customThemes: [...settings.customThemes, customTheme] });
        }}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-[var(--control-bg)] text-muted-foreground hover:text-foreground"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

function ThemeColorEditor({
  settings,
  activeTheme,
  onUpdateSettings,
}: {
  settings: WorkspaceSettings;
  activeTheme: WorkspaceThemeDefinition;
  onUpdateSettings: (patch: Partial<WorkspaceSettings>) => void;
}) {
  const customTheme = settings.customThemes.find((theme) => theme.id === settings.theme) ?? null;
  const editable = Boolean(customTheme);
  const updateCustomTheme = (updater: (theme: WorkspaceThemeDefinition) => WorkspaceThemeDefinition) => {
    if (!customTheme) return;
    onUpdateSettings({
      customThemes: settings.customThemes.map((theme) => (theme.id === customTheme.id ? updater(theme) : theme)),
    });
  };
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {customTheme ? (
          <>
            <input
              value={customTheme.label}
              onChange={(event) => {
                const label = event.target.value;
                updateCustomTheme((theme) => ({ ...theme, label: label.trim() ? label : theme.label }));
              }}
              className="h-8 min-w-40 rounded-md border border-border bg-[var(--input-bg)] px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
            />
            <SegmentedControl
              value={customTheme.mode}
              options={[
                { value: "dark", label: "Dark" },
                { value: "light", label: "Light" },
              ]}
              onChange={(value) =>
                updateCustomTheme((theme) => ({ ...theme, mode: value as WorkspaceThemeDefinition["mode"] }))
              }
            />
            <button
              type="button"
              title="Delete custom theme"
              onClick={() =>
                onUpdateSettings({
                  theme: customTheme.mode,
                  customThemes: settings.customThemes.filter((theme) => theme.id !== customTheme.id),
                })
              }
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-[var(--control-bg)] text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => {
              const next = makeCustomTheme(activeTheme, settings.customThemes.length + 1);
              onUpdateSettings({ theme: next.id, customThemes: [...settings.customThemes, next] });
            }}
            className="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-[var(--control-bg)] px-2 text-xs text-muted-foreground hover:text-foreground"
          >
            <Plus className="h-4 w-4" />
            Custom
          </button>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {THEME_COLOR_FIELDS.map((field) => (
          <ThemeColorInput
            key={field.key}
            label={field.label}
            value={activeTheme.colors[field.key]}
            disabled={!editable}
            onChange={(value) =>
              updateCustomTheme((theme) => ({
                ...theme,
                colors: { ...theme.colors, [field.key]: value },
              }))
            }
          />
        ))}
      </div>
    </div>
  );
}

function ThemeColorInput({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const hexValue = colorInputValue(value);
  return (
    <label className={cn("grid gap-1 rounded-md border border-border bg-[var(--control-bg)] p-2", disabled && "opacity-70")}>
      <span className="text-[10px] font-semibold uppercase text-muted-foreground">{label}</span>
      <span className="flex min-w-0 items-center gap-2">
        <span className="h-6 w-6 shrink-0 rounded border border-border" style={{ background: value }} />
        <input
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className="min-w-0 flex-1 rounded border border-border bg-[var(--input-bg)] px-2 py-1 font-mono text-[11px] outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed"
        />
        <button
          type="button"
          disabled={disabled}
          className="relative h-7 w-7 shrink-0 overflow-hidden rounded border border-border disabled:cursor-not-allowed"
        >
          <input
            type="color"
            value={hexValue}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
            className="absolute inset-[-4px] h-10 w-10 cursor-pointer disabled:cursor-not-allowed"
          />
        </button>
      </span>
    </label>
  );
}

function SettingPanel({
  title,
  detail,
  children,
}: {
  title: string;
  detail: string;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-3 rounded-md border border-border bg-secondary p-3">
      <div className="min-w-0">
        <div className="text-sm font-semibold">{title}</div>
        <div className="mt-1 text-xs leading-relaxed text-muted-foreground">{detail}</div>
      </div>
      {children}
    </section>
  );
}

function SettingRow({ title, detail, control }: { title: string; detail: string; control: ReactNode }) {
  return (
    <section className="grid gap-3 rounded-md border border-border bg-secondary p-3 sm:grid-cols-[1fr_auto] sm:items-center">
      <div className="min-w-0">
        <div className="text-sm font-semibold">{title}</div>
        <div className="mt-1 text-xs leading-relaxed text-muted-foreground">{detail}</div>
      </div>
      <div className="shrink-0">{control}</div>
    </section>
  );
}

function SegmentedControl({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-border bg-[var(--control-bg)] p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            "h-7 rounded px-3 text-xs transition-colors",
            option.value === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
