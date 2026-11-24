import { describe, it, expect, vi, beforeEach } from 'vitest';
import { enqueueStemJob, processStemBatch, stemSourceOf, type PipelineDeps, type BackendPoll } from './pipeline';
import { STALE_LOCK_MS, MAX_ATTEMPTS, isStale, trackStatusFor } from './lifecycle';
import type { StemPatch, StemRowFull, StemStore, StemTrack } from './store';

let T = 0;
beforeEach(() => { T = Date.parse('2026-11-24T12:00:00Z'); });

/** In-memory store honouring the same compare-and-set rules as the real ones. */
function fakeStore(opts: { locks?: boolean; track?: Partial<StemTrack> | null } = {}) {
  const locks = opts.locks ?? true;
  const rows: StemRowFull[] = [];
  const trackStatus: Record<string, string> = {};
  const track: StemTrack | null = opts.track === null ? null : {
    id: 't1', title: 'Night Drive', user_id: 'u1', audio_url: 'r2://priv/tracks/a.wav', wav_url: null, ...opts.track,
  };
  let seq = 0;
  const store: StemStore & { rows: StemRowFull[]; trackStatus: Record<string, string> } = {
    rows, trackStatus,
    async hasLocks() { return locks; },
    async findByTrack(id) { return rows.find((r) => r.track_id === id) ?? null; },
    async findByJobId(id) { return rows.find((r) => r.job_id === id) ?? null; },
    async listWork(limit) { return rows.filter((r) => r.status === 'pending' || r.status === 'processing').slice(0, limit).map((r) => ({ ...r })); },
    async create(trackId) {
      if (rows.some((r) => r.track_id === trackId)) return null;
      const r: StemRowFull = { id: `s${++seq}`, track_id: trackId, job_id: null, status: 'pending', attempts: 0, created_at: new Date(T).toISOString(), locked_at: null };
      rows.push(r); return { ...r };
    },
    async reset(row, now) {
      const live = rows.find((r) => r.id === row.id);
      if (!live || live.status !== row.status) return null;
      Object.assign(live, { status: 'pending', job_id: null, attempts: 0, last_error: null, locked_at: null, created_at: new Date(now).toISOString(), vocals_url: null });
      return { ...live };
    },
    async claim(row, now) {
      const live = rows.find((r) => r.id === row.id);
      if (!live) return null;
      if (live.status === 'pending') {
        Object.assign(live, { status: 'processing', locked_at: locks ? new Date(now).toISOString() : null }); return { ...live };
      }
      if (live.status === 'processing' && isStale(live, now, locks)) {
        Object.assign(live, { locked_at: new Date(now).toISOString(), attempts: locks ? (live.attempts ?? 0) + 1 : live.attempts, created_at: locks ? live.created_at : new Date(now).toISOString() });
        return { ...live };
      }
      return null;
    },
    async patch(row, patch: StemPatch) {
      const live = rows.find((r) => r.id === row.id)!;
      const p: Record<string, unknown> = { ...patch };
      if (!locks) { delete p.attempts; delete p.last_error; delete p.locked_at; }
      Object.assign(live, p);
    },
    async setTrackStatus(trackId, status) { trackStatus[trackId] = trackStatusFor(status); },
    async loadTrack() { return track; },
  };
  return store;
}

const FOUR = { vocals: 'v', drums: 'd', bass: 'b', other: 'o' };

function deps(store: StemStore, over: Partial<PipelineDeps> & { polls?: BackendPoll[] } = {}) {
  const polls = [...(over.polls ?? [{ status: 'done', error: null, stems: FOUR } as BackendPoll])];
  const start = vi.fn(async () => 'demucs:job-1');
  const poll = vi.fn(async () => (polls.length > 1 ? polls.shift()! : polls[0]));
  const download = vi.fn(async (_j: string, stem: string) => Buffer.from(`wav-${stem}`));
  const putStem = vi.fn(async (_b: Buffer, filename: string) => `r2://priv/tracks/${filename}`);
  const onDone = vi.fn(async () => {});
  const d: PipelineDeps & { clock: { t: number } } = {
    store,
    backend: { start, poll, download, ...(over.backend ?? {}) },
    putStem, onDone,
    now: () => T, sleep: async (ms: number) => { T += ms; },
    pollIntervalMs: 1000,
    ...over,
    clock: { t: 0 },
  } as never;
  return { d, start, poll, download, putStem, onDone, advance: (ms: number) => { T += ms; } };
}

