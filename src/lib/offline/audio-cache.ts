/**
 * IndexedDB-backed cache for audio blobs so tracks can play offline.
 *
 * Two stores:
 *   - blobs:    keyed by track_id → Blob
 *   - meta:     keyed by track_id → { id, url, size, cached_at, title }
 *
 * Cached blobs are exposed via `cachedAudioSrc(track_id)` which returns a
 * blob: URL when present, falling back to the network proxy URL otherwise.
 */

const DB_NAME = 'antigravity-offline';
const DB_VERSION = 1;
const STORE_BLOBS = 'blobs';
const STORE_META = 'meta';

export interface OfflineMeta {
  id: string;
  url: string;
  title: string;
  size: number;
  cached_at: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB not available'));
  }
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_BLOBS)) {
        db.createObjectStore(STORE_BLOBS);
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(storeNames: string | string[], mode: IDBTransactionMode, fn: (tx: IDBTransaction) => Promise<T> | T): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(storeNames, mode);
        Promise.resolve(fn(t))
          .then((value) => {
            t.oncomplete = () => resolve(value);
            t.onerror = () => reject(t.error);
            t.onabort = () => reject(t.error);
          })
          .catch(reject);
      })
  );
}

export async function cacheTrack(
  trackId: string,
  url: string,
  title: string,
  onProgress?: (loaded: number, total: number) => void
): Promise<OfflineMeta> {
  // Inactivity guard: if the download stalls (a hung fetch or a reader that
  // never delivers another chunk), abort so the promise REJECTS instead of
  // hanging forever. Without this the caller's `downloading` state never
  // cleared, so the "Caching…" indicator stuck on screen indefinitely.
  const STALL_MS = 30_000;
  const controller = new AbortController();
  let stallTimer: ReturnType<typeof setTimeout> | null = null;
  const armStall = () => {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => controller.abort(), STALL_MS);
  };

  try {
    armStall();
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Failed to fetch audio (${res.status})`);

    const total = Number(res.headers.get('content-length') || 0);
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          loaded += value.byteLength;
          armStall(); // progress made — reset the stall clock
          if (onProgress && total) onProgress(loaded, total);
        }
      }
    } else {
      const buf = await res.arrayBuffer();
      chunks.push(new Uint8Array(buf));
      loaded = buf.byteLength;
    }

    const blob = new Blob(chunks as BlobPart[], { type: res.headers.get('content-type') || 'audio/mpeg' });
    const meta: OfflineMeta = {
      id: trackId,
      url,
      title,
      size: blob.size,
      cached_at: Date.now(),
    };

    await tx([STORE_BLOBS, STORE_META], 'readwrite', (t) => {
      t.objectStore(STORE_BLOBS).put(blob, trackId);
      t.objectStore(STORE_META).put(meta);
    });

    return meta;
  } finally {
    if (stallTimer) clearTimeout(stallTimer);
  }
}

export async function getCachedBlob(trackId: string): Promise<Blob | null> {
  return tx(STORE_BLOBS, 'readonly', (t) => {
    return new Promise<Blob | null>((resolve, reject) => {
      const req = t.objectStore(STORE_BLOBS).get(trackId);
      req.onsuccess = () => resolve((req.result as Blob) || null);
      req.onerror = () => reject(req.error);
    });
  });
}

export async function getCachedMeta(trackId: string): Promise<OfflineMeta | null> {
  return tx(STORE_META, 'readonly', (t) => {
    return new Promise<OfflineMeta | null>((resolve, reject) => {
      const req = t.objectStore(STORE_META).get(trackId);
      req.onsuccess = () => resolve((req.result as OfflineMeta) || null);
      req.onerror = () => reject(req.error);
    });
  });
}

export async function listCached(): Promise<OfflineMeta[]> {
  return tx(STORE_META, 'readonly', (t) => {
    return new Promise<OfflineMeta[]>((resolve, reject) => {
      const req = t.objectStore(STORE_META).getAll();
      req.onsuccess = () => resolve((req.result as OfflineMeta[]) || []);
      req.onerror = () => reject(req.error);
    });
  });
}

export async function removeCached(trackId: string): Promise<void> {
  await tx([STORE_BLOBS, STORE_META], 'readwrite', (t) => {
    t.objectStore(STORE_BLOBS).delete(trackId);
    t.objectStore(STORE_META).delete(trackId);
  });
}

export async function clearAllCached(): Promise<void> {
  await tx([STORE_BLOBS, STORE_META], 'readwrite', (t) => {
    t.objectStore(STORE_BLOBS).clear();
    t.objectStore(STORE_META).clear();
  });
}

/** In-memory map of trackId → object URL so we don't recreate them per render. */
const blobUrlMap = new Map<string, string>();

export async function getOfflineSrc(trackId: string): Promise<string | null> {
  const cached = blobUrlMap.get(trackId);
  if (cached) return cached;
  const blob = await getCachedBlob(trackId);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  blobUrlMap.set(trackId, url);
  return url;
}

export function revokeOfflineSrc(trackId: string) {
  const url = blobUrlMap.get(trackId);
  if (url) {
    URL.revokeObjectURL(url);
    blobUrlMap.delete(trackId);
  }
}
