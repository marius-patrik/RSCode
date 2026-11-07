import { describe, expect, test } from "bun:test";
import { DocumentService } from "../../src/workspace/document-service";
import { encodeDocumentResourceId } from "../../src/workspace/identity";

const principal = "gh:github.com:1001" as const;
const workspaceUuid = "203c58bb-1336-4d74-bfd9-b5f81d08bf92";
const sessionUuid = "4a333080-117b-4a5c-9e12-151bf90184de";
const workspaceId = `ghcode-owned-v2:${encodeURIComponent(principal)}:${sessionUuid}`;
const resource = encodeDocumentResourceId({
  version: 2,
  id: workspaceId,
  ownership: {
    principalKey: principal,
    workspace: { id: workspaceUuid, principalKey: principal },
    session: {
      id: sessionUuid, principalKey: principal, workspaceId: workspaceUuid,
      repositoryKey: "gh:github.com:repo:42", ref: "refs/heads/main",
    },
  },
  repository: {
    id: 42, name: "private", fullName: "acme/private", owner: "acme",
    private: true, defaultBranch: "main", htmlUrl: "", canPush: true,
  },
  ref: "main", baseSha: "a".repeat(40), treeSha: "b".repeat(40), tree: [], updatedAt: 1,
}, "README.md");

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("GHC-03 durable document lifecycle", () => {
  test("does not acknowledge edits until the storage writer completes", async () => {
    const service = new DocumentService();
    const write = deferred();
    service.bindPrincipal(principal);
    service.acquire(resource, principal, "baseline", () => write.promise);
    const pending = service.edit(resource, "new bytes");
    expect(service.snapshot(resource)?.dirty).toBe(true);
    expect(() => service.assertSafeToNavigate()).toThrow(/not durably acknowledged/);
    write.resolve();
    await pending;
    expect(service.snapshot(resource)?.dirty).toBe(false);
    service.assertSafeToNavigate();
  });

  test("concurrent views share one authoritative content revision", async () => {
    const service = new DocumentService();
    const written: string[] = [];
    service.bindPrincipal(principal);
    service.acquire(resource, principal, "old", async (value) => { written.push(value); });
    service.acquire(resource, principal, "stale initial", async (value) => { written.push(value); });
    expect(service.snapshot(resource)?.content).toBe("old");
    await service.edit(resource, "changed");
    expect(written).toEqual(["changed"]);
    service.release(resource);
    expect(service.snapshot(resource)).not.toBeNull();
    service.release(resource);
    expect(service.snapshot(resource)).toBeNull();
  });

  test("serializes concurrent edits and rejects account-switch stale closures", async () => {
    const service = new DocumentService();
    const first = deferred();
    const written: string[] = [];
    service.bindPrincipal(principal);
    service.acquire(resource, principal, "v0", async (value) => {
      written.push(value);
      if (value === "v1") await first.promise;
    });
    const one = service.edit(resource, "v1");
    const two = service.edit(resource, "v2");
    first.resolve();
    await Promise.all([one, two]);
    expect(written).toEqual(["v1", "v2"]);
    service.bindPrincipal("gh:github.com:2002");
    await expect(service.edit(resource, "forged")).rejects.toThrow(/revoked/);
  });

  test("failed write keeps dirty bytes, reports error and allows an explicit retry", async () => {
    const service = new DocumentService();
    let fail = true;
    service.bindPrincipal(principal);
    service.acquire(resource, principal, "before", async () => {
      if (fail) throw new Error("QuotaExceededError");
    });
    await expect(service.edit(resource, "important")).rejects.toThrow(/Quota/);
    expect(service.snapshot(resource)?.dirty).toBe(true);
    expect(service.snapshot(resource)?.error).toContain("Quota");
    expect(() => service.assertSafeToNavigate()).toThrow(/not durably acknowledged/);
    fail = false;
    await service.flush(resource);
    expect(service.snapshot(resource)?.dirty).toBe(false);
  });

  test("forced cross-tab revocation seals dirty content from another principal and restores on reauthentication", async () => {
    const service = new DocumentService();
    const write = deferred();
    service.bindPrincipal(principal);
    service.acquire(resource, principal, "before", () => write.promise);
    const pending = service.edit(resource, "private draft");
    service.bindPrincipal("gh:github.com:2002");
    expect(service.snapshot(resource)).toBeNull();
    expect(service.hasSuspendedChanges()).toBe(true);
    expect(service.hasAnyUnacknowledgedChanges()).toBe(true);
    expect(service.hasUnacknowledgedChanges()).toBe(false);
    service.assertSafeToNavigate();
    service.bindPrincipal(principal);
    expect(service.snapshot(resource)?.content).toBe("private draft");
    expect(service.snapshot(resource)?.dirty).toBe(true);
    expect(service.hasSuspendedChanges()).toBe(false);
    const retried: string[] = [];
    service.acquire(resource, principal, "stale baseline", async (value) => {
      retried.push(value);
    });
    write.resolve();
    await expect(pending).rejects.toThrow(/revoked/);
    await service.flush(resource);
    expect(retried).toEqual(["private draft"]);
    expect(service.snapshot(resource)?.dirty).toBe(false);
    expect(service.hasAnyUnacknowledgedChanges()).toBe(false);
  });

});
