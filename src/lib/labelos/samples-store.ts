/**
 * The reads and the one write behind `/api/org/[orgId]/tracks/[id]/samples`
 * (LABEL-29). Rules are `samples.ts`; this file only touches the database,
 * with the service role and an org filter on every query. Migration 156 may
 * not be applied: a missing column is `SamplesNotReadyError`.
 */
import type { AdminClient } from '@/lib/auth/ownership';
import { isUUID } from '@/lib/validate';
import { isSamplesDeclared, type SamplesState } from './samples';

export class SamplesNotReadyError extends Error {
  constructor() {
    super('migration 156 is not applied');
  }
}

export const SAMPLES_NOT_READY = 'Sample declarations need migration 156, which is not applied yet.';

type DbError = { message: string; code?: string } | null | undefined;
const MISSING = ['PGRST205', '42P01', '42703', 'PGRST204'];

function check(what: string, error: DbError): void {
  if (!error) return;
  if (MISSING.includes(error.code ?? '')) throw new SamplesNotReadyError();
  throw new Error(`${what}: ${error.message}`);
}

const COLUMNS = 'id, title, type, samples_declared, samples_clearance_note, samples_clearance_asset_id';

export type SamplesSong = { id: string; title: string | null; type: string | null; state: SamplesState };

/** The song with its declaration, or null when it is not a track of `org`. */
export async function readSamplesSong(admin: AdminClient, org: string, trackId: string): Promise<SamplesSong | null> {
  const res = await admin.from('tracks').select(COLUMNS).eq('id', trackId).eq('org_id', org).maybeSingle();
  check('samples read', res.error);
  const row = res.data as {
    id: string;
    title: string | null;
    type: string | null;
    samples_declared?: string | null;
    samples_clearance_note?: string | null;
    samples_clearance_asset_id?: string | null;
  } | null;
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    state: {
      samples: isSamplesDeclared(row.samples_declared) ? row.samples_declared : 'unknown',
      note: row.samples_clearance_note ?? null,
      assetId: row.samples_clearance_asset_id ?? null,
    },
  };
}

export type AssetCheck = 'ok' | 'not_found' | 'not_restricted' | 'not_in_song_project';

/**
 * May this file be the song's clearance? A restricted `project_assets` row of
 * the org, in a project that holds the song (the migration's trigger holds the
 * org and the sensitivity again).
 */
export async function checkClearanceAsset(admin: AdminClient, org: string, trackId: string, assetId: string): Promise<AssetCheck> {
  if (!isUUID(assetId)) return 'not_found';
  const asset = await admin.from('project_assets').select('id, project_id, sensitivity').eq('id', assetId).eq('org_id', org).maybeSingle();
  if (asset.error) throw new Error(`clearance file read: ${asset.error.message}`);
  const row = asset.data as { id: string; project_id: string; sensitivity: string } | null;
  if (!row) return 'not_found';
  if (row.sensitivity !== 'restricted') return 'not_restricted';
  const link = await admin.from('project_tracks').select('project_id').eq('project_id', row.project_id).eq('track_id', trackId);
  if (link.error) throw new Error(`clearance project read: ${link.error.message}`);
  return ((link.data ?? []) as unknown[]).length > 0 ? 'ok' : 'not_in_song_project';
}

/** Compare-and-set is not needed: the declaration is a last-write-wins field, and each write records an event. */
export async function writeSamples(admin: AdminClient, org: string, trackId: string, s: SamplesState): Promise<void> {
  const res = await admin
    .from('tracks')
    .update({ samples_declared: s.samples, samples_clearance_note: s.note, samples_clearance_asset_id: s.assetId })
    .eq('id', trackId)
    .eq('org_id', org);
  check('samples write', res.error);
}
