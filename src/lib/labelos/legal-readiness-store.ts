/**
 * The reads behind `GET /api/org/[orgId]/tracks/[id]/legal-readiness`
 * (LABEL-29). The rules are `legal-readiness.ts`; this file only touches the
 * database, with the service role and an org filter on every query. It writes
 * nothing, and it reads every credit and sheet of the song whoever asks —
 * what the caller is TOLD is the route's decision (`readinessView`).
 *
 * Migrations 153 (credits / parties) and 155 (split sheets) may not be
 * applied: either missing is `LegalReadinessNotReadyError`, which the route
 * answers as `schemaReady: false`.
 *
 * The sample declaration is migration 156's `tracks.samples_declared` (+ a
 * clearance note / file). Without 156 it reads `unknown`, a blocker by the spec.
 */
import { RELEASE_STATES_NOT_GOING_OUT } from './releases';
import type { AdminClient } from '@/lib/auth/ownership';
import { CreditsNotReadyError, listCredits, partiesByIds } from './credits-store';
import { isCreditScope } from './credit-roles';
import type { LegalFacts, ReadinessCredit, ReadinessParty, ReadinessSheet, SamplesDeclared } from './legal-readiness';
import { isSamplesDeclared, isCleared } from './samples';
import { isSplitKind } from './splits';
import { linesOfSheets, listSheets, SplitsNotReadyError } from './splits-store';

export class LegalReadinessNotReadyError extends Error {
  constructor() {
    super('migrations 153 and 155 are not both applied');
  }
}

type DbError = { message: string; code?: string } | null | undefined;

function fail(what: string, error: { message: string }): never {
  throw new Error(`${what}: ${error.message}`);
}

const MISSING = ['PGRST205', '42P01', '42703', 'PGRST204'];

/** The song row, with the columns readiness needs. Null when it is not a track of `org`. */
export async function readReadinessSong(
  admin: AdminClient,
  org: string,
  trackId: string,
): Promise<{ id: string; title: string | null; type: string | null; isrc: string | null; samples: SamplesDeclared; cleared: boolean } | null> {
  let res = await admin
    .from('tracks')
    .select('id, title, type, isrc, samples_declared, samples_clearance_note, samples_clearance_asset_id')
    .eq('id', trackId)
    .eq('org_id', org)
    .maybeSingle();
  let withSamples = true;
  if ((res.error as DbError)?.code && MISSING.includes((res.error as DbError)!.code!)) {
    // Migration 156 not applied: nothing is declared, nothing is cleared.
    withSamples = false;
    res = await admin.from('tracks').select('id, title, type, isrc').eq('id', trackId).eq('org_id', org).maybeSingle();
  }
  if (res.error) fail('song read', res.error);
  const row = res.data as {
    id: string;
    title: string | null;
    type: string | null;
    isrc: string | null;
    samples_declared?: string | null;
    samples_clearance_note?: string | null;
    samples_clearance_asset_id?: string | null;
  } | null;
  if (!row) return null;
  const samples: SamplesDeclared = withSamples && isSamplesDeclared(row.samples_declared) ? row.samples_declared : 'unknown';
  const cleared = withSamples && isCleared({ note: row.samples_clearance_note ?? null, assetId: row.samples_clearance_asset_id ?? null });
  return { id: row.id, title: row.title, type: row.type, isrc: row.isrc, samples, cleared };
}

/** The org's switch (09 §3.1 L11). Off unless the setting is exactly true. */
export async function requireSignedMasterSplit(admin: AdminClient, org: string): Promise<boolean> {
  const res = await admin.from('organizations').select('settings').eq('id', org).maybeSingle();
  if (res.error) fail('org settings read', res.error);
  const settings = (res.data as { settings?: Record<string, unknown> | null } | null)?.settings;
  return settings?.require_signed_master_split === true;
}

/**
 * Is the song on a release that is going out, and which recording goes out as
 * it? A cancelled release does not count (06 §2.3). Returns the master track of
 * the first such item (a song is on one release in practice).
 */
