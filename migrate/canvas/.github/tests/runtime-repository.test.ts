import { describe, expect, test } from "bun:test";
import { verifyRuntimeContext } from "../app/src/runtime-repository";
import type { RepositoryIdentity } from "../app/src/repository-context";

const selection: RepositoryIdentity = {
  provider: "github", id: "42", ref: "refs/heads/development",
  revision: "a".repeat(40),
};
function fixture(partial = false) {
  return {
    schema: 2,
    repository: "example/runtime",
    name: "Selected repository",
    branch: selection.ref,
    revision: selection.revision,
    goal: "",
    documents: [{ path: "README.md", content: "# Dynamic source" }],
    paths: ["README.md"],
    graphEdges: [],
    publication: "Runtime selected source",
    repositoryIdentity: selection,
    partial,
  };
}
describe("runtime repository context", () => {
  test("accepts only matching immutable repository/ref/revision", () => {
    const data = verifyRuntimeContext(fixture(), selection);
    expect(data.repository).toBe("example/runtime");
    expect(data.repositoryIdentity).toEqual(selection);
    expect(data.documents[0].content).toBe("# Dynamic source");
  });
  test("refuses to leak stale content after a repository or ref switch", () => {
    const original = fixture();
    for (const wrong of [
      { ...selection, id: "43" },
      { ...selection, ref: "refs/heads/main" },
      { ...selection, revision: "b".repeat(40) },
      { ...selection, provider: "other" },
    ]) expect(() => verifyRuntimeContext(original, wrong)).toThrow(/immutable identity/);
  });
  test("runtime adapter requires explicit identity, not generated implicit selection", () => {
    const noIdentity = { ...fixture(), repositoryIdentity: null };
    expect(() => verifyRuntimeContext(noIdentity, selection)).toThrow(/immutable identity/);
    const legacy = { ...fixture(), schema: 1 };
    expect(() => verifyRuntimeContext(legacy, selection)).toThrow(/immutable identity/);
  });
  test("accepts partial, empty repository metadata without inventing documents", () => {
    const parsed = verifyRuntimeContext({
      ...fixture(true), documents: [], paths: [], goal: "No context found",
    }, selection);
    expect(parsed.partial).toBe(true);
    expect(parsed.documents).toEqual([]);
    expect(parsed.graphEdges).toEqual([]);
  });
  test("rejects unsafe source documents and oversized contexts", () => {
    expect(() => verifyRuntimeContext({
      ...fixture(), documents: [{ path: "../secret", content: "forged" }],
    }, selection)).toThrow();
    expect(() => verifyRuntimeContext({
      ...fixture(), documents: Array.from({ length: 257 }, (_, index) => ({
        path: "doc-" + index + ".md", content: "test",
      })),
    }, selection)).toThrow();
  });
});
