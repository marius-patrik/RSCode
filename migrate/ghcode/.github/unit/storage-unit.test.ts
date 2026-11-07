import { describe, expect, test } from "bun:test";
import { bindStoragePrincipal, saveWorkspace, commitLocalChanges, clearLocalGitState } from "../../src/workspace/storage";
import type { WorkspaceSnapshot } from "../../src/workspace/model";

const principal = "gh:github.com:1001" as const;
const sessionId = "4a333080-117b-4a5c-9e12-151bf90184de";
const workspaceId = "203c58bb-1336-4d74-bfd9-b5f81d08bf92";
const id = `ghcode-owned-v2:${encodeURIComponent(principal)}:${sessionId}`;

function fixture(): WorkspaceSnapshot {
  return {
    version: 2, id, updatedAt: 1, baseSha: "a", treeSha: "b", tree: [], ref: "main",
    repository: {
      id: 42, name: "private", fullName: "acme/private", owner: "acme",
      private: true, defaultBranch: "main", htmlUrl: "", canPush: true,
    },
    ownership: {
      principalKey: principal,
      workspace: { id: workspaceId, principalKey: principal },
      session: {
        id: sessionId, workspaceId, principalKey: principal,
        repositoryKey: "gh:github.com:repo:42", ref: "refs/heads/main",
      },
    },
  };
}

type Behavior = "hold" | "abort";
function fakeIndexedDB(behavior: Behavior) {
  const original = globalThis.indexedDB;
  let notifyRequest!: () => void;
  const requestDone = new Promise<void>((resolve) => { notifyRequest = resolve; });
  let finish!: () => void;
  let abort!: () => void;
  const database = {
    close() {},
    transaction() {
      const tx: {
        oncomplete?: () => void;
        onabort?: () => void;
        onerror?: () => void;
        error: Error | null;
        abort: () => void;
        objectStore: () => { get: () => unknown; put: () => unknown };
      } = {
        error: null,
        abort() { tx.error = new Error("AbortError"); tx.onabort?.(); },
        objectStore() {
          return {
            get() {
              const request: { result?: WorkspaceSnapshot; onsuccess?: () => void } = {};
              queueMicrotask(() => { request.result = undefined; request.onsuccess?.(); });
              return request;
            },
            put() {
              const operation: { result?: string; onsuccess?: () => void; onerror?: () => void } = {};
              queueMicrotask(() => {
                operation.result = "saved";
                operation.onsuccess?.();
                notifyRequest();
                if (behavior === "abort") queueMicrotask(() => tx.abort());
              });
              return operation;
            },
          };
        },
      };
      finish = () => tx.oncomplete?.();
      abort = () => tx.abort();
      return tx;
    },
  };
  globalThis.indexedDB = {
    open() {
      const request: { result?: typeof database; onsuccess?: () => void; onerror?: () => void } = {};
      queueMicrotask(() => { request.result = database; request.onsuccess?.(); });
      return request;
    },
  } as unknown as IDBFactory;
  return { requestDone, complete: () => finish(), abort: () => abort(), restore: () => { globalThis.indexedDB = original; } };
}

describe("GHC-02 storage transaction and identity hardening", () => {
  test("a request success does not acknowledge an aborted transaction", async () => {
    bindStoragePrincipal(principal);
    const fake = fakeIndexedDB("abort");
    try {
      await expect(saveWorkspace(fixture())).rejects.toThrow("AbortError");
    } finally { fake.restore(); }
  });

  test("a successful write stays pending until the transaction commits", async () => {
    bindStoragePrincipal(principal);
    const fake = fakeIndexedDB("hold");
    try {
      let settled = false;
      const pending = saveWorkspace(fixture()).then(() => { settled = true; });
      await fake.requestDone;
      await Promise.resolve();
      expect(settled).toBe(false);
      fake.complete();
      await pending;
      expect(settled).toBe(true);
    } finally { fake.restore(); }
  });

  test("another principal cannot use a valid workspace ID from account A", () => {
    bindStoragePrincipal("gh:github.com:2002");
    expect(() => saveWorkspace(fixture())).toThrow(/verified principal/);
    bindStoragePrincipal(principal);
  });
});

