/**
 * Persistence for stem jobs (AUDIO-05). The pipeline talks to this interface
 * only, so it runs against Supabase, the local JSON store, or an in-memory fake
 * in tests. Supabase claims are compare-and-set UPDATEs (never one `or=`
 * filter: PostgREST rejects `or` on a PATCH, see claimJob in upload processing).
 */
import { createServiceClient, getAll, getById, insert, update } from '@/lib/db';
import { isMissingSchema } from '@/lib/artists/workspace-load';
import { isExhausted, isStale, trackStatusFor, type StemJobRow, type StemJobStatus } from './lifecycle';

export interface StemTrack {
  id: string;
  title: string | null;
  user_id: string | null;
  audio_url: string | null;
  wav_url: string | null;
}

export interface StemRowFull extends StemJobRow {
  vocals_url?: string | null;
  drums_url?: string | null;
  bass_url?: string | null;
  other_url?: string | null;
}

export interface StemPatch {
  status?: StemJobStatus;
  job_id?: string | null;
  attempts?: number;
  last_error?: string | null;
  locked_at?: string | null;
  vocals_url?: string | null;
  drums_url?: string | null;
  bass_url?: string | null;
  other_url?: string | null;
}

export interface StemStore {
  /** Do the migration-205 lifecycle columns exist? */
  hasLocks(): Promise<boolean>;
  findByTrack(trackId: string): Promise<StemRowFull | null>;
  findByJobId(jobId: string): Promise<StemRowFull | null>;
  /** Rows that may need a driver: pending and processing. */
  listWork(limit: number): Promise<StemRowFull[]>;
  /** Insert the one row for a track; null when another request got there first. */
  create(trackId: string): Promise<StemRowFull | null>;
  /** Back to a clean pending job (retry). Compare-and-set on the status read. */
  reset(row: StemRowFull, now: number): Promise<StemRowFull | null>;
  /** Take a pending or stale row for this driver. Null when someone else did. */
  claim(row: StemRowFull, now: number): Promise<StemRowFull | null>;
  patch(row: StemRowFull, patch: StemPatch, now: number): Promise<void>;
  setTrackStatus(trackId: string, status: StemJobStatus): Promise<void>;
  loadTrack(trackId: string): Promise<StemTrack | null>;
}

const LOCK_COLS = ['attempts', 'last_error', 'locked_at', 'updated_at'] as const;

function stripLocks<T extends object>(patch: T, locks: boolean): T {
  if (locks) return patch;
  const copy = { ...patch } as Record<string, unknown>;
  for (const c of LOCK_COLS) delete copy[c];
  return copy as T;
}

// ── Supabase ────────────────────────────────────────────────────────────

let locksCache: { at: number; value: boolean } | null = null;
const LOCKS_TTL_MS = 60_000;

export function resetLocksCache() { locksCache = null; }

