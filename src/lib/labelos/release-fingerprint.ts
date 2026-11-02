/**
 * The facts a delivery or a store listing was planned from (LABEL-73, G7 with
 * G10's amendments), handed to the atomic function so it can compare them with
 * the same facts under the release's row lock (migration 187).
 *
 * Scope: the release row (`updated_at` as the RAW string PostgREST returned —
 * never through a JS Date, which would cut microseconds), the tracklist, and
 * the latest release-subject approval per gate. Song-level credits, splits,
 * legal readiness and `organizations.settings` are not covered: a changed
 * split stales the legal approval on read, and the audit event records what
 * was delivered.
 *
 * Read the fingerprint BEFORE evaluating readiness: anything that changes
 * after this read is caught by the function.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export const FINGERPRINT_GATES = ['master', 'artwork', 'legal', 'marketing', 'metadata'] as const;
export type FingerprintGate = (typeof FINGERPRINT_GATES)[number];

export type ItemRef = { id: string; position: number; song_track_id: string; master_track_id: string };

/** Same string as SQL `labelos_release_items_key`: `song:master` in (position, id) order, joined by commas. */
export function releaseItemsKey(items: readonly ItemRef[]): string {
  return [...items]
    .sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((i) => `${i.song_track_id.toLowerCase()}:${i.master_track_id.toLowerCase()}`)
    .join(',');
}

export type ApprovalRef = { id: string; gate: string; created_at: string };

/** The latest approval row id per gate ('' = none). Newest first by created_at, then id — as the SQL does. */
export function latestApprovalIds(rows: readonly ApprovalRef[]): Record<FingerprintGate, string> {
  const out = Object.fromEntries(FINGERPRINT_GATES.map((g) => [g, ''])) as Record<FingerprintGate, string>;
  const best: Partial<Record<string, ApprovalRef>> = {};
  for (const r of rows) {
    const cur = best[r.gate];
    if (!cur || r.created_at > cur.created_at || (r.created_at === cur.created_at && r.id > cur.id)) best[r.gate] = r;
  }
  for (const g of FINGERPRINT_GATES) out[g] = best[g]?.id.toLowerCase() ?? '';
  return out;
}

export type Fingerprint = { updatedAt: string; items: string; approvals: Record<FingerprintGate, string> };

export function deliverExpectation(f: Fingerprint): Record<string, unknown> {
  return { release_updated_at: f.updatedAt, items: f.items, approvals: f.approvals };
}

export function storeExpectation(r: { state: string; imported_released: boolean; release_date: string | null; store_listed: boolean }, items: string): Record<string, unknown> {
  return { state: r.state, imported_released: r.imported_released, release_date: r.release_date, store_listed: r.store_listed, items };
}

type Admin = Pick<SupabaseClient, 'from'>;

export async function readItemsKey(admin: Admin, releaseId: string): Promise<string> {
  const { data, error } = await admin
    .from('release_items')
    .select('id, position, song_track_id, master_track_id')
    .eq('release_id', releaseId)
    .order('position', { ascending: true })
    .limit(1000);
  if (error) throw new Error(`release items: ${error.message}`);
  return releaseItemsKey((data ?? []) as ItemRef[]);
}

/** Null when the release is not there. The approvals table missing (157) reads as no approvals. */
export async function readFingerprint(admin: Admin, org: string, releaseId: string): Promise<Fingerprint | null> {
  const rel = await admin.from('releases').select('updated_at').eq('id', releaseId).eq('org_id', org).maybeSingle();
  if (rel.error) throw new Error(`release: ${rel.error.message}`);
  if (!rel.data) return null;
  const items = await readItemsKey(admin, releaseId);
  const ap = await admin.from('approvals').select('id, gate, created_at').eq('release_id', releaseId).eq('org_id', org).order('created_at', { ascending: false }).limit(500);
  if (ap.error && ap.error.code !== '42P01' && ap.error.code !== 'PGRST205') throw new Error(`approvals: ${ap.error.message}`);
  return { updatedAt: (rel.data as { updated_at: string }).updated_at, items, approvals: latestApprovalIds((ap.data ?? []) as ApprovalRef[]) };
}
