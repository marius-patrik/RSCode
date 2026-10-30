import { Suspense, lazy, useEffect, useState } from "react";

// Lazy wrapper around @monaco-editor/react. The editor pulls in a ~3 MB
// worker bundle, so we keep it out of the main chunk and load it on
// first open.

const Editor = lazy(() => import("@monaco-editor/react").then((m) => ({ default: m.default })));

export type MonacoLang = "markdown" | "json" | "yaml" | "typescript" | "plaintext";

export function MonacoEditor({
  value,
  language = "markdown",
  height = "100%",
  onChange,
  readOnly = false,
}: {
  value: string;
  language?: MonacoLang;
  height?: string | number;
  onChange?: (next: string) => void;
  readOnly?: boolean;
}) {
  const [theme, setTheme] = useState<"vs-dark" | "light">(() =>
    typeof document !== "undefined" && !document.documentElement.classList.contains("dark") ? "light" : "vs-dark",
  );
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setTheme(root.classList.contains("dark") ? "vs-dark" : "light");
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return (
    <Suspense
      fallback={
        <div className="grid h-full place-items-center font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/60">
          loading editor…
        </div>
      }
    >
      <Editor
        height={height}
        defaultLanguage={language}
        value={value}
        theme={theme}
        onChange={(v) => onChange?.(v ?? "")}
        options={{
          readOnly,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          fontSize: 12,
          lineNumbers: "off",
          folding: false,
          renderLineHighlight: "none",
          padding: { top: 8, bottom: 8 },
          wordWrap: "on",
          automaticLayout: true,
        }}
      />
    </Suspense>
  );
}

export function languageForFile(name: string): MonacoLang {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "md" || ext === "markdown") return "markdown";
  if (ext === "json" || ext === "jsonl") return "json";
  if (ext === "yaml" || ext === "yml") return "yaml";
  if (ext === "ts" || ext === "tsx") return "typescript";
  return "plaintext";
}
