import type { Page } from "@playwright/test";

/** Read-only forensic database inspector. This is NOT an authorized app cache API. */
export type WorkbenchInspection = {
  version: number;
  stores: Array<{ name: string; records: Array<Record<string, unknown>> }>;
};

export async function inspectWorkbench(page: Page): Promise<WorkbenchInspection> {
  return page.evaluate(async () => {
    const name = "darkfactory-workbench";
    const known = await indexedDB.databases();
    if (!known.some((db) => db.name === name)) {
      throw new Error("Workbench database not initialized");
    }
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      // Never pass an explicit schema version; a v3+ upgrade remains inspectable.
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Open failed"));
      request.onblocked = () => reject(new Error("Open blocked"));
    });
    try {
      const names = Array.from(db.objectStoreNames);
      if (!names.length) return { version: db.version, stores: [] };
      const stores = await new Promise<WorkbenchInspection["stores"]>((resolve, reject) => {
        const transaction = db.transaction(names, "readonly");
        const results = names.map((store) => ({ name: store, records: [] as Array<Record<string, unknown>> }));
        transaction.oncomplete = () => resolve(results);
        transaction.onerror = () => reject(transaction.error ?? new Error("Inspection failed"));
        transaction.onabort = () => reject(transaction.error ?? new Error("Inspection aborted"));
        for (const result of results) {
          const request = transaction.objectStore(result.name).getAll();
          request.onsuccess = () => {
            result.records = request.result as Array<Record<string, unknown>>;
          };
        }
      });
      return { version: db.version, stores };
    } finally {
      db.close();
    }
  });
}

/** The marker must be unique to one test edit; this does not assume v3 store names. */
export async function persistedMarker(page: Page, marker: string): Promise<boolean> {
  const db = await inspectWorkbench(page);
  return db.stores.some((store) => store.records.some((value) => JSON.stringify(value).includes(marker)));
}

/** Frozen v2 stores are guaranteed to remain available after v3 upgrade. */
export async function frozenV2Records(page: Page, storeName: string): Promise<Array<Record<string, unknown>>> {
  if (!["workspaces", "blobs", "overlays", "staged", "committed", "commits"].includes(storeName)) {
    throw new Error("Not a frozen v2 store");
  }
  const db = await inspectWorkbench(page);
  return db.stores.find((store) => store.name === storeName)?.records ?? [];
}