describe('enqueue', () => {
  it('writes one pending row, mirrors the track, and does no backend work', async () => {
    const store = fakeStore();
    const { d, start } = deps(store);
    const r = await enqueueStemJob(d, 't1');
    expect(r.ok).toBe(true);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({ status: 'pending', job_id: null });
    expect(store.trackStatus.t1).toBe('pending');
    expect(start).not.toHaveBeenCalled();
  });
  it('refuses a second request while a job is live, resets a failed one in place', async () => {
    const store = fakeStore();
    const { d } = deps(store);
    await enqueueStemJob(d, 't1');
    const again = await enqueueStemJob(d, 't1');
    expect(again).toMatchObject({ ok: false, reason: 'active' });
    store.rows[0].status = 'failed'; store.rows[0].attempts = 3; store.rows[0].job_id = 'demucs:old';
    const retry = await enqueueStemJob(d, 't1');
    expect(retry.ok).toBe(true);
    expect(store.rows).toHaveLength(1); // UNIQUE track_id: reset, never a second insert
    expect(store.rows[0]).toMatchObject({ status: 'pending', job_id: null, attempts: 0 });
  });
  it('needs a track with audio, and uses the row (wav first), never a client URL', async () => {
    expect(await enqueueStemJob(deps(fakeStore({ track: null })).d, 't1')).toMatchObject({ reason: 'no_track' });
    expect(await enqueueStemJob(deps(fakeStore({ track: { audio_url: null } })).d, 't1')).toMatchObject({ reason: 'no_audio' });
    expect(stemSourceOf({ audio_url: 'r2://a.mp3', wav_url: 'r2://a.wav' })).toBe('r2://a.wav');
  });
});

