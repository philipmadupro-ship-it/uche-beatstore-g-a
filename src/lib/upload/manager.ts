/**
 * Background upload manager.
 *
 * - Multiple concurrent uploads, each broken into 8 MiB chunks (server picks final size)
 * - Up to 3 chunks in flight per upload (configurable)
 * - XHR-based per-chunk so we get real ProgressEvents (fetch can't progress-report)
 * - Auto-retry chunks with exponential backoff (5 attempts, 1s..16s)
 * - Live speed (bytes/sec, exp moving avg) + ETA
 * - Persists session metadata to localStorage so the tray re-hydrates on reload.
 *   Note: a `File` reference cannot survive a refresh; on reload the upload is
 *   marked "interrupted" and the user is shown a "Resume" button that re-prompts
 *   for the same file. We verify name+size+lastModified before resuming.
 */

import { create } from 'zustand';
import { errorMessage, isError } from '@/lib/errors';
import {
  parsePersistedUploads, bytesFromCompletedParts, type PersistedItem,
} from './persisted-uploads';
import {
  findLiveDuplicate, bytesFromParts, displayedBytes, computeSpeedBps,
  computeEtaSec, backoffMs, isRetriableStatus,
} from './progress';

type UploadAnalysis = {
  bpm?: number | null;
  key?: string | null;
  scale?: string | null;
  loudness?: number | null;
  duration?: number | null;
  energy?: number | null;
  danceability?: number | null;
  valence?: number | null;
  acousticness?: number | null;
};
type UploadedTrack = { id?: string; [key: string]: unknown };

export type UploadStatus =
  | 'queued'
  | 'preparing'      // /init in flight
  | 'uploading'
  | 'finalizing'     // /complete in flight
  | 'success'
  | 'error'
  | 'paused'
  | 'interrupted'    // page reloaded — needs user to re-pick file
  | 'aborted';

export interface UploadItem {
  id: string;            // local id (= sessionId once init resolves)
  sessionId: string | null;
  file: File | null;     // null after reload until user re-picks
  fileName: string;
  fileSize: number;
  fileLastModified: number;
  contentType: string;
  status: UploadStatus;
  bytesUploaded: number;
  /** Bytes already done when the current run started, so throughput for this
   *  run isn't inflated by everything a previous run uploaded. */
  baselineBytes: number;
  partSize: number;
  totalParts: number;
  completedPartNumbers: Set<number>;
  speedBps: number;       // smoothed bytes/sec
  etaSec: number | null;
  startedAt: number;
  updatedAt: number;
  error: string | null;
  retries: number;
  // Context to pass back to /complete and into the track record
  type: string;
  projectId: string | null;
  replaceTrackId: string | null;
  // Optional client-side analysis JSON to forward (BPM/key)
  analysis: UploadAnalysis | null;
  // Track returned from /complete on success
  track: UploadedTrack | null;
}

interface ManagerState {
  uploads: Record<string, UploadItem>;
  order: string[];               // newest-first display order
  enqueue: (file: File, opts?: EnqueueOpts) => string;
  resume: (id: string, file: File) => void;
  pause: (id: string) => void;
  retry: (id: string) => void;
  abort: (id: string) => void;
  remove: (id: string) => void;
  hydrate: () => void;            // call once on app boot
  // internal
  _patch: (id: string, patch: Partial<UploadItem>) => void;
  _registerPart: (id: string, partNumber: number) => void;
  _registerBytes: (id: string, partNumber: number, loaded: number) => void;
}

export interface EnqueueOpts {
  type?: string;
  projectId?: string | null;
  replaceTrackId?: string | null;
  /**
   * BPM/key analysis to attach to the finished track.
   *
   * Accepts a promise so the caller can start the upload IMMEDIATELY and let
   * analysis run alongside it. Awaiting analysis before enqueuing meant a large
   * WAV was fully decoded in the browser before a single byte was sent — the
   * upload looked hung, and on a slow machine the tab stopped responding. The
   * bytes are the slow part; the analysis nearly always lands first.
   */
  analysis?: UploadAnalysis | null | Promise<UploadAnalysis | null>;
  onSuccess?: (track: UploadedTrack) => void;
}

