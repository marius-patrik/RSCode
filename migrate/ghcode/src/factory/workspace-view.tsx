import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  BookOpen,
  CircleAlert,
  Download,
  ExternalLink,
  FileCode2,
  FolderTree,
  Plus,
  Send,
} from "lucide-react";
import { AnimatedIcon } from "@/components/animated-icon";
import { useFactory, type FactoryConcern } from "@/factory/context";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createGithubIssue } from "@/github/client";
import { useWorkbenchRuntime } from "@/workbench/runtime";
import { useWorkspace } from "@/workspace/context";
import { languageForPath } from "@/workspace/languages";
import { registryRecords, REGISTRIES } from "@/factory/contracts";
import "@/factory/factory.css";

function downloadMarkdown(name: string, contents: string) {
  const blob = new Blob([contents], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function Status({ children, tone }: { children: string; tone?: "good" | "warn" | "bad" }) {
  return <span className={`factory-status ${tone ?? ""}`}>{children}</span>;
}

export function FactoryWorkspaceView({ concern }: { concern: FactoryConcern }) {
  const workspace = useWorkspace();
  const factory = useFactory();
  const runtime = useWorkbenchRuntime();
  const reducedMotion = useReducedMotion();
  const currentRepo = workspace.workspace;
  const {
    desired,
    reported,
    loading: reading,
    error: readError,
    desiredFiles: declaredFiles,
    actualFiles: observedFiles,
    changes: delta,
    drafts,
    validation,
    selectedPath,
  } = factory;
  const [search, setSearch] = useState("");
  const [registry, setRegistry] = useState("requirements");
  const [selectedRecord, setSelectedRecord] = useState("");
  const [editedIssueBodies, setEditedIssueBodies] = useState<Record<string, string>>({});
  const [published, setPublished] = useState<Record<string, number>>({});
  const [publishing, setPublishing] = useState<string | null>(null);
  const [dispatchError, setDispatchError] = useState("");

  const previousRepo = useRef<string | null>(null);
  useEffect(() => {
    const id = currentRepo?.id ?? null;
    if (previousRepo.current === id) return;
    previousRepo.current = id;
    setSearch("");
    setSelectedRecord("");
    setPublished({});
    setEditedIssueBodies({});
    setDispatchError("");
  }, [currentRepo]);

  const target = desired?.contract ?? null;
  const selectedDoc = concern === "repository" ? reported : desired;
  const selectedFile = selectedPath ?? "";
  const fileList =
    concern === "specification"
      ? declaredFiles
      : concern === "delta"
        ? delta
            .filter((item) => item.kind === "file" && item.path)
            .map((item) => ({ path: item.path as string, type: "file" as const }))
        : observedFiles;

  const filteredRecords = registryRecords(selectedDoc?.contract ?? null, registry).filter(
    (record) => JSON.stringify(record).toLowerCase().includes(search.trim().toLowerCase()),
  );
  const record = filteredRecords.find((item) => item.id === selectedRecord) ?? filteredRecords[0];

  const openEditor = (path: string) =>
    runtime.openTab("editor", "main", {
      path,
      language: languageForPath(path),
      renderer: "editor",
    });

  const fileDetails = selectedFile
    ? {
        declared: declaredFiles.find((item) => item.path === selectedFile),
        actual: observedFiles.find((item) => item.path === selectedFile),
        changes: delta.filter((item) => item.path === selectedFile),
      }
    : null;

  const publishIssue = async (draft: (typeof drafts)[number]) => {
    if (!currentRepo || !workspace.token || !currentRepo.repository.canPush) return;
    if (
      !window.confirm(
        `Create a GitHub issue in ${currentRepo.repository.fullName}?\n\n${draft.title}`,
      )
    )
      return;
    setPublishing(draft.id);
    setDispatchError("");
    try {
      const publishedIssue = await createGithubIssue(
        currentRepo.repository.fullName,
        draft.title,
        editedIssueBodies[draft.id] ?? draft.body,
        workspace.token,
      );
      setPublished((previous) => ({ ...previous, [draft.id]: publishedIssue.number }));
    } catch (error) {
      setDispatchError(error instanceof Error ? error.message : String(error));
    } finally {
      setPublishing(null);
    }
  };

  const filesView = (
    <section className="factory-inspector factory-file-inspector" aria-label="Selected file">
      {fileDetails ? (
        <>
          <div className="factory-inspector-head">
            <FileCode2 size={18} />
            <div className="factory-inspector-title">
              <strong>{selectedFile.split("/").at(-1)}</strong>
              <span>{selectedFile}</span>
            </div>
            {fileDetails.actual?.type === "file" && (
              <Button variant="outline" size="sm" onClick={() => openEditor(selectedFile)}>
                Open in Monaco <ExternalLink size={13} />
              </Button>
            )}
          </div>
          <dl className="factory-properties">
            <dt>Declared</dt>
            <dd>{fileDetails.declared?.type ?? "Not declared"}</dd>
            <dt>Observed</dt>
            <dd>{fileDetails.actual?.type ?? "Not found in repository tree"}</dd>
            <dt>Finding</dt>
            <dd>
              {fileDetails.changes.map((change) => change.status).join(", ") ||
                "No confirmed discrepancy"}
            </dd>
          </dl>
          {fileDetails.changes.map((finding) => (
            <div key={finding.id} className="factory-finding">
              <Status tone={finding.status === "missing" ? "bad" : "warn"}>{finding.status}</Status>
              <p>{finding.explanation}</p>
            </div>
          ))}
          {fileDetails.declared?.content !== undefined && (
            <>
              <h3>Exact desired content</h3>
              <pre className="factory-code">{fileDetails.declared.content}</pre>
            </>
          )}
          {fileDetails.declared?.content !== undefined && fileDetails.actual && (
            <p className="factory-caption">
              Path presence does not prove source-content or behavioral compliance.
            </p>
          )}
        </>
      ) : (
        <div className="factory-no-selection">
          <FolderTree size={24} />
          <strong>
            {concern === "specification"
              ? "Desired file tree"
              : concern === "delta"
                ? "File differences"
                : "Repository tree"}
          </strong>
          <p>
            Select a file in the shared Explorer to inspect it here. The same Explorer switches data
            with the workspace perspective.
          </p>
          <span className="factory-caption">{fileList.length} paths in this view</span>
        </div>
      )}
    </section>
  );

  const contractsView = (
    <div className="factory-split">
      <section className="factory-list-pane" aria-label="Contract registries">
        <header className="factory-pane-heading">
          <BookOpen size={14} />
          <strong>{concern === "repository" ? "Reported contracts" : "Target contracts"}</strong>
        </header>
        <div className="factory-registry-list">
          {REGISTRIES.map((name) => (
            <button
              className={`factory-file-row ${registry === name ? "selected" : ""}`}
              type="button"
              key={name}
              onClick={() => {
                setRegistry(name);
                setSelectedRecord("");
              }}
            >
              <span>{name}</span>
              <small>{registryRecords(selectedDoc?.contract ?? null, name).length}</small>
            </button>
          ))}
        </div>
      </section>
      <section className="factory-inspector">
        <header className="factory-pane-heading">
          <strong>{registry}</strong>
          <span>{filteredRecords.length}</span>
        </header>
        <div className="factory-record-list">
          {filteredRecords.map((item) => (
            <button
              type="button"
              key={String(item.id ?? JSON.stringify(item))}
              className={`factory-record ${record === item ? "selected" : ""}`}
              onClick={() => setSelectedRecord(String(item.id ?? ""))}
            >
              <strong>{String(item.title ?? item.id ?? "Untitled")}</strong>
              <small>{String(item.id ?? "Missing ID")}</small>
            </button>
          ))}
        </div>
        {record ? (
          <pre className="factory-code">{JSON.stringify(record, null, 2)}</pre>
        ) : (
          <p className="factory-empty">No contracts in this registry.</p>
        )}
      </section>
    </div>
  );

  const issuesView = (
    <div className="factory-issues">
      <div className="factory-pane-heading">
        <strong>Review & dispatch</strong>
        <span>{drafts.length} drafts</span>
      </div>
      {dispatchError && (
        <div role="alert" className="factory-error">
          {dispatchError}
        </div>
      )}
      {drafts.length === 0 && (
        <p className="factory-empty">
          No actionable discrepancies are supported by the loaded source documents and tree.
        </p>
      )}
      {drafts.map((draft) => (
        <article className="factory-issue" key={draft.id}>
          <div className="factory-issue-heading">
            <div>
              <strong>{draft.title}</strong>
              <span>{draft.items.length} evidence-backed discrepancies</span>
            </div>
            {published[draft.id] ? (
              <Status tone="good">{`Published #${published[draft.id]}`}</Status>
            ) : (
              <Status>Draft</Status>
            )}
          </div>
          <textarea
            aria-label={`Issue body: ${draft.title}`}
            value={editedIssueBodies[draft.id] ?? draft.body}
            onChange={(event) =>
              setEditedIssueBodies((current) => ({ ...current, [draft.id]: event.target.value }))
            }
          />
          <div className="factory-actions">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                downloadMarkdown(
                  "issue-" + draft.id.replace(/[^a-z0-9-]/gi, "-") + ".md",
                  editedIssueBodies[draft.id] ?? draft.body,
                )
              }
            >
              <Download size={14} /> Export
            </Button>
            <Button
              size="sm"
              disabled={
                publishing !== null ||
                !!published[draft.id] ||
                !currentRepo?.repository.canPush ||
                !workspace.token
              }
              onClick={() => void publishIssue(draft)}
            >
              <Send size={14} />
              {publishing === draft.id ? "Publishing…" : "Create GitHub issue"}
            </Button>
          </div>
        </article>
      ))}
      {!workspace.token && drafts.length > 0 && (
        <p className="factory-caption">
          Authenticate with GitHub to publish issues. Export remains available without write access.
        </p>
      )}
    </div>
  );

  if (!currentRepo) {
    return (
      <div className="factory-start">
        <AnimatedIcon names={["FolderTreeIcon", "FileCode2Icon"]} />
        <h2>Software Factory</h2>
        <p>
          Open a GitHub workspace to inspect its source, contract and discrepancies. No example
          repository is substituted.
        </p>
        <Button onClick={() => workspace.setDialogOpen(true)}>
          <Plus size={14} /> Open repository
        </Button>
      </div>
    );
  }

  const selectedSource = concern === "repository" ? reported : desired;

  const authoredSources =
    selectedSource?.path === ".agents/PRD.md"
      ? observedFiles
          .filter(
            (f) =>
              f.type === "file" && f.path.startsWith(".agents/requests/") && f.path.endsWith(".md"),
          )
          .map((f) => f.path)
      : selectedSource?.path === ".agents/ARCHITECTURE.md"
        ? observedFiles
            .filter(
              (f) =>
                f.type === "file" &&
                f.path.startsWith(".agents/decisions/") &&
                f.path.endsWith(".md"),
            )
            .map((f) => f.path)
        : [];
  const documentActions = (
    <div className="factory-view-actions">
      {!selectedFile && selectedSource?.contract && (
        <label className="factory-filter">
          <span className="sr-only">Filter contracts</span>
          <input
            aria-label="Filter contracts"
            type="search"
            value={search}
            placeholder="Filter contracts"
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      )}
      {selectedSource &&
        (selectedSource.path === ".agents/PRD.md" ||
        selectedSource.path === ".agents/ARCHITECTURE.md" ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={!authoredSources.length}>
                <FileCode2 size={13} /> Edit canonical source ({authoredSources.length})
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {authoredSources.map((path) => (
                <DropdownMenuItem key={path} onSelect={() => openEditor(path)}>
                  {path}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button variant="outline" size="sm" onClick={() => openEditor(selectedSource.path)}>
            <FileCode2 size={13} /> Edit source
          </Button>
        ))}
      {selectedFile && (
        <Button variant="ghost" size="sm" onClick={() => factory.selectPath(null)}>
          Clear file selection
        </Button>
      )}
    </div>
  );

  const mainContent =
    concern === "specification" ? (
      <section className="factory-view" aria-label="Specification contracts">
        <header className="factory-view-head">
          <div>
            <span className="factory-view-eyebrow">DESIRED STATE</span>
            <h1>Specification</h1>
            <p>{desired?.path ?? "No approved product specification in this repository."}</p>
          </div>
          {documentActions}
        </header>
        <div className="factory-view-content">{selectedFile ? filesView : contractsView}</div>
      </section>
    ) : concern === "repository" ? (
      <section className="factory-view" aria-label="Repository architecture">
        <header className="factory-view-head">
          <div>
            <span className="factory-view-eyebrow">OBSERVED STATE</span>
            <h1>Repository</h1>
            <p>{reported?.path ?? "No documented architecture in this revision."}</p>
          </div>
          {documentActions}
        </header>
        <div className="factory-view-content">
          {selectedFile ? (
            filesView
          ) : reported?.contract ? (
            contractsView
          ) : (
            <div className="factory-no-selection">
              <FolderTree size={24} />
              <strong>{observedFiles.length} repository paths</strong>
              <p>
                Select a file in the native Explorer to inspect source evidence. Architecture
                documentation is optional and never substituted for code.
              </p>
            </div>
          )}
        </div>
      </section>
    ) : (
      <section className="factory-view" aria-label="Architecture delta">
        <header className="factory-view-head">
          <div>
            <span className="factory-view-eyebrow">EVIDENCE REVIEW</span>
            <h1>Delta</h1>
            <p>
              {delta.length} discrepancies · {drafts.length} reviewable issue drafts
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => runtime.openTab("specification", "main")}
          >
            <BookOpen size={13} /> Inspect target
          </Button>
        </header>
        <div className="factory-delta-layout factory-view-content">
          <section className="factory-delta-findings" aria-label="Observed differences">
            <div className="factory-pane-heading">
              <strong>Differences</strong>
              <span>{delta.length}</span>
            </div>
            {delta.length ? (
              delta.map((finding) => (
                <button
                  type="button"
                  className={`factory-delta-row${finding.path === selectedFile ? " selected" : ""}`}
                  key={finding.id}
                  onClick={() => (finding.path ? factory.selectPath(finding.path) : undefined)}
                >
                  <Status tone={finding.status === "missing" ? "bad" : "warn"}>
                    {finding.status}
                  </Status>
                  <strong>{finding.label}</strong>
                  <span>{finding.explanation}</span>
                </button>
              ))
            ) : (
              <p className="factory-empty">
                No discrepancies are supported by the loaded documents and repository tree. This
                does not assert that implementation is complete.
              </p>
            )}
            {selectedFile && <div className="factory-delta-inspector">{filesView}</div>}
          </section>
          <section className="factory-delta-drafts" aria-label="Issue drafts">
            {issuesView}
          </section>
        </div>
      </section>
    );

  return (
    <div className="factory-workspace">
      {readError && (
        <div role="alert" className="factory-error">
          <CircleAlert size={14} />
          {readError}
        </div>
      )}
      {reading && (
        <div className="factory-loading" role="status">
          Reading repository contracts…
        </div>
      )}
      {concern === "overview" ? (
        <div className="factory-overview">
          <span className="factory-view-eyebrow">PROJECT WORKSPACE</span>
          <h1>{currentRepo.repository.fullName}</h1>
          <p>
            Desired specification, documented architecture and actual repository files share one
            GitHub revision and workbench.
          </p>
          <div className="factory-metrics">
            <div>
              <strong>{registryRecords(target, "requirements").length}</strong>
              <span>Requirements</span>
            </div>
            <div>
              <strong>{observedFiles.filter((file) => file.type === "file").length}</strong>
              <span>Observed files</span>
            </div>
            <div>
              <strong>{delta.length}</strong>
              <span>Discrepancies</span>
            </div>
            <div>
              <strong>{validation.length}</strong>
              <span>Contract errors</span>
            </div>
          </div>
          <div className="factory-evidence">
            <div>
              <Status tone={desired?.contract ? "good" : "warn"}>
                {desired?.contract ? "Parsed" : "Unavailable"}
              </Status>
              <strong>Specification</strong>
              <span>{desired?.path ?? "No project specification"}</span>
            </div>
            <div>
              <Status tone={reported?.contract ? "good" : "warn"}>
                {reported?.contract ? "Parsed" : "Unavailable"}
              </Status>
              <strong>Architecture</strong>
              <span>{reported?.path ?? "No architecture evidence"}</span>
            </div>
            <div>
              <Status tone="good">Revision scoped</Status>
              <strong>Source tree</strong>
              <span>{currentRepo.treeSha.slice(0, 12)}</span>
            </div>
          </div>
          {validation.map((error) => (
            <p className="factory-error" key={error}>
              <CircleAlert size={13} />
              {error}
            </p>
          ))}
          <div className="factory-actions">
            <Button onClick={() => runtime.openTab("specification", "main")}>
              Open specification
            </Button>
            <Button variant="outline" onClick={() => runtime.openTab("delta", "main")}>
              Review discrepancies
            </Button>
            <Button variant="outline" onClick={() => runtime.openTab("repository", "main")}>
              Inspect repository
            </Button>
          </div>
        </div>
      ) : (
        <AnimatePresence mode="wait" initial={false}>
          <motion.main
            key={concern}
            className="factory-main"
            initial={reducedMotion ? false : { opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reducedMotion ? undefined : { opacity: 0 }}
            transition={{ duration: 0.12 }}
          >
            {mainContent}
          </motion.main>
        </AnimatePresence>
      )}
    </div>
  );
}
