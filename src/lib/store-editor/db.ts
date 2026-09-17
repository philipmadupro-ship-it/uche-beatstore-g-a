/**
 * The Store Editor's IndexedDB database.
 *
 * ONE place opens it, on purpose. Version history and the saved-section
 * library both live in this database, and IndexedDB versions are per-database,
 * not per-store: if one module opened at version 1 while the other opened at
 * version 2, whichever asked for the lower number would throw `VersionError`
 * the moment the other had already upgraded. Which module the producer touched
 * first would decide whether the feature worked.
 *
 * So the version and the upgrade handler live here, the handler creates only
 * what is missing, and adding a store later means bumping this number once.
 *
 * Separate from `antigravity-cover-art` and `antigravity-offline` for the
 * reason `document-store.ts` gives: sharing one database means coordinating
 * version bumps between unrelated features, and an upgrade race takes out
 * whichever feature was not being worked on.
 */

const DB_NAME = 'antigravity-store-editor';

/** Bump when adding an object store, and extend the handler below. */
const DB_VERSION = 2;

export const STORE_SNAPSHOTS = 'snapshots';
export const STORE_LIBRARY = 'library';

export function openStoreEditorDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      // Every store is checked, not just the newest: this handler also runs
      // for a database that does not exist yet, where none are present, and
      // for one upgrading from any earlier version.
      if (!db.objectStoreNames.contains(STORE_SNAPSHOTS)) {
        db.createObjectStore(STORE_SNAPSHOTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_LIBRARY)) {
        db.createObjectStore(STORE_LIBRARY, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Read every record from a store, as unknowns for the caller to validate. */
export function readAllRecords(db: IDBDatabase, store: string): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(store, 'readonly').objectStore(store).getAll();
    request.onsuccess = () => resolve(request.result as unknown[]);
    request.onerror = () => reject(request.error);
  });
}

export function putRecord(db: IDBDatabase, store: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(store, 'readwrite').objectStore(store).put(value);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export function getRecord(db: IDBDatabase, store: string, id: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(store, 'readonly').objectStore(store).get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function deleteRecord(db: IDBDatabase, store: string, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(store, 'readwrite').objectStore(store).delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/** Delete several ids in one transaction. */
export function deleteRecords(db: IDBDatabase, store: string, ids: string[]): void {
  if (ids.length === 0) return;
  const objectStore = db.transaction(store, 'readwrite').objectStore(store);
  ids.forEach((id) => objectStore.delete(id));
}