type TestRecord = { workspaceId: string; key?: string; id?: string; [key: string]: unknown };
function fakeMultiStore(records: Record<string, TestRecord[]>, expectedReads: number) {
  const original = globalThis.indexedDB;
  const actions: Array<{ store: string; op: "put" | "add" | "delete"; value: unknown }> = [];
  const transactionStores: string[][] = [];
  let readCount = 0;
  let resolveReads!: () => void;
  const readsReady = new Promise<void>(resolve => { resolveReads = resolve; });
  let finish!: () => void;
  let aborted = false;
  const db = {
    close() {},
    transaction(names: string[]) {
      transactionStores.push(names);
      const tx: {
        oncomplete?: () => void;
        onerror?: () => void;
        onabort?: () => void;
        error: Error | null;
        abort: () => void;
        objectStore: (name: string) => {
          getAll: () => unknown;
          get: (key: string) => unknown;
          put: (value: unknown) => unknown;
          add: (value: unknown) => unknown;
          delete: (value: unknown) => unknown;
        };
      } = {
        error: null,
        abort() {
          aborted = true;
          tx.error = new Error("AbortError");
          tx.onabort?.();
        },
        objectStore(name: string) {
          return {
            get(key: string) {
              const request: { result?: WorkspaceSnapshot; onsuccess?: () => void } = {};
              queueMicrotask(() => {
                request.result = name === "workspaces" && key === id ? fixture() : undefined;
                request.onsuccess?.();
              });
              return request;
            },
            getAll() {
              const request: { result?: TestRecord[]; onsuccess?: () => void } = {};
              queueMicrotask(() => {
                request.result = records[name] ?? [];
                request.onsuccess?.();
                readCount++;
                if (readCount === expectedReads) resolveReads();
              });
              return request;
            },
            put(value: unknown) { actions.push({ store: name, op: "put", value }); return {}; },
            add(value: unknown) { actions.push({ store: name, op: "add", value }); return {}; },
            delete(value: unknown) { actions.push({ store: name, op: "delete", value }); return {}; },
          };
        },
      };
      finish = () => tx.oncomplete?.();
      return tx;
    },
  };
  globalThis.indexedDB = {
    open() {
      const request: { result?: typeof db; onsuccess?: () => void } = {};
      queueMicrotask(() => { request.result = db; request.onsuccess?.(); });
      return request;
    },
  } as unknown as IDBFactory;
  return {
    readsReady, actions, transactionStores,
    complete: () => finish(), isAborted: () => aborted,
    restore: () => { globalThis.indexedDB = original; },
  };
}

describe("atomic GHCode staged commits and remote-push cleanup", () => {
  test("staged removal, committed state, overlays and commit ID share one transaction", async () => {
    bindStoragePrincipal(principal);
    const staged = {
      key: `${id}:README.md`, workspaceId: id, path: "README.md",
      status: "modified" as const, content: "new text", baseSha: "base",
      updatedAt: 1, stagedAt: 2,
    };
    const operation = {
      id: `${id}:local:2:unique`, workspaceId: id, message: "Save",
      createdAt: 2, files: [{ ...staged }],
    };
    const mock = fakeMultiStore({ staged: [staged], overlays: [{ ...staged }] }, 2);
    try {
      let acknowledged = false;
      const pending = commitLocalChanges(operation, [staged]).then(() => { acknowledged = true; });
      await mock.readsReady;
      expect(mock.transactionStores).toEqual([["workspaces", "staged", "overlays", "committed", "commits"]]);
      expect(mock.actions.map(action => `${action.store}.${action.op}`).sort()).toEqual([
        "commits.add", "committed.put", "overlays.delete", "staged.delete",
      ].sort());
      expect(acknowledged).toBe(false);
      mock.complete();
      await pending;
      expect(acknowledged).toBe(true);
    } finally { mock.restore(); }
  });

  test("concurrently changed staging aborts before any mutation", async () => {
    bindStoragePrincipal(principal);
    const file = {
      key: `${id}:README.md`, workspaceId: id, path: "README.md",
      status: "modified" as const, content: "first", updatedAt: 1, stagedAt: 2,
    };
    const mock = fakeMultiStore({
      staged: [{ ...file, content: "changed in second tab" }], overlays: [],
    }, 2);
    try {
      const pending = commitLocalChanges({
        id: `${id}:local:2:unique`, workspaceId: id, message: "Save",
        createdAt: 2, files: [{ ...file }],
      }, [file]);
      await expect(pending).rejects.toThrow("Staged state changed concurrently");
      expect(mock.isAborted()).toBe(true);
      expect(mock.actions).toHaveLength(0);
    } finally { mock.restore(); }
  });

  test("clear Git state uses one transaction, leaves other accounts untouched", async () => {
    bindStoragePrincipal(principal);
    const foreign = "ghcode-owned-v2:gh%3Agithub.com%3A2002:other";
    const mock = fakeMultiStore({
      staged: [{ workspaceId: id, key: `${id}:a` },
               { workspaceId: foreign, key: `${foreign}:private` }],
      committed: [{ workspaceId: id, key: `${id}:a` }],
      commits: [{ workspaceId: id, id: `${id}:local:1:one` }],
    }, 3);
    try {
      const pending = clearLocalGitState(id);
      await mock.readsReady;
      expect(mock.transactionStores).toEqual([["workspaces", "staged", "committed", "commits"]]);
      expect(mock.actions.filter(a => a.op === "delete")).toHaveLength(3);
      expect(mock.actions.some(a => String(a.value).includes("private"))).toBe(false);
      mock.complete();
      await pending;
    } finally { mock.restore(); }
  });
});
