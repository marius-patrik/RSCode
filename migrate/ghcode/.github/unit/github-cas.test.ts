import { describe, expect, test } from "bun:test";
import { updateGithubBranchRef } from "../../src/github/client";

const before = "a".repeat(40);
const after = "b".repeat(40);

type Call = { url: string; body: { query: string; variables: Record<string, any> } };
function captureGraphql(failMutation = false) {
  const original = globalThis.fetch;
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Call["body"];
    calls.push({ url: String(url), body });
    const payload = calls.length === 1
      ? { data: { repository: { id: "R_kgDOexample" } } }
      : failMutation
        ? { errors: [{ message: "Ref must match beforeOid" }] }
        : { data: { updateRefs: { clientMutationId: null } } };
    return new Response(JSON.stringify(payload), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}
describe("GitHub conditional ref mutation", () => {
  test("uses exact expected-old-SHA through GraphQL beforeOid, never REST PATCH", async () => {
    const transport = captureGraphql();
    try {
      await updateGithubBranchRef("example/project", "development", before, after, "token");
      expect(transport.calls).toHaveLength(2);
      expect(transport.calls.every((c) => c.url === "https://api.github.com/graphql")).toBe(true);
      const input = transport.calls[1].body.variables.input;
      expect(input.repositoryId).toBe("R_kgDOexample");
      expect(input.refUpdates).toEqual([{
        name: "refs/heads/development", beforeOid: before, afterOid: after, force: false,
      }]);
    } finally { transport.restore(); }
  });
  test("fails closed on expected-old-SHA conflict", async () => {
    const transport = captureGraphql(true);
    try {
      await expect(updateGithubBranchRef("example/project", "main", before, after, "token"))
        .rejects.toThrow(/beforeOid/);
      expect(transport.calls).toHaveLength(2);
    } finally { transport.restore(); }
  });
  test("invalid ref, SHA and missing token never reach remote mutation", async () => {
    const transport = captureGraphql();
    try {
      await expect(updateGithubBranchRef("example/project", "main", "bad", after, "token"))
        .rejects.toThrow();
      await expect(updateGithubBranchRef("example/project", "heads/main", before, "bad", "token"))
        .rejects.toThrow();
      await expect(updateGithubBranchRef("example/project", "../escape", before, after, "token"))
        .rejects.toThrow();
      await expect(updateGithubBranchRef("example/project", "main", before, after, null))
        .rejects.toThrow();
      expect(transport.calls).toHaveLength(0);
    } finally { transport.restore(); }
  });
});
