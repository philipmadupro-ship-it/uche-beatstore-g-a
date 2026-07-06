/**
 * Persistent, LRU-capped cache for store PREVIEW clips — the "Spotify-instant"
 * layer. Separate from the offline-downloads cache (lib/offline/audio-cache.ts,
 * which holds tracks the user explicitly saved and is surfaced on /offline).
 * This one is filled automatically in the background as pages load, so tapping
 * a beat plays from a local blob with zero network latency.
 *
 * Design notes:
 *   - Own IndexedDB (`antigravity-preview-cache`) so auto-prefetched clips never
 *     show up in, or evict, the user's explicit offline downloads.
 *   - LRU eviction by `last_used`, capped at MAX_ENTRIES / MAX_BYTES so a big
 *     catalogue can't fill the device.
 *   - Bandwidth-aware: `canPrefetch()` bails on Save-Data / 2g so we never burn
 *     a metered mobile connection prefetching audio the user didn't ask for.
 *   - Master-safe: we only prefetch direct https preview URLs and hard-skip any
 *     response over PREVIEW_MAX_BYTES, so a track whose preview hasn't been
 *     generated yet (proxy fallback → full ~80MB WAV) is never cached.
 */

const DB_NAME = 'antigravity-preview-cache';
const DB_VERSION = 1;
const STORE_BLOBS = 'blobs';
const STORE_META = 'meta';

const MAX_ENTRIES = 80;
const MAX_BYTES = 80 * 1024 * 1024;
const PREVIEW_MAX_BYTES = 8 * 1024 * 1024; // previews are ~1MB; bigger = a master, skip
const FETCH_TIMEOUT_MS = 20_000;
const MAX_CONCURRENT = 2;
const MAX_QUEUE_PER_CALL = 30;

interface PreviewMeta {
  id: string;
  size: number;
  cached_at: number;
  last_used: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('no indexedDB'));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_BLOBS)) db.createObjectStore(STORE_BLOBS);
      if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(stores: string | string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => Promise<T> | T): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(stores, mode);
        Promise.resolve(fn(t))
          .then((value) => {
            t.oncomplete = () => resolve(value);
            t.onerror = () => reject(t.error);
            t.onabort = () => reject(t.error);
          })
          .catch(reject);
      }),
  );
}

