/** Project-owned contracts. The workspace and its checked-out ref are the only sources of evidence. */
export type ContractRecord = { id?: string; title?: string; path?: string; [key: string]: unknown };
export type Contract = {
  kind: string;
  schema_version?: string;
  files?: ContractRecord[];
  policy?: { file_tree_complete?: boolean };
  [key: string]: unknown;
};
export type FileEvidence = { path: string; type: "file" | "dir"; content?: string };
export type Discrepancy = {
  id: string;
  kind: "file" | "contract";
  status: "missing" | "changed" | "unexpected" | "unverified";
  path?: string;
  label: string;
  explanation: string;
  desired?: unknown;
  actual?: unknown;
};

export const REGISTRIES = [
  "actors",
  "requirements",
  "features",
  "runtimes",
  "components",
  "algorithms",
  "interfaces",
  "ui",
  "data",
  "invariants",
  "dependencies",
  "quality",
  "acceptance",
  "files",
  "decisions",
] as const;

export function normalizePath(path: string): string {
  return path
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "")
    .replace(/\/{2,}/g, "/");
}

export function parseContract(input: string): { contract: Contract; prose: string } {
  const source = input.replace(/^\uFEFF/, "");
  // Standalone contracts and template-governed generated Markdown share one parser.
  // Only approved source records create generated documents; this never synthesizes project data.
  const frontmatter = source.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  const embedded = source.match(/\`\`\`json[ \t]*\r?\n([\s\S]*?)\r?\n\`\`\`/);
  let candidate: unknown;
  if (frontmatter) {
    try {
      candidate = JSON.parse(frontmatter[1]);
    } catch {
      /* A source-record status header is YAML; its first JSON contract is in a fenced block. */
    }
  }
  if (!candidate && embedded) {
    try {
      candidate = JSON.parse(embedded[1]);
    } catch {
      throw new Error("The project-owned JSON contract block is malformed.");
    }
  }
  if (
    !candidate ||
    Array.isArray(candidate) ||
    typeof candidate !== "object" ||
    typeof (candidate as Contract).kind !== "string"
  ) {
    throw new Error("No valid JSON contract in project-owned Markdown.");
  }
  return {
    contract: candidate as Contract,
    prose:
      frontmatter && candidate && !embedded
        ? source.slice(frontmatter[0].length).trimStart()
        : source,
  };
}

export function compileContract(contract: Contract, prose = ""): string {
  return `---\n${JSON.stringify(contract, null, 2)}\n---\n\n${prose.trim()}${prose.trim() ? "\n" : ""}`;
}

export function registryRecords(contract: Contract | null, registry: string): ContractRecord[] {
  const records = contract?.[registry];
  return Array.isArray(records)
    ? records.filter(
        (record): record is ContractRecord =>
          record && typeof record === "object" && !Array.isArray(record),
      )
    : [];
}

export function desiredPaths(contract: Contract | null): FileEvidence[] {
  return registryRecords(contract, "files").flatMap((record) => {
    if (typeof record.path !== "string") return [];
    const path = normalizePath(record.path);
    if (!path || path.split("/").includes("..") || path.includes("\u0000")) return [];
    return [
      {
        path,
        type:
          record.kind === "dir" || record.kind === "directory"
            ? ("dir" as const)
            : ("file" as const),
        content: typeof record.content === "string" ? record.content : undefined,
      },
    ];
  });
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function validateContract(contract: Contract | null): string[] {
  if (!contract) return ["No target specification found."];
  const errors: string[] = [];
  if (!contract.schema_version) errors.push("Missing schema_version.");
  const ids = new Set<string>();
  for (const registry of REGISTRIES) {
    for (const record of registryRecords(contract, registry)) {
      if (typeof record.id !== "string" || !record.id.trim()) {
        errors.push(`${registry}: record without a stable ID.`);
      } else if (ids.has(record.id)) {
        errors.push(`Duplicate contract ID: ${record.id}.`);
      } else {
        ids.add(record.id);
      }
    }
  }
  const paths = new Set<string>();
  for (const evidence of desiredPaths(contract)) {
    if (paths.has(evidence.path)) errors.push(`Duplicate desired path: ${evidence.path}.`);
    paths.add(evidence.path);
  }
  return errors;
}

/** A missing architecture record is NOT proof that its implementation is missing. */
export function calculateDiscrepancies(
  target: Contract | null,
  reported: Contract | null,
  actual: FileEvidence[],
  completeTree: boolean,
): Discrepancy[] {
  if (!target) return [];
  const changes: Discrepancy[] = [];
  const seen = new Map(actual.map((entry) => [normalizePath(entry.path), entry]));
  const desired = desiredPaths(target);

  for (const file of desired) {
    const found = seen.get(file.path);
    if (!found) {
      if (completeTree) {
        changes.push({
          id: `missing:${file.path}`,
          kind: "file",
          status: "missing",
          label: file.path,
          path: file.path,
          desired: file,
          explanation: "Path absent from the complete selected-revision repository tree.",
        });
      }
      continue;
    }
    if (
      found.type !== file.type ||
      (file.content !== undefined && found.content !== undefined && file.content !== found.content)
    ) {
      changes.push({
        id: `changed:${file.path}`,
        kind: "file",
        status: "changed",
        label: file.path,
        path: file.path,
        desired: file,
        actual: found,
        explanation:
          found.type !== file.type
            ? "Declared and observed path types differ."
            : "Verified source contents differ.",
      });
    }
  }

  if (completeTree && target.policy?.file_tree_complete === true) {
    const paths = new Set(desired.map((entry) => entry.path));
    for (const file of actual.filter((entry) => entry.type === "file")) {
      if (!paths.has(file.path))
        changes.push({
          id: `unexpected:${file.path}`,
          kind: "file",
          status: "unexpected",
          path: file.path,
          label: file.path,
          actual: file,
          explanation: "Path not listed in an explicitly exhaustive desired file manifest.",
        });
    }
  }

  if (reported) {
    const scope = Array.isArray(reported.scope) ? (reported.scope as unknown[]) : null;
    for (const registry of REGISTRIES) {
      if (registry === "files" || (scope && !scope.includes(registry))) continue;
      const observations = new Map(
        registryRecords(reported, registry)
          .filter((r) => r.id)
          .map((r) => [r.id, r]),
      );
      for (const record of registryRecords(target, registry)) {
        if (!record.id) continue;
        const observed = observations.get(record.id);
        if (!observed || stable(record) !== stable(observed)) {
          changes.push({
            id: `contract:${registry}:${record.id}`,
            kind: "contract",
            status: !observed ? "unverified" : "changed",
            label: String(record.title ?? record.id),
            desired: record,
            actual: observed,
            explanation: !observed
              ? "Absent from reported architecture; inspect source before concluding it is unimplemented."
              : "Target and reported documents disagree; source verification is required.",
          });
        }
      }
    }
  }
  return changes;
}

export type DraftIssue = { id: string; title: string; body: string; items: Discrepancy[] };

export function assembleIssueDrafts(changes: Discrepancy[]): DraftIssue[] {
  const groups = new Map<string, Discrepancy[]>();
  for (const change of changes) {
    const group =
      change.kind === "file"
        ? `Files / ${change.path?.split("/")[0] ?? "root"}`
        : "Architecture contracts";
    groups.set(group, [...(groups.get(group) ?? []), change]);
  }
  return Array.from(groups, ([group, items]) => ({
    id: group,
    title: `Reconcile ${group} (${items.length})`,
    items,
    body: [
      "## Desired vs observed",
      ...items.map(
        (item) =>
          `- **${item.status}** \u2014 \`${item.label.replace(/\`/g, "")}\`: ${item.explanation}`,
      ),
      "",
      "## Verification requirements",
      "- Inspect relevant code at the selected revision.",
      "- Confirm discrepancies before implementation.",
      "- Add behavior-driven acceptance tests for accepted changes.",
      "- Reconcile PRD.md and ARCHITECTURE.md.",
      "",
      "_Generated evidence-qualified draft; not an implementation verdict._",
    ].join("\n"),
  }));
}