const LS_KEY = 'antigravity:uploads:v1';
const MAX_CONCURRENT_PARTS = 3;
const MAX_CHUNK_RETRIES = 5;
/** How long `/complete` may wait on a pending analysis before shipping without
 *  it. A missing BPM is a re-analyze button; a stuck upload is a lost file. */
const ANALYSIS_GRACE_MS = 20_000;
/** `/complete` does real work server-side (sidecars, preview). Generous, but
 *  bounded — an unbounded fetch leaves the row on "Finalizing" forever. */
const FINALIZE_TIMEOUT_MS = 120_000;
/** Progress repaints per part are coarse; per byte are a re-render storm. */
const PROGRESS_THROTTLE_MS = 120;

// Side-channels (not serialized, and deliberately not in the store — writing
// per-byte progress through Zustand would re-render the tray on every packet).
const successCallbacks: Record<string, ((track: UploadedTrack) => void) | undefined> = {};
const pendingAnalysis: Record<string, Promise<UploadAnalysis | null> | undefined> = {};
const inFlightBytes: Record<string, Record<number, number>> = {};
const lastProgressPush: Record<string, number> = {};

/* ─────────── persistence ─────────── */

// Shape + validation live in `persisted-uploads.ts` so they can be unit-tested
// without a store. localStorage is untrusted input: see that file for why.

function persist(state: ManagerState) {
  if (typeof window === 'undefined') return;
  const items: PersistedItem[] = state.order
    .map((id) => state.uploads[id])
    .filter(Boolean)
    .filter((u) => u.status !== 'success' && u.status !== 'aborted')
    .map((u) => ({
      id: u.id,
      sessionId: u.sessionId,
      fileName: u.fileName,
      fileSize: u.fileSize,
      fileLastModified: u.fileLastModified,
      contentType: u.contentType,
      partSize: u.partSize,
      totalParts: u.totalParts,
      completedPartNumbers: Array.from(u.completedPartNumbers),
      type: u.type,
      projectId: u.projectId,
      replaceTrackId: u.replaceTrackId,
      status: u.status,
      startedAt: u.startedAt,
    }));
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(items));
  } catch {}
}

function loadPersisted(): PersistedItem[] {
  if (typeof window === 'undefined') return [];
  try {
    return parsePersistedUploads(localStorage.getItem(LS_KEY));
  } catch {
    // localStorage itself can throw (disabled, or a security policy).
    return [];
  }
}

/* ─────────── XHR helpers ─────────── */

function xhrPart(opts: {
  sessionId: string;
  partNumber: number;
  blob: Blob;
  onProgress: (loadedBytes: number) => void;
  signal?: AbortSignal;
}): Promise<{ ok: boolean; status: number; error?: string }> {
  return directOrProxiedPart(opts);
}

async function directOrProxiedPart(opts: {
  sessionId: string;
  partNumber: number;
  blob: Blob;
  onProgress: (loadedBytes: number) => void;
  signal?: AbortSignal;
}): Promise<{ ok: boolean; status: number; error?: string }> {
  try {
    const signRes = await fetch('/api/upload/part', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: opts.signal,
      body: JSON.stringify({ sessionId: opts.sessionId, partNumber: opts.partNumber }),
    });
    const signed = await signRes.json() as {
      direct?: boolean;
      url?: string | null;
      error?: string;
    };
    if (!signRes.ok) {
      return { ok: false, status: signRes.status, error: signed.error || 'part signing failed' };
    }
    if (!signed.direct || !signed.url) return proxiedPart(opts);

    const uploaded = await directPart({
      url: signed.url,
      blob: opts.blob,
      onProgress: opts.onProgress,
      signal: opts.signal,
    });
    if (!uploaded.ok || !uploaded.etag) return uploaded;

    const confirmRes = await fetch('/api/upload/part', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      signal: opts.signal,
      body: JSON.stringify({
        sessionId: opts.sessionId,
        partNumber: opts.partNumber,
        etag: uploaded.etag,
        size: opts.blob.size,
      }),
    });
    const confirmed = await confirmRes.json() as { error?: string };
    return confirmRes.ok
      ? { ok: true, status: confirmRes.status }
      : { ok: false, status: confirmRes.status, error: confirmed.error || 'part confirmation failed' };
  } catch (err) {
    if (isError(err) && err.name === 'AbortError') {
      return { ok: false, status: 0, error: 'aborted' };
    }
    return { ok: false, status: 0, error: errorMessage(err) || 'network error' };
  }
}