describe('a successful job', () => {
  it('submits, polls, stores all four stems privately and finishes', async () => {
    const store = fakeStore();
    const { d, start, putStem, onDone } = deps(store, {
      polls: [{ status: 'processing', error: null, stems: {} }, { status: 'done', error: null, stems: FOUR }],
    });
    await enqueueStemJob(d, 't1');
    const res = await processStemBatch(d);
    expect(res).toMatchObject({ claimed: 1, done: 1, failed: 0 });
    expect(start).toHaveBeenCalledWith('r2://priv/tracks/a.wav');
    expect(putStem).toHaveBeenCalledTimes(4);
    const row = store.rows[0];
    expect(row.status).toBe('done');
    expect(row.job_id).toBe('demucs:job-1');
    for (const k of ['vocals_url', 'drums_url', 'bass_url', 'other_url'] as const) {
      expect(row[k]).toMatch(/^r2:\/\/priv\//); // private reference, never a public URL
    }
    expect(store.trackStatus.t1).toBe('done');
    expect(onDone).toHaveBeenCalledWith('t1');
    expect((await processStemBatch(d)).claimed).toBe(0); // idempotent
  });
});

describe('failed jobs', () => {
  it('a backend error is persisted, retried, and failed with its message after the attempt cap', async () => {
    const store = fakeStore();
    const { d, start } = deps(store, { polls: [{ status: 'error', error: 'CUDA out of memory', stems: {} }] });
    await enqueueStemJob(d, 't1');
    const first = await processStemBatch(d);
    expect(first.retry).toBe(1);
    expect(store.rows[0]).toMatchObject({ status: 'pending', attempts: 1, last_error: 'CUDA out of memory', job_id: null });
    await processStemBatch(d);
    const last = await processStemBatch(d);
    expect(last.failed).toBe(1);
    expect(store.rows[0]).toMatchObject({ status: 'failed', attempts: MAX_ATTEMPTS, last_error: 'CUDA out of memory' });
    expect(store.trackStatus.t1).toBe('failed');
    expect(start).toHaveBeenCalledTimes(MAX_ATTEMPTS); // a fresh submit each attempt
    expect((await processStemBatch(d)).claimed).toBe(0); // failed rows are not work
  });
  it('a service that is down is retried, not lost; a stem that cannot be stored fails the attempt', async () => {
    const store = fakeStore();
    const { d, putStem } = deps(store);
    putStem.mockRejectedValueOnce(new Error('R2 write refused'));
    await enqueueStemJob(d, 't1');
    await processStemBatch(d);
    expect(store.rows[0]).toMatchObject({ status: 'pending', attempts: 1, last_error: 'R2 write refused' });
    expect(store.rows[0].vocals_url ?? null).toBeNull(); // never done with missing stems
    await processStemBatch(d);
    expect(store.rows[0].status).toBe('done');
  });
  it('a track with nothing to split fails at once; a forgotten backend job is resubmitted', async () => {
    const lost = fakeStore();
    const l = deps(lost);
    l.poll.mockRejectedValueOnce(new Error('Demucs job poll error: Job not found'));
    await enqueueStemJob(l.d, 't1');
    await processStemBatch(l.d);
    expect(lost.rows[0]).toMatchObject({ status: 'pending', job_id: null, attempts: 1 });
    await processStemBatch(l.d);
    expect(lost.rows[0].status).toBe('done');
    expect(l.start).toHaveBeenCalledTimes(2);
  });
});

describe('reclaim and resume', () => {
  it('a crashed driver\'s stale claim is reclaimed and its job id resumed, not resubmitted', async () => {
    const store = fakeStore();
    const { d, start, advance } = deps(store);
    await enqueueStemJob(d, 't1');
    Object.assign(store.rows[0], { status: 'processing', job_id: 'demucs:job-1', locked_at: new Date(d.now()).toISOString() });
    expect((await processStemBatch(d)).claimed).toBe(0); // live lock: hands off
    advance(STALE_LOCK_MS + 1000);
    const res = await processStemBatch(d);
    expect(res.done).toBe(1);
    expect(start).not.toHaveBeenCalled();
    expect(store.rows[0].attempts).toBe(1);
  });
  it('a job still running at the end of the budget goes back to pending with its job id', async () => {
    const store = fakeStore();
    const { d, start } = deps(store, { polls: [{ status: 'processing', error: null, stems: {} }] });
    await enqueueStemJob(d, 't1');
    const res = await processStemBatch(d, { budgetMs: 2500 });
    expect(res.waiting).toBe(1);
    expect(store.rows[0]).toMatchObject({ status: 'pending', job_id: 'demucs:job-1' });
    expect(store.trackStatus.t1).toBe('pending');
    expect(start).toHaveBeenCalledTimes(1);
  });
  it('a job older than the age limit is failed instead of queued forever', async () => {
    const store = fakeStore();
    const { d, advance, start } = deps(store);
    await enqueueStemJob(d, 't1');
    advance(3 * 60 * 60_000);
    const res = await processStemBatch(d);
    expect(res.expired).toBe(1);
    expect(store.rows[0].status).toBe('failed');
    expect(start).not.toHaveBeenCalled();
  });
  it('two drivers racing for one row: exactly one runs it', async () => {
    const store = fakeStore();
    const a = deps(store); const b = deps(store);
    await enqueueStemJob(a.d, 't1');
    const [ra, rb] = await Promise.all([processStemBatch(a.d), processStemBatch(b.d)]);
    expect(ra.claimed + rb.claimed).toBe(1);
  });
});

describe('reduced mode (migration 205 not applied)', () => {
  it('runs the same lifecycle on status alone and still persists a failure', async () => {
    const store = fakeStore({ locks: false });
    const ok = deps(store);
    await enqueueStemJob(ok.d, 't1');
    expect((await processStemBatch(ok.d)).done).toBe(1);

    const bad = fakeStore({ locks: false });
    const b = deps(bad, { polls: [{ status: 'error', error: 'boom', stems: {} }] });
    await enqueueStemJob(b.d, 't1');
    await processStemBatch(b.d);
    expect(bad.rows[0].status).toBe('pending'); // no counter: retried until the age cap
    b.advance(3 * 60 * 60_000);
    await processStemBatch(b.d);
    expect(bad.rows[0].status).toBe('failed');
    expect(bad.trackStatus.t1).toBe('failed');
  });
  it('reclaims a processing row by created_at age', async () => {
    const store = fakeStore({ locks: false });
    const { d, advance } = deps(store);
    await enqueueStemJob(d, 't1');
    store.rows[0].status = 'processing';
    expect((await processStemBatch(d)).claimed).toBe(0);
    advance(STALE_LOCK_MS + 1000);
    expect((await processStemBatch(d)).done).toBe(1);
  });
});
