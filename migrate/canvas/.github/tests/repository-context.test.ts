import { describe, expect, test } from "bun:test";
import { parseRepositoryContext, searchRepositoryContext } from "../app/src/repository-context";

const fixture = {
  schema: 2, repository: "owner/repo", name: "Target repo", branch: "main",
  revision: "0123456789ab", publication: "Read-only repository documents",
  repositoryIdentity: { provider: "github", id: "42", ref: "main", revision: "0123456789ab" },
  goal: "Build a deterministic graph",
  documents: [
    { path: "docs/Z.md", content: "See [A](./A.md) and [outside](https://example.com/)." },
    { path: "docs/A.md", content: "Plan: implementation" },
  ],
  paths: ["docs/A.md", "docs/Z.md"],
};

describe("source-owned Canvas context", () => {
  test("honors explicit selected repository identity and deterministic provenance", () => {
    const context = parseRepositoryContext(fixture);
    expect(context.repositoryIdentity).toEqual(fixture.repositoryIdentity);
    expect(context.partial).toBe(false);
    expect(context.documents.map((item) => item.path)).toEqual(["docs/A.md", "docs/Z.md"]);
    expect(context.graphEdges).toEqual([["docs/Z.md", "docs/A.md"]]);
    expect(searchRepositoryContext(context, "implementation").map((item) => item.path))
      .toEqual(["docs/A.md"]);
  });
  test("supports partial repositories without synthesizing absent documents or IDs", () => {
    const result = parseRepositoryContext({
      schema: 1, repository: "Current repository", name: "Unknown",
      branch: "local", revision: "abc", documents: [], paths: [],
    });
    expect(result.documents).toEqual([]);
    expect(result.repositoryIdentity).toBeNull();
    expect(result.partial).toBe(true);
    expect(result.graphEdges).toEqual([]);
  });
  test("rejects unsafe source paths and duplicate source document identities", () => {
    for (const path of ["../private", "/absolute", "x/../.env", "C:/secret", "a\\b", "x%2Fy"]) {
      expect(() => parseRepositoryContext({
        ...fixture, documents: [{ path, content: "private" }],
      })).toThrow();
    }
    expect(() => parseRepositoryContext({
      ...fixture, documents: [fixture.documents[0], fixture.documents[0]],
    })).toThrow(/Duplicate/);
  });
  test("rejects identity mismatch and oversized source data", () => {
    expect(() => parseRepositoryContext({
      ...fixture, repositoryIdentity: { ...fixture.repositoryIdentity, ref: "other" },
    })).toThrow(/disagree/);
    expect(() => parseRepositoryContext({
      ...fixture, documents: [{ path: "docs/A.md", content: "x".repeat(128001) }],
    })).toThrow(/oversized/);
    expect(() => parseRepositoryContext({
      ...fixture, paths: Array.from({ length: 2049 }, (_, n) => `doc-${n}`),
    })).toThrow(/limits/);
  });
  test("bounds links and ignores off-repository and malformed relationships", () => {
    const docs = Array.from({ length: 40 }, (_, n) => ({
      path: `docs/${n}.md`,
      content: Array.from({ length: 80 }, (_, m) =>
        `[link](./${(n + m) % 40}.md)`).join(" "),
    }));
    const result = parseRepositoryContext({
      ...fixture, documents: docs, paths: docs.map((d) => d.path),
    });
    expect(result.graphEdges.length).toBeLessThanOrEqual(1024);
    expect(result.graphEdges.every(([from, to]) =>
      from.startsWith("docs/") && to.startsWith("docs/"))).toBe(true);
    expect(searchRepositoryContext(result, "", 999).length).toBeLessThanOrEqual(100);
  });
});