function directPart(opts: {
  url: string;
  blob: Blob;
  onProgress: (loadedBytes: number) => void;
  signal?: AbortSignal;
}): Promise<{ ok: boolean; status: number; error?: string; etag?: string }> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', opts.url, true);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');

    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      // Absolute, not a delta: a retried chunk restarts from zero, and a delta
      // stream would leave the failed attempt's bytes counted forever.
      opts.onProgress(e.loaded);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const etag = xhr.getResponseHeader('ETag') || xhr.getResponseHeader('etag') || '';
        if (!etag) {
          resolve({ ok: false, status: xhr.status, error: 'R2 did not expose ETag' });
          return;
        }
        resolve({ ok: true, status: xhr.status, etag });
      } else {
        let msg = `HTTP ${xhr.status}`;
        try {
          const j = JSON.parse(xhr.responseText);
          if (j.error) msg = j.error;
        } catch {}
        resolve({ ok: false, status: xhr.status, error: msg });
      }
    };
    xhr.onerror = () => resolve({ ok: false, status: 0, error: 'network error' });
    xhr.ontimeout = () => resolve({ ok: false, status: 0, error: 'timeout' });

    if (opts.signal) {
      const onAbort = () => {
        try { xhr.abort(); } catch {}
        resolve({ ok: false, status: 0, error: 'aborted' });
      };
      if (opts.signal.aborted) return onAbort();
      opts.signal.addEventListener('abort', onAbort, { once: true });
    }

    xhr.send(opts.blob);
  });
}

function proxiedPart(opts: {
  sessionId: string;
  partNumber: number;
  blob: Blob;
  onProgress: (loadedBytes: number) => void;
  signal?: AbortSignal;
}): Promise<{ ok: boolean; status: number; error?: string }> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', '/api/upload/part', true);
    xhr.setRequestHeader('x-session-id', opts.sessionId);
    xhr.setRequestHeader('x-part-number', String(opts.partNumber));
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');

    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      // Absolute, not a delta: a retried chunk restarts from zero, and a delta
      // stream would leave the failed attempt's bytes counted forever.
      opts.onProgress(e.loaded);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({ ok: true, status: xhr.status });
      } else {
        let msg = `HTTP ${xhr.status}`;
        try {
          const j = JSON.parse(xhr.responseText);
          if (j.error) msg = j.error;
        } catch {}
        resolve({ ok: false, status: xhr.status, error: msg });
      }
    };
    xhr.onerror = () => resolve({ ok: false, status: 0, error: 'network error' });
    xhr.ontimeout = () => resolve({ ok: false, status: 0, error: 'timeout' });

    if (opts.signal) {
      const onAbort = () => {
        try { xhr.abort(); } catch {}
        resolve({ ok: false, status: 0, error: 'aborted' });
      };
      if (opts.signal.aborted) return onAbort();
      opts.signal.addEventListener('abort', onAbort, { once: true });
    }

    xhr.send(opts.blob);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ─────────── network state ─────────── */

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/**
 * Block until the browser reports a connection again.
 *
 * `navigator.onLine` lies in one direction — it can report online for a
 * captive portal or a dead uplink — so we also wake periodically and let the
 * caller re-attempt. It never lies the other way: offline means offline.
 */
function waitForOnline(signal?: AbortSignal): Promise<void> {
  if (!isOffline()) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      window.removeEventListener('online', done);
      clearInterval(poll);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const poll = setInterval(() => { if (!isOffline()) done(); }, 2_000);
    window.addEventListener('online', done, { once: true });
    signal?.addEventListener('abort', done, { once: true });
  });
}

/**
 * When the connection returns, restart uploads that died on a network error.
 *
 * The user should not have to find the tray and press Retry on each row after
 * a tunnel or a dropped wifi — the parts already in the bucket are still
 * there, so resuming is nearly free.
 */
let reconnectBound = false;
function bindReconnectRetry() {
  if (reconnectBound || typeof window === 'undefined') return;
  reconnectBound = true;
  window.addEventListener('online', () => {
    const state = useUploadManager.getState();
    for (const id of state.order) {
      const u = state.uploads[id];
      // Only rows that still hold their File can resume unattended; an
      // `interrupted` row needs the user to re-pick the file by hand.
      if (u && u.status === 'error' && u.file) state.retry(id);
    }
  });
}

