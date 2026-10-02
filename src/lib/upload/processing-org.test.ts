/**
 * The processing job branches on the track's org for the DESTINATION of its
 * derived files, and nothing else (LABEL-14): an org recording's preview and
 * peaks go to lib/storage/org-media (private bucket), a producer track's to
 * the public bucket exactly as before.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Op = [string, ...unknown[]];
type Query = { table: string; ops: Op[] };
const queries: Query[] = [];
let trackOrg: string | null = null;
let trackOrgError: string | null = null;

/** A supabase-js-shaped chain: records every call; `maybeSingle()` / `await` resolve per table + operation. */
function chain(table: string) {
  const q: Query = { table, ops: [] };
  queries.push(q);
  const resolve = () => {
    const kinds = q.ops.map((o) => o[0]);
    if (table === 'upload_processing_jobs' && kinds[0] === 'select') {
      return { data: { id: 'job1', user_id: 'u1', track_id: 't1', audio_url: 'r2://masters/orgs/o1/tracks/x.wav', file_name: 'x.wav', client_analysis: null, attempts: 0 }, error: null };
    }
    if (table === 'upload_processing_jobs' && kinds.includes('or')) return { data: { id: 'job1' }, error: null };
    if (table === 'tracks' && kinds[0] === 'select') {
      return trackOrgError ? { data: null, error: { message: trackOrgError } } : { data: { org_id: trackOrg }, error: null };
    }
    return { data: [], error: null };
  };
  const api: Record<string, unknown> = {};
  for (const m of ['select', 'update', 'insert', 'eq', 'lt', 'or', 'is', 'in', 'match']) {
    api[m] = (...a: unknown[]) => { q.ops.push([m, ...a]); return api; };
  }
  api.maybeSingle = async () => resolve();
  api.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(resolve()).then(ok, bad);
  return api;
}

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/ownership', () => ({ createServiceClient: () => ({ from: (t: string) => chain(t) }) }));
vi.mock('@/lib/audio/analyze.server', () => ({ analyzeAudio: vi.fn(async () => ({ bpm: null, key: null, scale: null, loudness: null, duration: 200 })) }));
const audd = vi.hoisted(() => ({ getAuddFeatures: vi.fn(async () => ({ danceability: 0, energy: 0, valence: 0, acousticness: 0, tempo: 0 })) }));
vi.mock('@/lib/audio/audd', () => audd);
vi.mock('@/lib/audio/peaks', () => ({ extractPeaks: vi.fn(async () => [0, 1, 0]) }));
const storage = vi.hoisted(() => ({
  readStoredObject: vi.fn(async () => Buffer.from('RIFFxxxxWAVEdata')),
  uploadPeaksSidecar: vi.fn(async () => 'https://pub.example/peaks/x.peaks.json'),
  uploadPublicPreview: vi.fn(async () => 'https://pub.example/previews/x.mp3'),
  uploadOrgPeaks: vi.fn(async () => 'r2://masters/orgs/o1/peaks/p.json'),
  uploadOrgPreview: vi.fn(async () => 'r2://masters/orgs/o1/previews/c.mp3'),
}));
vi.mock('@/lib/storage/upload', () => ({
  readStoredObject: storage.readStoredObject,
  uploadPeaksSidecar: storage.uploadPeaksSidecar,
  uploadPublicPreview: storage.uploadPublicPreview,
}));
vi.mock('@/lib/storage/org-media', () => ({
  uploadOrgPeaks: storage.uploadOrgPeaks,
  uploadOrgPreview: storage.uploadOrgPreview,
}));

import { processUploadProcessingJobById } from './processing';

const trackUpdate = () => queries.find((q) => q.table === 'tracks' && q.ops[0]?.[0] === 'update');

beforeEach(() => {
  queries.length = 0;
  trackOrg = null;
  trackOrgError = null;
  for (const fn of Object.values(storage)) fn.mockClear();
  audd.getAuddFeatures.mockClear();
});

describe('processing: where an upload\'s derived files go', () => {
  it('an org track: preview and peaks to the private org store, never the public helpers', async () => {
    trackOrg = 'o1';
    const res = await processUploadProcessingJobById('job1');
    expect(res).toMatchObject({ ok: true, trackId: 't1' });
    expect(storage.uploadOrgPreview).toHaveBeenCalledWith('o1', expect.any(Buffer), 'r2://masters/orgs/o1/tracks/x.wav', 200);
    expect(storage.uploadOrgPeaks).toHaveBeenCalledWith('o1', '[0,1,0]');
    expect(storage.uploadPublicPreview).not.toHaveBeenCalled();
    expect(storage.uploadPeaksSidecar).not.toHaveBeenCalled();
    // Never sent to the third-party analyser (D8).
    expect(audd.getAuddFeatures).not.toHaveBeenCalled();
    const patch = trackUpdate()?.ops[0][1] as Record<string, unknown>;
    expect(patch).toMatchObject({
      preview_url: 'r2://masters/orgs/o1/previews/c.mp3',
      peaks_url: 'r2://masters/orgs/o1/peaks/p.json',
      preview_status: 'ready',
    });
    // An org track has no owner (142): addressed by its org, never by user_id.
    expect(trackUpdate()?.ops).toContainEqual(['match', { org_id: 'o1' }]);
    expect(trackUpdate()?.ops.some((o) => o[0] === 'eq' && o[1] === 'user_id')).toBe(false);
  });

  it('a producer track (org_id NULL): exactly the public path as before', async () => {
    const res = await processUploadProcessingJobById('job1');
    expect(res).toMatchObject({ ok: true });
    expect(storage.uploadPublicPreview).toHaveBeenCalledWith(expect.any(Buffer), 'r2://masters/orgs/o1/tracks/x.wav', 200);
    expect(storage.uploadPeaksSidecar).toHaveBeenCalled();
    expect(storage.uploadOrgPreview).not.toHaveBeenCalled();
    expect(storage.uploadOrgPeaks).not.toHaveBeenCalled();
    expect(audd.getAuddFeatures).toHaveBeenCalledTimes(1);
    expect(trackUpdate()?.ops[0][1]).toMatchObject({ preview_url: 'https://pub.example/previews/x.mp3' });
    expect(trackUpdate()?.ops).toContainEqual(['match', { user_id: 'u1' }]);
  });

  it('the org read failing fails the job (retried later) — never a public fallback', async () => {
    trackOrgError = 'connection reset';
    const res = await processUploadProcessingJobById('job1');
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/Track lookup failed/) });
    expect(storage.uploadPublicPreview).not.toHaveBeenCalled();
    expect(storage.uploadPeaksSidecar).not.toHaveBeenCalled();
    expect(trackUpdate()).toBeUndefined();
  });

  it('an org track without a private preview keeps none (status none), rather than a public one', async () => {
    trackOrg = 'o1';
    storage.uploadOrgPreview.mockResolvedValueOnce(null as never);
    await processUploadProcessingJobById('job1');
    expect(trackUpdate()?.ops[0][1]).toMatchObject({ preview_url: null, preview_status: 'none' });
    expect(storage.uploadPublicPreview).not.toHaveBeenCalled();
  });
});