export function supabaseStemStore(): StemStore {
  const admin = createServiceClient();

  const store: StemStore = {
    async hasLocks() {
      if (locksCache && Date.now() - locksCache.at < LOCKS_TTL_MS) return locksCache.value;
      const { error } = await admin.from('stems').select(LOCK_COLS.join(',')).limit(1);
      const value = !error || !isMissingSchema(error);
      locksCache = { at: Date.now(), value };
      return value;
    },

    async findByTrack(trackId) {
      const { data, error } = await admin.from('stems').select('*').eq('track_id', trackId).maybeSingle();
      if (error) throw error;
      return (data as StemRowFull | null) ?? null;
    },

    async findByJobId(jobId) {
      const { data, error } = await admin.from('stems').select('*').eq('job_id', jobId).limit(1).maybeSingle();
      if (error) throw error;
      return (data as StemRowFull | null) ?? null;
    },

    async listWork(limit) {
      const { data, error } = await admin
        .from('stems')
        .select('*')
        .in('status', ['pending', 'processing'])
        .order('created_at', { ascending: true })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as StemRowFull[];
    },

    async create(trackId) {
      const { data, error } = await admin
        .from('stems')
        .insert({ track_id: trackId, status: 'pending' })
        .select('*')
        .maybeSingle();
      if (error) {
        if ((error as { code?: string }).code === '23505') return null;
        throw error;
      }
      return (data as StemRowFull | null) ?? null;
    },

    async reset(row, now) {
      const locks = await store.hasLocks();
      const stamp = new Date(now).toISOString();
      const patch = stripLocks({
        status: 'pending', job_id: null, attempts: 0, last_error: null, locked_at: null, updated_at: stamp,
        vocals_url: null, drums_url: null, bass_url: null, other_url: null,
        // created_at is the job's age (and its lock age in reduced mode).
        created_at: stamp,
      }, locks);
      let q = admin.from('stems').update(patch).eq('id', row.id);
      q = row.status ? q.eq('status', row.status as string) : q.is('status', null);
      const { data, error } = await q.select('*');
      if (error) throw error;
      return ((data ?? [])[0] as StemRowFull | undefined) ?? null;
    },

    async claim(row, now) {
      const locks = await store.hasLocks();
      const stamp = new Date(now).toISOString();
      if (row.status === 'pending') {
        const { data, error } = await admin
          .from('stems')
          .update(stripLocks({ status: 'processing', locked_at: stamp, updated_at: stamp }, locks))
          .eq('id', row.id)
          .eq('status', 'pending')
          .select('*');
        if (error) throw error;
        return ((data ?? [])[0] as StemRowFull | undefined) ?? null;
      }
      // A crashed claim: take it only if nobody has touched the lock since we read it.
      const lockCol = locks && row.locked_at ? 'locked_at' : 'created_at';
      const lockVal = (locks && row.locked_at ? row.locked_at : row.created_at) as string | null | undefined;
      if (!lockVal) return null;
      const { data, error } = await admin
        .from('stems')
        .update(stripLocks({
          status: 'processing', locked_at: stamp, updated_at: stamp, attempts: (row.attempts ?? 0) + 1,
        }, locks))
        .eq('id', row.id)
        .eq('status', 'processing')
        .eq(lockCol, lockVal)
        .select('*');
      if (error) throw error;
      return ((data ?? [])[0] as StemRowFull | undefined) ?? null;
    },

    async patch(row, patch, now) {
      const locks = await store.hasLocks();
      const body = stripLocks({ ...patch, updated_at: new Date(now).toISOString() }, locks);
      const { error } = await admin.from('stems').update(body).eq('id', row.id);
      if (error) throw error;
    },

    async setTrackStatus(trackId, status) {
      const { error } = await admin.from('tracks').update({ stems_status: trackStatusFor(status) }).eq('id', trackId);
      if (error) throw error;
    },

    async loadTrack(trackId) {
      const { data, error } = await admin
        .from('tracks')
        .select('id, title, user_id, audio_url, wav_url')
        .eq('id', trackId)
        .maybeSingle();
      if (error) throw error;
      return (data as StemTrack | null) ?? null;
    },
  };
  return store;
}

// ── Local JSON store (no Supabase, dev only) ────────────────────────────

export function localStemStore(): StemStore {
  const rows = () => getAll<StemRowFull>('stems');
  const store: StemStore = {
    async hasLocks() { return true; },
    async findByTrack(trackId) { return rows().find((r) => r.track_id === trackId) ?? null; },
    async findByJobId(jobId) { return rows().find((r) => r.job_id === jobId) ?? null; },
    async listWork(limit) {
      return rows().filter((r) => r.status === 'pending' || r.status === 'processing').slice(0, limit);
    },
    async create(trackId) {
      if (rows().some((r) => r.track_id === trackId)) return null;
      return insert<Record<string, unknown>>('stems', { track_id: trackId, status: 'pending', attempts: 0 }) as unknown as StemRowFull;
    },
    async reset(row, now) {
      const stamp = new Date(now).toISOString();
      return update('stems', row.id, {
        status: 'pending', job_id: null, attempts: 0, last_error: null, locked_at: null, created_at: stamp,
        vocals_url: null, drums_url: null, bass_url: null, other_url: null,
      }) as StemRowFull | null;
    },
    async claim(row, now) {
      const live = rows().find((r) => r.id === row.id);
      if (!live) return null;
      if (live.status !== 'pending' && !isStale(live, now, true)) return null;
      const stale = live.status === 'processing';
      if (stale && isExhausted(live, now, true)) return null;
      return update('stems', row.id, {
        status: 'processing', locked_at: new Date(now).toISOString(),
        ...(stale ? { attempts: (live.attempts ?? 0) + 1 } : {}),
      }) as StemRowFull | null;
    },
    async patch(row, patch) { update('stems', row.id, patch); },
    async setTrackStatus(trackId, status) { update('tracks', trackId, { stems_status: trackStatusFor(status) }); },
    async loadTrack(trackId) { return getById<StemTrack>('tracks', trackId) as StemTrack | null; },
  };
  return store;
}

export function defaultStemStore(supabase: boolean): StemStore {
  return supabase ? supabaseStemStore() : localStemStore();
}
