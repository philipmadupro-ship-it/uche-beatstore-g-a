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
  _registerPart: (id: string, partNumber: number, byteLen: number) => void;
}

export interface EnqueueOpts {
  type?: string;
  projectId?: string | null;
  replaceTrackId?: string | null;
  analysis?: UploadAnalysis | null;
  onSuccess?: (track: UploadedTrack) => void;
}

const LS_KEY = 'antigravity:uploads:v1';
const MAX_CONCURRENT_PARTS = 3;
const MAX_CHUNK_RETRIES = 5;

// Side-channel for onSuccess callbacks (not serialized).
const successCallbacks: Record<string, ((track: UploadedTrack) => void) | undefined> = {};

/* ─────────── persistence ─────────── */

interface PersistedItem {
  id: string;
  sessionId: string | null;
  fileName: string;
  fileSize: number;
  fileLastModified: number;
  contentType: string;
  partSize: number;
  totalParts: number;
  completedPartNumbers: number[];
  type: string;
  projectId: string | null;
  replaceTrackId: string | null;
  status: UploadStatus;
  startedAt: number;
}

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
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/* ─────────── XHR helpers ─────────── */

function xhrPart(opts: {
  sessionId: string;
  partNumber: number;
  blob: Blob;
  onProgress: (delta: number) => void;
  signal?: AbortSignal;
}): Promise<{ ok: boolean; status: number; error?: string }> {
  return directOrProxiedPart(opts);
}

async function directOrProxiedPart(opts: {
  sessionId: string;
  partNumber: number;
  blob: Blob;
  onProgress: (delta: number) => void;
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
  onProgress: (delta: number) => void;
  signal?: AbortSignal;
}): Promise<{ ok: boolean; status: number; error?: string; etag?: string }> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', opts.url, true);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');

    let lastLoaded = 0;
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const delta = e.loaded - lastLoaded;
      lastLoaded = e.loaded;
      if (delta > 0) opts.onProgress(delta);
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
  onProgress: (delta: number) => void;
  signal?: AbortSignal;
}): Promise<{ ok: boolean; status: number; error?: string }> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', '/api/upload/part', true);
    xhr.setRequestHeader('x-session-id', opts.sessionId);
    xhr.setRequestHeader('x-part-number', String(opts.partNumber));
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');

    let lastLoaded = 0;
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const delta = e.loaded - lastLoaded;
      lastLoaded = e.loaded;
      if (delta > 0) opts.onProgress(delta);
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

/* ─────────── store ─────────── */

const abortControllers: Record<string, AbortController> = {};

export const useUploadManager = create<ManagerState>((set, get) => ({
  uploads: {},
  order: [],

  enqueue(file, opts = {}) {
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
      analysis: opts.analysis ?? null,
      track: null,
    };
    if (opts.onSuccess) successCallbacks[id] = opts.onSuccess;
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
    get()._patch(id, { status: 'aborted' });
  },

  remove(id) {
    delete successCallbacks[id];
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
          bytesUploaded: p.completedPartNumbers.length * (p.partSize || 1),
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

  _registerPart(id, partNumber, byteLen) {
    set((s) => {
      const cur = s.uploads[id];
      if (!cur) return s;
      const completed = new Set(cur.completedPartNumbers);
      completed.add(partNumber);
      const bytesUploaded = Math.min(cur.fileSize, cur.bytesUploaded + byteLen);
      const elapsed = (Date.now() - cur.startedAt) / 1000;
      const avg = elapsed > 0 ? bytesUploaded / elapsed : 0;
      // EMA for smoother readout
      const smoothed = cur.speedBps === 0 ? avg : cur.speedBps * 0.7 + avg * 0.3;
      const remaining = cur.fileSize - bytesUploaded;
      const eta = smoothed > 0 ? Math.round(remaining / smoothed) : null;
      const merged: UploadItem = {
        ...cur,
        completedPartNumbers: completed,
        bytesUploaded,
        speedBps: smoothed,
        etaSec: eta,
        updatedAt: Date.now(),
      };
      const uploads = { ...s.uploads, [id]: merged };
      const next = { ...s, uploads };
      persist(next);
      return { uploads };
    });
  },
}));

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
          bytesAlready = Math.min(u.fileSize, completed.size * partSize);
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

    // Reset start clock so speed/ETA reflect this run
    m._patch(id, { startedAt: Date.now(), speedBps: 0, bytesUploaded: bytesAlready });

    // 3. Upload pending parts with bounded concurrency + retry
    let cursor = 0;
    let firstError: string | null = null;
    const workers = Array.from({ length: Math.min(MAX_CONCURRENT_PARTS, pending.length) }, async () => {
      while (true) {
        if (ac.signal.aborted) return;
        if (firstError) return;
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
            onProgress: () => { /* per-byte too noisy — use per-part below */ },
          });
          if (res.ok) {
            useUploadManager.getState()._registerPart(id, partNumber, blob.size);
            break;
          }
          if (ac.signal.aborted) return;
          attempt++;
          if (attempt > MAX_CHUNK_RETRIES) {
            firstError = res.error || 'chunk upload failed';
            return;
          }
          // exponential backoff: 500ms, 1s, 2s, 4s, 8s
          const wait = 500 * Math.pow(2, attempt - 1);
          const latest = useUploadManager.getState().uploads[id];
          if (!latest) return;
          useUploadManager.getState()._patch(id, {
            error: `Chunk ${partNumber} retrying (attempt ${attempt}/${MAX_CHUNK_RETRIES})…`,
            retries: latest.retries + 1,
          });
          await sleep(wait);
        }
      }
    });
    await Promise.all(workers);

    if (ac.signal.aborted) return;
    if (firstError) {
      m._patch(id, { status: 'error', error: firstError });
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
  try {
    const res = await fetch('/api/upload/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: u.sessionId, analysis: u.analysis }),
    });
    const json = await res.json() as { error?: string; track?: UploadedTrack };
    if (!res.ok) throw new Error(json.error || 'complete failed');
    m._patch(id, { status: 'success', track: json.track ?? null, bytesUploaded: u.fileSize });
    if (json.track) successCallbacks[id]?.(json.track);
    delete successCallbacks[id];
  } catch (err) {
    m._patch(id, { status: 'error', error: errorMessage(err) || 'finalize failed' });
  }
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