/* ─────────── store ─────────── */

const abortControllers: Record<string, AbortController> = {};

export const useUploadManager = create<ManagerState>((set, get) => ({
  uploads: {},
  order: [],

  enqueue(file, opts = {}) {
    // Same file already on its way? Hand back the existing row instead of
    // starting a second multipart session. Double-clicking the picker, or
    // dropping the same file twice, used to produce two R2 objects and two
    // track rows the producer then had to delete by hand.
    const existing = findLiveDuplicate(
      get().order.map((x) => get().uploads[x]).filter(Boolean),
      { fileName: file.name, fileSize: file.size, fileLastModified: file.lastModified },
    );
    if (existing) {
      if (opts.onSuccess) successCallbacks[existing] = opts.onSuccess;
      return existing;
    }

    const id = `up_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const item: UploadItem = {
      id,
      sessionId: null,
      file,
      fileName: file.name,
      fileSize: file.size,
      fileLastModified: file.lastModified,
      contentType: file.type || 'application/octet-stream',
      status: 'queued',
      bytesUploaded: 0,
      baselineBytes: 0,
      partSize: 0,
      totalParts: 0,
      completedPartNumbers: new Set(),
      speedBps: 0,
      etaSec: null,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      error: null,
      retries: 0,
      type: opts.type || 'instrumental',
      projectId: opts.projectId ?? null,
      replaceTrackId: opts.replaceTrackId ?? null,
      // A promise here is resolved just before `/complete`, not now — see
      // EnqueueOpts.analysis. Bytes start moving on the next tick either way.
      analysis: opts.analysis instanceof Promise ? null : (opts.analysis ?? null),
      track: null,
    };
    if (opts.onSuccess) successCallbacks[id] = opts.onSuccess;
    if (opts.analysis instanceof Promise) {
      // Swallow rejection here so an analysis failure can never surface as an
      // unhandled rejection or fail the upload; finalize re-awaits it safely.
      pendingAnalysis[id] = opts.analysis.catch(() => null);
    }
    set((s) => {
      const uploads = { ...s.uploads, [id]: item };
      const order = [id, ...s.order];
      const next = { ...s, uploads, order };
      persist(next);
      return { uploads, order };
    });
    runUpload(id);
    return id;
  },

  resume(id, file) {
    const u = get().uploads[id];
    if (!u) return;
    if (file.name !== u.fileName || file.size !== u.fileSize || file.lastModified !== u.fileLastModified) {
      get()._patch(id, { error: 'File does not match the original (name/size/modified differ)' });
      return;
    }
    get()._patch(id, { file, status: 'queued', error: null });
    runUpload(id);
  },

  pause(id) {
    abortControllers[id]?.abort();
    delete abortControllers[id];
    get()._patch(id, { status: 'paused' });
  },

  retry(id) {
    const u = get().uploads[id];
    if (!u) return;
    if (!u.file) {
      get()._patch(id, { status: 'interrupted', error: 'Re-pick file to resume' });
      return;
    }
    get()._patch(id, { status: 'queued', error: null, retries: 0 });
    runUpload(id);
  },

  abort(id) {
    abortControllers[id]?.abort();
    delete abortControllers[id];
    const u = get().uploads[id];
    if (u?.sessionId) {
      // Best-effort tell the server to drop the session
      fetch('/api/upload/abort', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: u.sessionId }),
      }).catch(() => {});
    }
    cleanupSideChannels(id);
    get()._patch(id, { status: 'aborted' });
  },

  remove(id) {
    cleanupSideChannels(id);
    set((s) => {
      const uploads = { ...s.uploads };
      delete uploads[id];
      const order = s.order.filter((x) => x !== id);
      persist({ ...s, uploads, order });
      return { uploads, order };
    });
  },

  hydrate() {
    if (typeof window === 'undefined') return;
    bindReconnectRetry();
    const persisted = loadPersisted();
    if (persisted.length === 0) return;
    set((s) => {
      const uploads = { ...s.uploads };
      const order = [...s.order];
      for (const p of persisted) {
        if (uploads[p.id]) continue;
        uploads[p.id] = {
          id: p.id,
          sessionId: p.sessionId,
          file: null,
          fileName: p.fileName,
          fileSize: p.fileSize,
          fileLastModified: p.fileLastModified,
          contentType: p.contentType,
          status: 'interrupted',
          bytesUploaded: bytesFromCompletedParts(p),
          baselineBytes: bytesFromCompletedParts(p),
          partSize: p.partSize,
          totalParts: p.totalParts,
          completedPartNumbers: new Set(p.completedPartNumbers),
          speedBps: 0,
          etaSec: null,
          startedAt: p.startedAt,
          updatedAt: Date.now(),
          error: null,
          retries: 0,
          type: p.type,
          projectId: p.projectId,
          replaceTrackId: p.replaceTrackId,
          analysis: null,
          track: null,
        };
        if (!order.includes(p.id)) order.push(p.id);
      }
      return { uploads, order };
    });
  },

  _patch(id, patch) {
    set((s) => {
      const cur = s.uploads[id];
      if (!cur) return s;
      const merged = { ...cur, ...patch, updatedAt: Date.now() };
      const uploads = { ...s.uploads, [id]: merged };
      const next = { ...s, uploads };
      persist(next);
      return { uploads };
    });
  },

  _registerPart(id, partNumber) {
    // The part is confirmed server-side, so its bytes move from the in-flight
    // tally into the confirmed one. Dropping it from in-flight first is what
    // stops the two sources double-counting.
    if (inFlightBytes[id]) delete inFlightBytes[id][partNumber];
    set((s) => {
      const cur = s.uploads[id];
      if (!cur) return s;
      const completed = new Set(cur.completedPartNumbers);
      completed.add(partNumber);
      const merged = recompute({ ...cur, completedPartNumbers: completed }, id);
      const uploads = { ...s.uploads, [id]: merged };
      persist({ ...s, uploads });
      return { uploads };
    });
  },

  _registerBytes(id, partNumber, loaded) {
    const map = (inFlightBytes[id] ||= {});
    map[partNumber] = loaded;
    // Throttled: a 300 MB upload fires thousands of ProgressEvents, and
    // re-rendering the tray on each one is its own kind of frozen UI.
    const now = Date.now();
    if (now - (lastProgressPush[id] ?? 0) < PROGRESS_THROTTLE_MS) return;
    lastProgressPush[id] = now;
    set((s) => {
      const cur = s.uploads[id];
      if (!cur) return s;
      // No persist() here — this is a display-only tick between parts, and
      // writing localStorage at 8 Hz per upload is pure jank.
      return { uploads: { ...s.uploads, [id]: recompute(cur, id) } };
    });
  },
}));

/**
 * Recompute the derived progress fields of an upload from its confirmed parts
 * plus whatever the in-flight chunks have pushed. Kept in one place so the
 * per-part and per-byte paths can never drift apart.
 */
function recompute(cur: UploadItem, id: string): UploadItem {
  const confirmedBytes = bytesFromParts({
    completedPartNumbers: Array.from(cur.completedPartNumbers),
    partSize: cur.partSize,
    totalParts: cur.totalParts,
    fileSize: cur.fileSize,
  });
  const bytesUploaded = displayedBytes({
    confirmedBytes,
    inFlight: inFlightBytes[id] ?? {},
    fileSize: cur.fileSize,
  });
  const speedBps = computeSpeedBps({
    bytesUploaded,
    baselineBytes: cur.baselineBytes,
    elapsedMs: Date.now() - cur.startedAt,
    previousBps: cur.speedBps,
  });
  return {
    ...cur,
    bytesUploaded,
    speedBps,
    etaSec: computeEtaSec({ bytesUploaded, fileSize: cur.fileSize, speedBps }),
    updatedAt: Date.now(),
  };
}

/* ─────────── per-upload runner ─────────── */

async function runUpload(id: string) {
  const m = useUploadManager.getState();
  const u = m.uploads[id];
  if (!u || !u.file) return;

  const ac = new AbortController();
  abortControllers[id] = ac;

  try {
    // 1. Init (or resume an existing session)
    let sessionId = u.sessionId;
    let partSize = u.partSize;
    let totalParts = u.totalParts;
    let completed = new Set<number>(u.completedPartNumbers);
    let bytesAlready = 0;

    if (!sessionId) {
      m._patch(id, { status: 'preparing' });
      const initRes = await fetch('/api/upload/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ac.signal,
        body: JSON.stringify({
          fileName: u.fileName,
          fileSize: u.fileSize,
          fileType: u.contentType,
          trackType: u.type,
          projectId: u.projectId,
          replaceTrackId: u.replaceTrackId,
        }),
      });
      const initJson = await initRes.json();
      if (!initRes.ok) throw new Error(initJson.error || 'init failed');
      sessionId = initJson.sessionId as string;
      partSize = initJson.partSize as number;
      totalParts = initJson.totalParts as number;
      m._patch(id, { sessionId, partSize, totalParts, status: 'uploading' });
    } else {
      // Resume — verify with server which parts are already on disk
      try {
        const r = await fetch(`/api/upload/status?sessionId=${sessionId}`);
        if (r.ok) {
          const j = await r.json();
          completed = new Set<number>(j.completedPartNumbers || []);
          partSize = j.partSize;
          totalParts = j.totalParts;
          bytesAlready = bytesFromParts({
            completedPartNumbers: Array.from(completed),
            partSize, totalParts, fileSize: u.fileSize,
          });
          m._patch(id, {
            partSize,
            totalParts,
            completedPartNumbers: completed,
            bytesUploaded: bytesAlready,
            status: 'uploading',
          });
        } else {
          // Session lost server-side — start fresh
          m._patch(id, { sessionId: null, completedPartNumbers: new Set(), bytesUploaded: 0 });
          return runUpload(id);
        }
      } catch {
        m._patch(id, { status: 'uploading' });
      }
    }

    // 2. Build queue of pending parts
    const pending: number[] = [];
    for (let p = 1; p <= totalParts; p++) {
      if (!completed.has(p)) pending.push(p);
    }

    if (pending.length === 0) {
      // Nothing to upload — go straight to finalize
      await finalize(id);
      return;
    }

    // Reset start clock so speed/ETA reflect this run. `baselineBytes` keeps
    // resumed bytes out of the throughput maths.
    m._patch(id, {
      startedAt: Date.now(),
      speedBps: 0,
      bytesUploaded: bytesAlready,
      baselineBytes: bytesAlready,
    });

    // 3. Upload pending parts with bounded concurrency + retry
    let cursor = 0;
    // Held on an object rather than a bare `let`: the workers assign to it from
    // inside closures, and a property is never narrowed away by control flow.
    const failure: { message: string | null } = { message: null };
    const fail = (msg: string) => { failure.message ||= msg; };
    const workers = Array.from({ length: Math.min(MAX_CONCURRENT_PARTS, pending.length) }, async () => {
      while (true) {
        if (ac.signal.aborted) return;
        if (failure.message) return;
        const partNumber = pending[cursor++];
        if (partNumber == null) return;
        const start = (partNumber - 1) * partSize;
        const end = Math.min(u.fileSize, start + partSize);
        const blob = u.file!.slice(start, end);

        let attempt = 0;
        while (attempt <= MAX_CHUNK_RETRIES) {
          const res = await xhrPart({
            sessionId: sessionId!,
            partNumber,
            blob,
            signal: ac.signal,
            onProgress: (loaded) => {
              useUploadManager.getState()._registerBytes(id, partNumber, loaded);
            },
          });
          if (res.ok) {
            useUploadManager.getState()._registerPart(id, partNumber);
            break;
          }
          if (ac.signal.aborted) return;

          // A partly-sent chunk left bytes in the in-flight tally. Clear them
          // or the bar keeps the phantom progress of an attempt that failed.
          if (inFlightBytes[id]) delete inFlightBytes[id][partNumber];

          if (!isRetriableStatus(res.status)) {
            // 4xx won't fix itself — stop rather than burn five attempts on it.
            fail(res.error || `chunk ${partNumber} rejected (HTTP ${res.status})`);
            return;
          }

          attempt++;
          if (attempt > MAX_CHUNK_RETRIES) {
            fail(res.error || 'chunk upload failed');
            return;
          }
          const latest = useUploadManager.getState().uploads[id];
          if (!latest) return;
          useUploadManager.getState()._patch(id, {
            error: `Chunk ${partNumber} retrying (attempt ${attempt}/${MAX_CHUNK_RETRIES})…`,
            retries: latest.retries + 1,
          });
          // Offline? Waiting on the `online` event beats spending the whole
          // retry budget against an interface that is definitely down.
          if (isOffline()) {
            useUploadManager.getState()._patch(id, {
              error: 'Waiting for the network to come back…',
            });
            await waitForOnline(ac.signal);
            if (ac.signal.aborted) return;
            attempt--;    // an outage shouldn't cost the user an attempt
            continue;
          }
          await sleep(backoffMs(attempt));
        }
      }
    });
    await Promise.all(workers);

    if (ac.signal.aborted) return;
    if (failure.message) {
      m._patch(id, { status: 'error', error: failure.message });
      return;
    }

    // 4. Finalize
    await finalize(id);
  } catch (err) {
    if (isError(err) && err.name === 'AbortError') return;
    console.error('upload runner error:', err);
    useUploadManager.getState()._patch(id, { status: 'error', error: errorMessage(err) || 'upload failed' });
  } finally {
    delete abortControllers[id];
  }
}

async function finalize(id: string) {
  const m = useUploadManager.getState();
  const u = m.uploads[id];
  if (!u || !u.sessionId) return;
  m._patch(id, { status: 'finalizing', error: null });

  // Collect analysis now: the bytes are up, so this is the one moment where
  // waiting on it costs nothing. Bounded, because a wedged Essentia worker
  // must not strand a track that is already safely in the bucket.
  let analysis = u.analysis;
  const pending = pendingAnalysis[id];
  if (pending) {
    analysis = await Promise.race([
      pending,
      sleep(ANALYSIS_GRACE_MS).then(() => null),
    ]).catch(() => null);
    delete pendingAnalysis[id];
  }

  try {
    const json = await postComplete(u.sessionId, analysis);
    m._patch(id, {
      status: 'success',
      track: json.track ?? null,
      bytesUploaded: u.fileSize,
      analysis: analysis ?? null,
      error: null,
    });
    if (json.track) successCallbacks[id]?.(json.track);
    cleanupSideChannels(id);
  } catch (err) {
    m._patch(id, { status: 'error', error: errorMessage(err) || 'finalize failed' });
  }
}

/**
 * POST /complete with a timeout and one retry.
 *
 * The route assembles sidecars and a preview, so it is the slowest call in the
 * flow and the likeliest to be cut off by a proxy. Without a timeout a severed
 * response left the row on "Finalizing" forever, with the file fully uploaded
 * and no way forward but a page reload.
 *
 * The retry is safe because /complete is idempotent per session: a second call
 * for a session already finished answers 409 "already completed", which we
 * treat as success rather than an error — the object is in the bucket either
 * way, and reporting failure for a completed upload is the worse lie.
 */
async function postComplete(
  sessionId: string,
  analysis: UploadAnalysis | null,
  attempt = 0,
): Promise<{ track?: UploadedTrack }> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FINALIZE_TIMEOUT_MS);
  try {
    const res = await fetch('/api/upload/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ac.signal,
      body: JSON.stringify({ sessionId, analysis }),
    });
    const json = await res.json().catch(() => ({})) as { error?: string; track?: UploadedTrack };
    if (res.status === 409 && /already completed/i.test(json.error || '')) return json;
    if (!res.ok) {
      if (attempt === 0 && isRetriableStatus(res.status)) {
        clearTimeout(timer);
        await sleep(backoffMs(1));
        return postComplete(sessionId, analysis, attempt + 1);
      }
      throw new Error(json.error || 'complete failed');
    }
    return json;
  } catch (err) {
    const aborted = isError(err) && err.name === 'AbortError';
    if (attempt === 0 && (aborted || !isError(err) || err.name === 'TypeError')) {
      await sleep(backoffMs(1));
      return postComplete(sessionId, analysis, attempt + 1);
    }
    if (aborted) throw new Error('Finalizing timed out — the file uploaded, but the server did not confirm');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function cleanupSideChannels(id: string) {
  delete successCallbacks[id];
  delete pendingAnalysis[id];
  delete inFlightBytes[id];
  delete lastProgressPush[id];
}

/* ─────────── formatters (UI helpers) ─────────── */

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n; let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export function formatSpeed(bps: number): string {
  if (!Number.isFinite(bps) || bps <= 0) return '—';
  return `${formatBytes(bps)}/s`;
}

export function formatEta(sec: number | null): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return '—';
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
