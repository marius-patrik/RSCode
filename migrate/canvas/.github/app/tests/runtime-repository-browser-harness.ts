// Test-only browser composition: inject a real async repository adapter into
// the same read-only React provider used by the migrated Canvas UI.
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import type { RepositoryIdentity } from "../src/repository-context";
import {
  RuntimeRepositoryProvider,
  type RuntimeRepositoryAdapter,
  useRuntimeRepository,
} from "../src/runtime-repository";

const A: RepositoryIdentity = {
  provider: "github",
  id: "101",
  ref: "refs/heads/main",
  revision: "a".repeat(40),
};
const B: RepositoryIdentity = {
  provider: "github",
  id: "202",
  ref: "refs/heads/development",
  revision: "b".repeat(40),
};
const FORGED: RepositoryIdentity = {
  provider: "github",
  id: "303",
  ref: "refs/heads/forged",
  revision: "c".repeat(40),
};

const adapter: RuntimeRepositoryAdapter = {
  async load(selection, _signal) {
    // Deliberately ignore AbortSignal for A so stale completion must still be
    // rejected by the provider generation fence rather than lucky cancellation.
    await new Promise((resolve) => setTimeout(resolve, selection.id === A.id ? 220 : 25));
    const actual = selection.id === FORGED.id ? A : selection;
    return {
      schema: 2,
      repository: `owner/repository-${actual.id}`,
      name: `Repository ${actual.id}`,
      branch: actual.ref,
      revision: actual.revision,
      goal: "source navigation",
      documents: [{ path: "README.md", content: `PRIVATE_SOURCE_${actual.id}` }],
      paths: ["README.md"],
      graphEdges: [],
      publication: "Runtime selected source",
      repositoryIdentity: actual,
      partial: false,
    };
  },
  async list() {
    return [A, B, FORGED];
  },
};

function Harness() {
  const { context, selection, select, loading, error } = useRuntimeRepository();
  return createElement(
    "main",
    {},
    createElement(
      "button",
      { type: "button", id: "repo-a", onClick: () => select(A) },
      "Repository A",
    ),
    createElement(
      "button",
      { type: "button", id: "repo-b", onClick: () => select(B) },
      "Repository B",
    ),
    createElement(
      "button",
      { type: "button", id: "repo-forged", onClick: () => select(FORGED) },
      "Forged repository",
    ),
    createElement(
      "button",
      { type: "button", id: "repo-invalid", onClick: () => select({ ...A, id: "" }) },
      "Invalid identity",
    ),
    createElement("output", { id: "selected" }, selection?.id ?? "none"),
    createElement("output", { id: "loading" }, String(loading)),
    createElement(
      "output",
      { id: "source" },
      context?.documents.map((doc) => doc.content).join("\n") ?? "",
    ),
    createElement("output", { id: "error", role: error ? "alert" : undefined }, error ?? ""),
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Browser injected repository adapter harness has no root element.");
createRoot(root).render(
  createElement(RuntimeRepositoryProvider, { adapter, selected: A }, createElement(Harness)),
);
