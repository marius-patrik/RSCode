import { describe, expect, test } from "bun:test";
import { DocumentService } from "../../src/workspace/document-service";
import {
  encodeDocumentResourceId,
  parseDocumentResourceId,
  parseOwnedWorkspaceId,
  type PrincipalKey,
} from "../../src/workspace/identity";
import type { WorkspaceSnapshot } from "../../src/workspace/model";

const a = "gh:github.com:1001" as const;
const b = "gh:github.com:10011" as const;
const anon = "anon:332911d6-7bba-45a7-a65a-c2ba428abb91" as const;
const session = "4a333080-117b-4a5c-9e12-151bf90184de";
const workspaceUuid = "203c58bb-1336-4d74-bfd9-b5f81d08bf92";

function workspace(
  principalKey: PrincipalKey = a,
  repositoryId = 42,
  ref = "refs/heads/main",
  sessionId = session,
): WorkspaceSnapshot {
  const id = `ghcode-owned-v2:${encodeURIComponent(principalKey)}:${sessionId}`;
  return {
    version: 2, id, updatedAt: 1, baseSha: "a".repeat(40), treeSha: "b".repeat(40),
    tree: [], ref: ref.slice("refs/heads/".length),
    repository: {
      id: repositoryId, name: "shared", fullName: "same/name", owner: "same",
      private: true, defaultBranch: "main", htmlUrl: "", canPush: true,
    },
    ownership: {
      principalKey,
      workspace: { id: workspaceUuid, principalKey },
      session: {
        id: sessionId, principalKey, workspaceId: workspaceUuid,
        repositoryKey: `gh:github.com:repo:${repositoryId}`,
        ref: ref as `refs/heads/${string}`,
      },
    },
  };
}
describe("validated document identities", () => {
  test("round trips an exact principal, immutable repository, session, ref and path", () => {
    const id = encodeDocumentResourceId(workspace(), "src/main.ts");
    expect(parseDocumentResourceId(id)).toEqual({
      type: "document", principalKey: a,
      workspaceId: workspace().id, sessionId: session,
      repositoryKey: "gh:github.com:repo:42", ref: "refs/heads/main",
      baseSha: "a".repeat(40), path: "src/main.ts",
    });
  });
  test("principal prefixes do not authorize another account", () => {
    const id = encodeDocumentResourceId(workspace(b), "test.ts");
    const service = new DocumentService();
    service.bindPrincipal(a);
    expect(() => service.acquire(id, a, "", async () => {})).toThrow(/no longer authorized/);
    expect(encodeDocumentResourceId(workspace(a), "test.ts")).not.toBe(id);
    service.bindPrincipal(b);
    expect(() => service.acquire(id, b, "", async () => {})).not.toThrow();
  });
  test("anonymous identity is not interchangeable with a GitHub user", () => {
    const id = encodeDocumentResourceId(workspace(anon), "README.md");
    const service = new DocumentService();
    service.bindPrincipal(a);
    expect(() => service.acquire(id, a, "", async () => {})).toThrow();
    service.bindPrincipal(anon);
    expect(() => service.acquire(id, anon, "", async () => {})).not.toThrow();
  });
  test("same name never equates distinct immutable repository IDs", () => {
    const x = encodeDocumentResourceId(workspace(a, 42), "README.md");
    const y = encodeDocumentResourceId(workspace(a, 43), "README.md");
    expect(x).not.toBe(y);
    expect(parseDocumentResourceId(y)?.repositoryKey).toBe("gh:github.com:repo:43");
  });
  test("ref, source revision and session transitions invalidate old identity equivalence", () => {
    const current = encodeDocumentResourceId(workspace(), "README.md");
    const differentRef = encodeDocumentResourceId(workspace(a, 42, "refs/heads/feature"), "README.md");
    const differentSession = encodeDocumentResourceId(
      workspace(a, 42, "refs/heads/main", "8eb8381e-1bd7-4ceb-b0cf-18a8de62d70d"), "README.md",
    );
    const newRevision = { ...workspace(), baseSha: "c".repeat(40) };
    expect(current).not.toBe(differentRef);
    expect(current).not.toBe(differentSession);
    expect(current).not.toBe(encodeDocumentResourceId(newRevision, "README.md"));
  });
  test("rejects malformed, noncanonical, forged resource encodings", () => {
    const id = encodeDocumentResourceId(workspace(), "README.md");
    const corrupted = [
      id.replace("ghcode-document-v1:", "ghcode-document-v0:"),
      id + ":extra",
      id.replace("gh%3Agithub.com", "gh%3agithub.com"),
      id.replace("repo%3A42", "repo%3A0042"),
      id.replace("README.md", "..%2Fsecret.txt"),
      id.replace("README.md", "%ZZ"),
      id.replace(encodeURIComponent(session), "other-session"),
      id.replace("refs%2Fheads%2Fmain", "refs%2Fheads%2F.."),
      id.replace("a".repeat(40), "not-a-commit"),
    ];
    for (const item of corrupted) expect(parseDocumentResourceId(item)).toBeNull();
    expect(parseOwnedWorkspaceId("ghcode-owned-v2:gh%3Agithub.com%3A1001:not-a-uuid")).toBeNull();
  });
  test("rejects traversal, ambiguous paths and unsupported source revisions", () => {
    for (const path of ["../secret", "/root", "a//b", "a/./b", "a/../b", "a\\b", "a\u0000b"]) {
      expect(() => encodeDocumentResourceId(workspace(), path)).toThrow();
    }
    expect(() => encodeDocumentResourceId({ ...workspace(), baseSha: "partial" }, "ok")).toThrow();
  });
});
