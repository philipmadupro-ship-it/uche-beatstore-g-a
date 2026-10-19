/**
 * Reads and writes of an org track's metadata (LABEL-53), service role.
 * The rules are `track-metadata.ts`; the authorisation is the route's.
 *
 * The write is a compare-and-set on `metadata_updated_at`: the token the
 * editor loaded with (`null` = never edited). Of two people saving one row
 * the second sees `false` and is told, with the current values, instead of
 * overwriting. The token is set here and nowhere else, so a background job
 * (peaks, preview, a stage move) cannot make an edit conflict.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { METADATA_COLUMNS, type MetadataValues } from '@/lib/labelos/track-metadata';

type AdminClient = SupabaseClient;

export type MetadataRow = MetadataValues & { metadata_updated_at: string | null };

export async function readMetadata(admin: AdminClient, org: string, trackId: string): Promise<MetadataRow | null> {
  const { data, error } = await admin.from('tracks').select(METADATA_COLUMNS).eq('id', trackId).eq('org_id', org).maybeSingle();
  if (error) throw new Error(`metadata read: ${error.message}`);
  return (data as unknown as MetadataRow | null) ?? null;
}

/** Two renderings of one instant ("…123Z" from JS, "…123+00:00" from PostgREST) are the same token. */
export function sameToken(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a == null || b == null) return a == null && b == null;
  const x = Date.parse(a);
  const y = Date.parse(b);
  return Number.isNaN(x) || Number.isNaN(y) ? a === b : x === y;
}

/**
 * The row's NEW token (the database's own rendering of it) when the row still
 * held `expected` and was written; null when it changed meanwhile. `expected`
 * must be the string the database returned, never a client's rendering.
 */
export async function writeMetadata(
  admin: AdminClient,
  args: { org: string; trackId: string; expected: string | null; set: Partial<MetadataValues>; now: string },
): Promise<string | null> {
  let q = admin.from('tracks').update({ ...args.set, metadata_updated_at: args.now }).eq('id', args.trackId).eq('org_id', args.org);
  q = args.expected === null ? q.is('metadata_updated_at', null) : q.eq('metadata_updated_at', args.expected);
  const { data, error } = await q.select('metadata_updated_at');
  if (error) throw new Error(`metadata write: ${error.message}`);
  const rows = (data ?? []) as { metadata_updated_at: string | null }[];
  return rows.length === 1 ? rows[0].metadata_updated_at ?? args.now : null;
}