/** True when it's reasonable to prefetch audio on this connection. */
export function canPrefetch(): boolean {
  if (typeof navigator === 'undefined' || typeof indexedDB === 'undefined') return false;
  const c = (navigator as unknown as { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (c?.saveData) return false;
  if (c?.effectiveType && /(^|-)?(slow-2g|2g)$/.test(c.effectiveType)) return false;
  return true;
}

async function getMeta(id: string): Promise<PreviewMeta | null> {
  return tx(STORE_META, 'readonly', (t) =>
    new Promise<PreviewMeta | null>((resolve, reject) => {
      const r = t.objectStore(STORE_META).get(id);
      r.onsuccess = () => resolve((r.result as PreviewMeta) || null);
      r.onerror = () => reject(r.error);
    }),
  ).catch(() => null);
}

async function getBlob(id: string): Promise<Blob | null> {
  return tx(STORE_BLOBS, 'readonly', (t) =>
    new Promise<Blob | null>((resolve, reject) => {
      const r = t.objectStore(STORE_BLOBS).get(id);
      r.onsuccess = () => resolve((r.result as Blob) || null);
      r.onerror = () => reject(r.error);
    }),
  ).catch(() => null);
}

/** Update last_used so LRU keeps hot previews. Fire-and-forget. */
function touch(id: string): void {
  void (async () => {
    const meta = await getMeta(id);
    if (!meta) return;
    meta.last_used = Date.now();
    await tx(STORE_META, 'readwrite', (t) => t.objectStore(STORE_META).put(meta)).catch(() => {});
  })();
}

async function enforceCap(): Promise<void> {
  const all = await tx(STORE_META, 'readonly', (t) =>
    new Promise<PreviewMeta[]>((resolve, reject) => {
      const r = t.objectStore(STORE_META).getAll();
      r.onsuccess = () => resolve((r.result as PreviewMeta[]) || []);
      r.onerror = () => reject(r.error);
    }),
  ).catch(() => [] as PreviewMeta[]);

  const totalBytes = all.reduce((s, m) => s + (m.size || 0), 0);
  if (all.length <= MAX_ENTRIES && totalBytes <= MAX_BYTES) return;

  // Evict least-recently-used until back under both caps.
  const byLru = [...all].sort((a, b) => a.last_used - b.last_used);
  let entries = all.length;
  let bytes = totalBytes;
  const evict: string[] = [];
  for (const m of byLru) {
    if (entries <= MAX_ENTRIES && bytes <= MAX_BYTES) break;
    evict.push(m.id);
    entries -= 1;
    bytes -= m.size || 0;
  }
  if (!evict.length) return;
  await tx([STORE_BLOBS, STORE_META], 'readwrite', (t) => {
    for (const id of evict) {
      t.objectStore(STORE_BLOBS).delete(id);
      t.objectStore(STORE_META).delete(id);
      revokePreviewSrc(id);
    }
  }).catch(() => {});
}

const blobUrlMap = new Map<string, string>();

/** Return a local blob: URL for a cached preview, or null. Bumps LRU. */
export async function getPreviewSrc(id: string | null | undefined): Promise<string | null> {
  if (!id || typeof indexedDB === 'undefined') return null;
  const cached = blobUrlMap.get(id);
  if (cached) { touch(id); return cached; }
  const blob = await getBlob(id);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  blobUrlMap.set(id, url);
  touch(id);
  return url;
}

/**
 * Synchronous in-memory lookup — the tap-to-play fast path. Returns a blob:
 * URL only when the preview has already been warmed into memory (by prefetch
 * or a previous play), letting the player set `audio.src` with zero async work
 * between the tap and playback.
 */
export function peekPreviewSrc(id: string | null | undefined): string | null {
  if (!id) return null;
  const url = blobUrlMap.get(id) ?? null;
  if (url) touch(id);
  return url;
}

function revokePreviewSrc(id: string): void {
  const url = blobUrlMap.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    blobUrlMap.delete(id);
  }
}

/** Fetch + store one preview. Best-effort; silently no-ops on any failure. */
export async function prefetchPreview(id: string, url: string): Promise<void> {
  if (!id || !url || typeof indexedDB === 'undefined') return;
  // Only cache direct http(s) previews — never the proxy fallback (which may
  // stream a full master for un-previewed tracks).
  if (!/^https?:\/\//i.test(url)) return;
  if (await getMeta(id)) {
    // Cached in a previous session — hydrate the in-memory blob URL so the
    // synchronous peekPreviewSrc fast path hits on the first tap.
    await getPreviewSrc(id);
    return;
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, mode: 'cors', credentials: 'omit' });
    if (!res.ok) return;
    const len = Number(res.headers.get('content-length') || 0);
    if (len > PREVIEW_MAX_BYTES) { ctrl.abort(); return; } // don't cache masters
    const blob = await res.blob();
    if (blob.size === 0 || blob.size > PREVIEW_MAX_BYTES) return;
    const meta: PreviewMeta = { id, size: blob.size, cached_at: Date.now(), last_used: Date.now() };
    await tx([STORE_BLOBS, STORE_META], 'readwrite', (t) => {
      t.objectStore(STORE_BLOBS).put(blob, id);
      t.objectStore(STORE_META).put(meta);
    });
    // Warm the in-memory blob URL right away so the first tap after prefetch
    // is fully synchronous (no IndexedDB read between tap and playback).
    if (!blobUrlMap.has(id)) blobUrlMap.set(id, URL.createObjectURL(blob));
    await enforceCap();
  } catch {
    // best-effort — playback still works by streaming directly.
  } finally {
    clearTimeout(timer);
  }
}

// ── Concurrency-limited background queue ────────────────────────────────────
const queue: Array<{ id: string; url: string }> = [];
const seen = new Set<string>();
let active = 0;

function pump(): void {
  while (active < MAX_CONCURRENT && queue.length) {
    const item = queue.shift()!;
    active += 1;
    prefetchPreview(item.id, item.url).finally(() => {
      active -= 1;
      pump();
    });
  }
}

/**
 * Queue previews for background prefetch. De-dupes across the session, caps the
 * batch, and bails entirely on metered/slow connections.
 */
export function enqueuePrefetch(items: Array<{ id: string; url: string }>): void {
  if (!canPrefetch()) return;
  let added = 0;
  for (const it of items) {
    if (added >= MAX_QUEUE_PER_CALL) break;
    if (!it.id || !it.url || seen.has(it.id)) continue;
    if (!/^https?:\/\//i.test(it.url)) continue; // skip proxy-fallback (no preview yet)
    seen.add(it.id);
    queue.push(it);
    added += 1;
  }
  if (added) pump();
}
