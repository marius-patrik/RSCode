import generated from "./generated/context.json";

/** Immutable, source-provenanced repository context. No browser persistence writer. */
export type SourceDocument = {
  path: string;
  content: string;
  /** Optional immutable ID supplied by a repository adapter. */
  sourceId?: string;
  revision?: string;
};

export type RepositoryIdentity = {
  provider: string;
  id: string;
  ref: string;
  revision: string;
};

export type RepositoryContext = {
  schema: 1 | 2;
  repository: string;
  name: string;
  branch: string;
  revision: string;
  goal: string;
  documents: SourceDocument[];
  paths: string[];
  graphEdges: Array<readonly [string, string]>;
  publication: string;
  repositoryIdentity: RepositoryIdentity | null;
  partial: boolean;
};

const MAX_DOCUMENTS = 256;
const MAX_PATHS = 2048;
const MAX_EDGES = 1024;
const MAX_BYTES = 128_000;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid repository context object.");
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, max = 256): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new Error(`Invalid repository context ${label}.`);
  }
  for (const character of value) {
    if (character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) {
      throw new Error(`Invalid repository context ${label}.`);
    }
  }
  return value;
}

function sourcePath(value: unknown): string {
  const path = text(value, "source path", 1024);
  if (
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("//") ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(path) ||
    /%(?:2e|2f|5c)/i.test(path) ||
    path.split("/").some((part) => part === "." || part === ".." || !part)
  ) {
    throw new Error("Invalid or unsafe source path.");
  }
  return path;
}

const alphabetical = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function sourceEdges(
  documents: SourceDocument[],
  paths: string[],
): Array<readonly [string, string]> {
  const known = new Set([...documents.map((item) => item.path), ...paths]);
  const edges: Array<readonly [string, string]> = [];
  const seen = new Set<string>();
  for (const document of documents) {
    const source = new URL(document.path, "https://repository.invalid/");
    const matches = document.content.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g);
    let inspected = 0;
    for (const match of matches) {
      if (++inspected > 200 || edges.length >= MAX_EDGES) break;
      const candidate = match[1];
      if (!candidate || /^[a-z][a-z0-9+.-]*:/i.test(candidate) || candidate.startsWith("//"))
        continue;
      try {
        const url = new URL(candidate, source);
        if (url.origin !== source.origin) continue;
        const path = sourcePath(decodeURIComponent(url.pathname.slice(1)));
        if (!known.has(path)) continue;
        const key = `${document.path}\u0000${path}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push([document.path, path]);
      } catch {
        // External, unsafe, or unresolved links never become graph relationships.
      }
    }
    if (edges.length >= MAX_EDGES) break;
  }
  return edges.sort((a, b) => alphabetical(a[0], b[0]) || alphabetical(a[1], b[1]));
}

/**
 * Parse selected repository data, reject forged/unsafe source metadata, and
 * expose a bounded deterministic document/graph index. The repository adapter
 * owns selection and source authorization; this read-only parser never fetches
 * inaccessible content or silently falls back to another repository.
 */
export function parseRepositoryContext(input: unknown): RepositoryContext {
  const raw = object(input);
  if (raw.schema !== 1 && raw.schema !== 2)
    throw new Error("Unsupported repository context schema.");
  const repository = text(raw.repository, "repository");
  const name = text(raw.name, "display name");
  const branch = text(raw.branch, "branch");
  const revision = text(raw.revision, "revision");
  const goal =
    typeof raw.goal === "string" && raw.goal.length <= MAX_BYTES
      ? raw.goal
      : "No goal document available.";
  const publication =
    typeof raw.publication === "string" && raw.publication.length <= 512
      ? raw.publication
      : "Read-only source context.";
  if (
    !Array.isArray(raw.documents) ||
    raw.documents.length > MAX_DOCUMENTS ||
    !Array.isArray(raw.paths) ||
    raw.paths.length > MAX_PATHS
  ) {
    throw new Error("Repository context exceeds allowed source limits.");
  }
  const paths = raw.paths.map(sourcePath);
  if (new Set(paths).size !== paths.length)
    throw new Error("Duplicate source paths in repository context.");
  const documents = raw.documents
    .map((candidate) => {
      const document = object(candidate);
      const path = sourcePath(document.path);
      if (typeof document.content !== "string" || document.content.length > MAX_BYTES)
        throw new Error(`Invalid or oversized document: ${path}`);
      const sourceId =
        document.sourceId === undefined ? undefined : text(document.sourceId, "source ID");
      const sourceRevision =
        document.revision === undefined ? undefined : text(document.revision, "document revision");
      return { path, content: document.content, sourceId, revision: sourceRevision };
    })
    .sort((a, b) => alphabetical(a.path, b.path));
  if (new Set(documents.map((doc) => doc.path)).size !== documents.length)
    throw new Error("Duplicate repository document identity.");
  let repositoryIdentity: RepositoryIdentity | null = null;
  if (raw.repositoryIdentity !== undefined && raw.repositoryIdentity !== null) {
    const identity = object(raw.repositoryIdentity);
    repositoryIdentity = {
      provider: text(identity.provider, "provider"),
      id: text(identity.id, "identity"),
      ref: text(identity.ref, "selected ref"),
      revision: text(identity.revision, "source revision"),
    };
    if (repositoryIdentity.ref !== branch || repositoryIdentity.revision !== revision) {
      throw new Error("Selected repository identity and source revision disagree.");
    }
  }
  return {
    schema: raw.schema,
    repository,
    name,
    branch,
    revision,
    goal,
    publication,
    documents,
    paths: [...paths].sort(alphabetical),
    graphEdges: sourceEdges(documents, paths),
    repositoryIdentity,
    partial: raw.partial === true || repositoryIdentity === null,
  };
}

/** The standalone build injects its curated selected repo; a unified host can pass another. */
export const context = parseRepositoryContext(generated);

export function searchRepositoryContext(
  data: RepositoryContext,
  query: string,
  limit = 25,
): SourceDocument[] {
  const needle = query.trim().toLocaleLowerCase();
  const safeLimit = Number.isSafeInteger(limit) ? Math.min(Math.max(limit, 0), 100) : 25;
  return data.documents
    .filter(
      (doc) =>
        doc.path.toLocaleLowerCase().includes(needle) ||
        doc.content.toLocaleLowerCase().includes(needle),
    )
    .slice(0, safeLimit);
}
