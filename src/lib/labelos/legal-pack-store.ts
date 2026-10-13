/**
 * The reads behind `GET /api/org/[orgId]/releases/[releaseId]/legal-pack`
 * (LABEL-31). Rules are `legal-pack.ts` (pure rows, names) and
 * `org-assets.ts` (who may open which file); this file only touches the
 * database and storage, with the service role and an org filter on every
 * query. Authorisation is the route's (`contracts.read` + `rights.read` on a
 * release the member can open).
 *
 * Songs the member cannot open themselves (artist scope, D4's row rule) are
 * left out and COUNTED, so a pack is never silently the whole release when it
 * is not. A document is added only when its asset row is this org's, the
 * member may read it (`canReadOrgAsset`: a restricted file needs
 * `contracts.read`), its reference is the org's own private-bucket key
 * (`orgProjectAssetKeyOf`) and the object exists; otherwise it is named in the
 * README as missing, never swallowed. Bytes are streamed by the route through
 * `openProjectAsset`; no private URL ever leaves the server.
 */
import { objectAccessFor, type OrgAccessOk } from '@/lib/auth/org-access';
import type { AdminClient } from '@/lib/auth/ownership';
import { projectAssetBuckets, projectAssetSize } from '@/lib/storage/project-assets';
import { listCredits, partiesByIds } from './credits-store';
import { LegalReadinessNotReadyError } from './legal-readiness-store';
import { canReadOrgAsset, orgProjectAssetKeyOf, type OrgAssetRow } from './org-assets';
import { documentPath, sheetsInForce, type PackCredit, type PackDocument, type PackParty, type PackSheet, type PackSong } from './legal-pack';
import { CreditsNotReadyError } from './credits-store';
import { readReadinessSong } from './legal-readiness-store';
import { memberMayReadSongRow } from './song-stage-store';
import { SplitsNotReadyError, linesOfSheets, listSheets } from './splits-store';
import { SPLIT_KIND_LABEL, isSplitKind } from './splits';

export type LegalPackData = {
  songs: PackSong[];
  parties: Map<string, PackParty>;
  documents: (PackDocument & { ref: string })[];
  /** Documents named by a sheet or song that cannot be added, as one line each (no key, no URL). */
  missingDocuments: string[];
  songsNotIncluded: number;
};

const ASSET_COLUMNS = 'id, project_id, org_id, kind, sensitivity, label, file_name, url, mime';

/** Song ids of the release in tracklist order, each once. */
export async function releaseSongIds(admin: AdminClient, org: string, releaseId: string): Promise<string[]> {
  const res = await admin.from('release_items').select('position, song_track_id').eq('release_id', releaseId).eq('org_id', org).order('position', { ascending: true });
  if (res.error) throw new Error(`release items read: ${res.error.message}`);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of (res.data ?? []) as { song_track_id: string }[]) {
    if (!seen.has(r.song_track_id)) {
      seen.add(r.song_track_id);
      out.push(r.song_track_id);
    }
  }
  return out;
}

/** The song's clearance file (migration 156); null before 156 or when none is attached. */
async function clearanceAssetId(admin: AdminClient, org: string, songId: string): Promise<string | null> {
  const res = await admin.from('tracks').select('samples_clearance_asset_id').eq('id', songId).eq('org_id', org).maybeSingle();
  if (res.error) return null;
  return (res.data as { samples_clearance_asset_id?: string | null } | null)?.samples_clearance_asset_id ?? null;
}

