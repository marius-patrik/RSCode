import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Editor, { DiffEditor, type OnMount } from "@monaco-editor/react";
import type { editor as MonacoEditor } from "monaco-editor";
import { registerCapabilityLanguages } from "@/capabilities/monaco";
import type { AppearanceMode } from "@/settings";
import { useWorkspace } from "@/workspace/context";
import { useFactory } from "@/factory/context";
import { useWorkbenchRuntime } from "@/workbench/runtime";
import { isGeneratedDocument } from "@/workspace/governance";
import { languageForPath } from "@/workspace/languages";
import { documentService } from "@/workspace/document-service";
import { encodeDocumentResourceId } from "@/workspace/identity";
import type { WorkbenchTab } from "@/workbench/model";
import {
  RenderedResource,
  ResourceControls,
  ReviewOverlay,
  useResourceComparison,
  type CompareMode,
  type ResourceRenderer,
} from "./resource-view";

const COMPARE_MODES = new Set<CompareMode>([
  "none",
  "working",
  "staged",
  "commit",
  "branch",
  "pull-request",
]);

export function EditorTab({
  tab,
  theme,
  updateState,
}: {
  tab: WorkbenchTab;
  theme: AppearanceMode;
  updateState: (patch: Record<string, unknown>) => void;
}) {
  const workspace = useWorkspace();
  const factory = useFactory();
  const runtime = useWorkbenchRuntime();
  const path = typeof tab.state.path === "string" ? tab.state.path : "Untitled";
  const repositoryFile = path !== "Untitled" && Boolean(workspace.workspace);
  const generated = repositoryFile && isGeneratedDocument(path);
  const documentId = repositoryFile && workspace.workspace
    ? encodeDocumentResourceId(workspace.workspace, path)
    : tab.id;
  const writeRef = useRef(workspace.writeFile);
  writeRef.current = workspace.writeFile;
  const readRef = useRef(workspace.readFile);
  readRef.current = workspace.readFile;
  const language =
    typeof tab.state.language === "string" ? tab.state.language : languageForPath(path);
  const renderer: ResourceRenderer = tab.state.renderer === "browser" ? "browser" : "editor";
  const review = tab.state.review === true;
  const compareCandidate =
    typeof tab.state.compare === "string" ? (tab.state.compare as CompareMode) : "none";
  const compare = COMPARE_MODES.has(compareCandidate) ? compareCandidate : "none";
  const compareTarget = typeof tab.state.compareTarget === "string" ? tab.state.compareTarget : "";

  const [value, setValue] = useState(() =>
    typeof tab.state.value === "string" ? tab.state.value : "",
  );
  const [loadedPath, setLoadedPath] = useState(repositoryFile ? "" : path);
  const [error, setError] = useState<string | null>(null);
  const viewStateTimer = useRef<number | null>(null);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const editorDisposables = useRef<Array<{ dispose: () => void }>>([]);
  const resource = useResourceComparison(repositoryFile ? path : "", compare, compareTarget);

  useEffect(
    () => () => {
      if (viewStateTimer.current !== null) window.clearTimeout(viewStateTimer.current);
      for (const disposable of editorDisposables.current) disposable.dispose();
      editorDisposables.current = [];
    },
    [],
  );

  const handleEditorMount: OnMount = (editor) => {
    editorRef.current = editor;
    if (repositoryFile) documentService.attachModel(documentId, editor.getModel());
    for (const disposable of editorDisposables.current) disposable.dispose();
    editorDisposables.current = [];

    const saved = tab.state.editorViewState;
    if (saved && typeof saved === "object") {
      editor.restoreViewState(saved as MonacoEditor.ICodeEditorViewState);
    }

    const persistViewState = () => {
      if (viewStateTimer.current !== null) window.clearTimeout(viewStateTimer.current);
      viewStateTimer.current = window.setTimeout(() => {
        viewStateTimer.current = null;
        const next = editor.saveViewState();
        if (next) updateState({ editorViewState: next });
      }, 180);
    };

    editorDisposables.current = [
      editor.onDidChangeCursorSelection(persistViewState),
      editor.onDidScrollChange(persistViewState),
    ];
  };

  useEffect(() => {
    if (tab.state.goToLineRequest === null) return;
    const requestedLine = Number(tab.state.goToLine);
    const target = editorRef.current;
    if (renderer !== "editor" || !target || !Number.isInteger(requestedLine) || requestedLine < 1) {
      return;
    }
    const lineCount = target.getModel()?.getLineCount() ?? requestedLine;
    const lineNumber = Math.min(requestedLine, Math.max(1, lineCount));
    target.setPosition({ lineNumber, column: 1 });
    target.revealLineInCenter(lineNumber);
    target.focus();
  }, [renderer, tab.state.goToLine, tab.state.goToLineRequest]);

  useEffect(() => {
    if (!repositoryFile) {
      setValue(typeof tab.state.value === "string" ? tab.state.value : "");
      setLoadedPath(path);
      return;
    }
    let disposed = false;
    let acquired = false;
    let unsubscribe = () => {};
    setLoadedPath("");
    setError(null);
    void readRef.current(path)
      .then((content) => {
        if (disposed) return;
        const session = documentService.acquire(
          documentId, workspace.principal.key, content,
          async (next) => writeRef.current(path, next),
        );
        acquired = true;
        unsubscribe = documentService.subscribe(documentId, (snapshot) => {
          if (disposed) return;
          setValue(snapshot.content);
          setError(snapshot.error);
        });
        setValue(session.content);
        setLoadedPath(path);
      })
      .catch((reason) => {
        if (!disposed) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      disposed = true;
      unsubscribe();
      if (acquired) documentService.release(documentId);
    };
  }, [documentId, path, repositoryFile, tab.state.value, workspace.principal.key]);

  const liveCurrent = useMemo(() => {
    if (!resource.current || loadedPath !== path || resource.current.content === null)
      return resource.current;
    return {
      ...resource.current,
      content: value,
      bytes: new TextEncoder().encode(value),
    };
  }, [loadedPath, path, resource.current, value]);

  if (error && loadedPath !== path) {
    return (
      <div className="tab-empty">
        <strong>Could not open {path}</strong>
        <span>{error}</span>
      </div>
    );
  }
  if (repositoryFile && loadedPath !== path) {
    return (
      <div className="tab-empty">
        <span>Loading {path}…</span>
      </div>
    );
  }

  const status = repositoryFile ? workspace.fileStatus(path) : null;
  const comparison = resource.comparison;
  const compareActive = compare !== "none";

  let body: ReactNode;
  if (!repositoryFile && renderer === "browser") {
    body = (
      <div className="tab-empty">
        <strong>Browser renderer</strong>
        <span>Save or open a repository file before using Browser rendering.</span>
      </div>
    );
  } else if (compareActive && resource.loading) {
    body = (
      <div className="tab-empty">
        <span>Loading comparison…</span>
      </div>
    );
  } else if (compareActive && resource.error) {
    body = (
      <div className="tab-empty">
        <strong>Comparison unavailable</strong>
        <span>{resource.error}</span>
      </div>
    );
  } else if (renderer === "editor" && compareActive && comparison) {
    if (comparison.before.content === null || comparison.after.content === null) {
      body = (
        <div className="tab-empty">
          <strong>Binary comparison</strong>
          <span>Switch Renderer to Browser for supported binary renderers.</span>
        </div>
      );
    } else {
      body = (
        <DiffEditor
          height="100%"
          beforeMount={registerCapabilityLanguages}
          language={language}
          original={comparison.before.content}
          modified={comparison.after.content}
          theme={theme === "light" ? "light" : "vs-dark"}
          options={{
            automaticLayout: true,
            readOnly: true,
            renderSideBySide: true,
            scrollBeyondLastLine: false,
          }}
        />
      );
    }
  } else if (renderer === "editor") {
    body = (
      <Editor
        key={repositoryFile ? documentId : tab.id}
        height="100%"
        beforeMount={registerCapabilityLanguages}
        onMount={handleEditorMount}
        keepCurrentModel
        path={repositoryFile ? documentId : tab.id}
        language={language}
        value={value}
        theme={theme === "light" ? "light" : "vs-dark"}
        onChange={(next) => {
          if (generated) return;
          const content = next ?? "";
          setValue(content);
          if (repositoryFile) {
            void documentService.edit(documentId, content).catch((reason) => {
              setError(reason instanceof Error ? reason.message : String(reason));
            });
          } else updateState({ value: content });
        }}
        options={{
          automaticLayout: true,
          minimap: { enabled: true },
          wordWrap: "on",
          readOnly: generated,
          scrollBeyondLastLine: false,
        }}
      />
    );
  } else if (compareActive && comparison) {
    body = (
      <div className="rendered-comparison">
        <section>
          <header>{comparison.before.label}</header>
          <RenderedResource path={path} snapshot={comparison.before} />
        </section>
        <section>
          <header>{comparison.after.label}</header>
          <RenderedResource path={path} snapshot={comparison.after} />
        </section>
      </div>
    );
  } else if (resource.loading) {
    body = (
      <div className="tab-empty">
        <span>Loading renderer…</span>
      </div>
    );
  } else if (resource.error) {
    body = (
      <div className="tab-empty">
        <strong>Renderer unavailable</strong>
        <span>{resource.error}</span>
      </div>
    );
  } else {
    body = <RenderedResource path={path} snapshot={liveCurrent} />;
  }

  return (
    <div className="resource-tab">
      <ResourceControls
        path={path}
        renderer={renderer}
        review={review}
        compare={compare}
        target={compareTarget}
        onChange={updateState}
      />
      <div className="resource-content">
      {error && loadedPath === path && (
        <div className="resource-generated-notice" role="alert">
          <strong>Document save not acknowledged: {error}</strong>
          <button
            type="button"
            onClick={() => void documentService.flush(documentId).catch((reason) => {
              setError(reason instanceof Error ? reason.message : String(reason));
            })}
          >
            Retry save
          </button>
        </div>
      )}
      {generated && (
        <div className="resource-generated-notice" role="note">
          <span>
            Generated document · edit its authored records in .agents/ instead of modifying this
            projection.
          </span>
          <button
            type="button"
            onClick={() => {
              factory.setConcern(
                path === ".agents/ARCHITECTURE.md" ? "repository" : "specification",
              );
              runtime.openTab(
                path === ".agents/ARCHITECTURE.md" ? "repository" : "specification",
                "main",
              );
            }}
          >
            Open canonical sources
          </button>
        </div>
      )}
      <div className={review ? "resource-body review-enabled" : "resource-body"}>
        {body}
        <ReviewOverlay enabled={review} />
        {status && <span className={`resource-status file-status status-${status}`}>{status}</span>}
      </div>
      </div>
    </div>
  );
}