export async function releaseFacts(admin: AdminClient, org: string, trackId: string): Promise<{ onRelease: boolean; masterTrackId: string | null }> {
  const items = await admin.from('release_items').select('release_id, master_track_id').eq('org_id', org).eq('song_track_id', trackId);
  if (items.error) {
    if (MISSING.includes(items.error.code ?? '')) return { onRelease: false, masterTrackId: null };
    fail('release items read', items.error);
  }
  const rows = (items.data ?? []) as { release_id: string; master_track_id: string }[];
  if (rows.length === 0) return { onRelease: false, masterTrackId: null };
  const releases = await admin.from('releases').select('id, state').eq('org_id', org).in('id', rows.map((r) => r.release_id));
  if (releases.error) fail('releases read', releases.error);
  const live = new Set(((releases.data ?? []) as { id: string; state: string }[]).filter((r) => !RELEASE_STATES_NOT_GOING_OUT.includes(r.state)).map((r) => r.id));
  const item = rows.find((r) => live.has(r.release_id));
  return item ? { onRelease: true, masterTrackId: item.master_track_id } : { onRelease: false, masterTrackId: null };
}

/** The ISRC of the master recording: the release's master, else the song's linked `master`, else the song itself. */
async function masterIsrc(admin: AdminClient, org: string, song: { id: string; isrc: string | null }, releaseMaster: string | null): Promise<string | null> {
  let masterId = releaseMaster;
  if (!masterId) {
    const links = await admin.from('track_links').select('to_track_id').eq('from_track_id', song.id).eq('relation', 'master');
    if (links.error) fail('master link read', links.error);
    masterId = ((links.data ?? []) as { to_track_id: string }[])[0]?.to_track_id ?? null;
  }
  if (!masterId || masterId === song.id) return song.isrc;
  const res = await admin.from('tracks').select('isrc').eq('id', masterId).eq('org_id', org).maybeSingle();
  if (res.error) fail('master read', res.error);
  return (res.data as { isrc: string | null } | null)?.isrc ?? null;
}

/** Everything `evaluateLegalReadiness` needs for one org song. */
export async function loadLegalFacts(
  admin: AdminClient,
  org: string,
  song: { id: string; title: string | null; isrc: string | null; samples: SamplesDeclared; cleared: boolean },
): Promise<LegalFacts> {
  let creditRows;
  let sheetRows;
  try {
    creditRows = await listCredits(admin, org, song.id);
    sheetRows = await listSheets(admin, org, song.id);
  } catch (err) {
    if (err instanceof CreditsNotReadyError || err instanceof SplitsNotReadyError) throw new LegalReadinessNotReadyError();
    throw err;
  }

  const parties = await partiesByIds(admin, org, creditRows.map((c) => c.party_id));
  // Lines may name a party no credit does; the sheet check wants only ids, but a party read keeps the facts honest.
  const lines = await linesOfSheets(admin, org, sheetRows.map((s) => s.id));

  const credits: ReadinessCredit[] = creditRows.map((c) => ({
    id: c.id,
    role: c.role,
    scope: isCreditScope(c.scope) ? c.scope : null,
    status: c.status,
    partyId: c.party_id,
    name: c.name,
  }));
  const partyFacts: ReadinessParty[] = [...parties.values()].map((p) => ({
    id: p.id,
    displayName: p.display_name,
    legalName: p.legal_name,
    ipi: p.ipi,
    pro: p.pro,
    proAffiliation: p.pro_affiliation,
    publisherName: p.publisher_name,
  }));
  const sheets: ReadinessSheet[] = sheetRows
    .filter((s) => isSplitKind(s.kind))
    .map((s) => ({
      id: s.id,
      kind: s.kind as 'composition' | 'master',
      version: s.version,
      status: s.status,
      lines: (lines.get(s.id) ?? []).map((l) => ({ partyId: l.party_id, role: l.role, share: l.share, signed: !!l.signed_at })),
    }));

  const [release, requireSigned] = await Promise.all([releaseFacts(admin, org, song.id), requireSignedMasterSplit(admin, org)]);
  const isrc = await masterIsrc(admin, org, song, release.masterTrackId);

  return {
    title: song.title,
    credits,
    parties: partyFacts,
    sheets,
    onRelease: release.onRelease,
    samples: song.samples,
    sampleClearance: song.cleared,
    requireSignedMasterSplit: requireSigned,
    isrc,
  };
}