export async function gatherLegalPack(access: OrgAccessOk, releaseId: string): Promise<LegalPackData> {
  const { admin, orgId: org } = access;
  const songIds = await releaseSongIds(admin, org, releaseId);

  const songs: PackSong[] = [];
  const wanted = new Map<string, { assetId: string; songTitle: string | null; what: string; describes: string }[]>();
  let songsNotIncluded = 0;
  const want = (assetId: string | null, songTitle: string | null, what: string, describes: string) => {
    if (!assetId) return;
    wanted.set(assetId, [...(wanted.get(assetId) ?? []), { assetId, songTitle, what, describes }]);
  };

  for (const songId of songIds) {
    const reach = await objectAccessFor(access.userId, { table: 'tracks', id: songId, cap: 'catalog.read', orgId: org });
    const song = reach.ok ? await readReadinessSong(admin, org, songId) : null;
    if (!reach.ok || !song || song.type !== 'song' || !(await memberMayReadSongRow(admin, org, songId, access.capabilities))) {
      songsNotIncluded += 1;
      continue;
    }
    let creditRows;
    let sheetRows;
    try {
      creditRows = await listCredits(admin, org, songId);
      sheetRows = await listSheets(admin, org, songId);
    } catch (err) {
      if (err instanceof CreditsNotReadyError || err instanceof SplitsNotReadyError) throw new LegalReadinessNotReadyError();
      throw err;
    }
    const lines = await linesOfSheets(admin, org, sheetRows.map((s) => s.id));
    const sheets: PackSheet[] = sheetRows
      .filter((s) => isSplitKind(s.kind))
      .map((s) => ({
        id: s.id,
        kind: s.kind,
        version: s.version,
        status: s.status,
        lines: (lines.get(s.id) ?? []).map((l, i) => ({ partyId: l.party_id, role: l.role, share: l.share, signedAt: l.signed_at, position: l.position ?? i })),
      }));
    const credits: PackCredit[] = creditRows.map((c) => ({ id: c.id, role: c.role, status: c.status, partyId: c.party_id, name: c.name }));
    songs.push({ id: songId, title: song.title, sheets, credits });

    // Documents: the sheets in force and their signatures, and the sample clearance.
    for (const sheet of sheetsInForce(sheets)) {
      const row = sheetRows.find((s) => s.id === sheet.id)!;
      const label = `${SPLIT_KIND_LABEL[sheet.kind as 'composition' | 'master']} split v${sheet.version}`;
      want(row.document_asset_id, song.title, `${label} (document)`, `${label} of “${song.title ?? 'Untitled'}”, signed document`);
      for (const l of lines.get(sheet.id) ?? []) want(l.signature_asset_id, song.title, `${label} signature`, `Signed copy of the ${label} of “${song.title ?? 'Untitled'}”`);
    }
    want(await clearanceAssetId(admin, org, songId), song.title, 'Sample clearance', `Sample clearance for “${song.title ?? 'Untitled'}”`);
  }

  const parties = await loadParties(admin, org, songs);
  const { documents, missingDocuments } = await resolveDocuments(access, wanted);
  return { songs, parties, documents, missingDocuments, songsNotIncluded };
}

async function loadParties(admin: AdminClient, org: string, songs: readonly PackSong[]): Promise<Map<string, PackParty>> {
  const ids = songs.flatMap((s) => [...s.credits.map((c) => c.partyId), ...s.sheets.flatMap((sh) => sh.lines.map((l) => l.partyId))]);
  const rows = await partiesByIds(admin, org, ids);
  const out = new Map<string, PackParty>();
  for (const p of rows.values()) {
    out.set(p.id, { id: p.id, displayName: p.display_name, legalName: p.legal_name, pro: p.pro, proAffiliation: p.pro_affiliation, ipi: p.ipi, publisherName: p.publisher_name });
  }
  return out;
}

async function resolveDocuments(
  access: OrgAccessOk,
  wanted: ReadonlyMap<string, { assetId: string; songTitle: string | null; what: string; describes: string }[]>,
): Promise<Pick<LegalPackData, 'documents' | 'missingDocuments'>> {
  const documents: LegalPackData['documents'] = [];
  const missingDocuments: string[] = [];
  if (wanted.size === 0) return { documents, missingDocuments };

  const res = await access.admin.from('project_assets').select(ASSET_COLUMNS).eq('org_id', access.orgId).in('id', [...wanted.keys()]);
  if (res.error) throw new Error(`asset read: ${res.error.message}`);
  const rows = new Map(((res.data ?? []) as unknown as OrgAssetRow[]).map((r) => [r.id, r]));
  const buckets = projectAssetBuckets();

  for (const [assetId, uses] of wanted) {
    const row = rows.get(assetId);
    const first = uses[0];
    const name = `${first.what} — ${first.songTitle ?? 'Untitled'}`;
    // Fail closed: a file the member may not open, or whose reference is not this org project's own key, is not added.
    if (!row || !canReadOrgAsset(access.capabilities, row) || !orgProjectAssetKeyOf(row.url, access.orgId, row.project_id, buckets)) {
      missingDocuments.push(name);
      continue;
    }
    if ((await projectAssetSize(row.url)) === null) {
      missingDocuments.push(name);
      continue;
    }
    documents.push({
      assetId,
      ref: row.url,
      path: documentPath(first.songTitle, first.what, assetId, row.file_name),
      describes: uses.map((u) => u.describes).join('; '),
    });
  }
  return { documents, missingDocuments };
}
