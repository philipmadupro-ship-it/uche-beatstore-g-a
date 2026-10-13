/**
 * The reads behind `GET /api/org/[orgId]/releases/[id]/export` (LABEL-34).
 * The rules are `metadata-export.ts`; this file only touches the database,
 * with the service role and an org filter on every query. Authorisation is
 * the route's: it passes `includeRights` only for a caller holding
 * `rights.read`, and credits are not read at all otherwise.
 *
 * Migration 153 (credits on org songs) may not be applied: then the export
 * goes out WITHOUT contributors and says so, rather than failing.
 */
import type { AdminClient } from '@/lib/auth/ownership';
import { isMissingSchema } from '@/lib/artists/workspace-load';
import { creditRoleLabel } from './credit-roles';
import { CREDIT_COLUMNS, CreditsNotReadyError, isMissingCreditsSchema, partiesByIds } from './credits-store';
import type { CreditRow } from './credits';
import type { ExportContributor, ExportInput, ExportItem } from './metadata-export';
import { RELEASE_ITEM_COLUMNS, type ReleaseItemRow, type ReleaseRow } from './releases';

type DbError = { message: string; code?: string } | null | undefined;

function check(what: string, error: DbError): void {
  if (error) throw new Error(`${what}: ${error.message}`);
}

export type LoadedExport = Omit<ExportInput, 'generatedAt'> & { notes: string[] };

/** The release row's tracklist, titles, ISRCs and (with `includeRights`) confirmed-or-not credits. */
export async function loadExportInput(admin: AdminClient, release: ReleaseRow, includeRights: boolean): Promise<LoadedExport> {
  const org = release.org_id;
  const [artist, itemRes] = await Promise.all([
    admin.from('contacts').select('name').eq('id', release.contact_id).eq('org_id', org).maybeSingle(),
    admin.from('release_items').select(RELEASE_ITEM_COLUMNS).eq('release_id', release.id).eq('org_id', org).order('position', { ascending: true }),
  ]);
  check('artist read', artist.error);
  check('release items read', itemRes.error);
  const itemRows = ((itemRes.data ?? []) as unknown as ReleaseItemRow[]).sort((a, b) => a.position - b.position);

  const trackIds = [...new Set(itemRows.flatMap((i) => [i.song_track_id, i.master_track_id]))];
  const tracks = new Map<string, { title: string; isrc: string | null }>();
  if (trackIds.length > 0) {
    const res = await admin.from('tracks').select('id, title, isrc').eq('org_id', org).in('id', trackIds);
    check('track read', res.error);
    for (const t of (res.data ?? []) as { id: string; title: string | null; isrc: string | null }[]) tracks.set(t.id.toLowerCase(), { title: t.title ?? '', isrc: t.isrc });
  }

  const notes: string[] = [];
  const credits = new Map<string, ExportContributor[]>();
  let withRights = includeRights;
  if (includeRights && trackIds.length > 0) {
    try {
      const res = await admin.from('track_collaborators').select(CREDIT_COLUMNS).eq('org_id', org).in('track_id', trackIds).order('created_at', { ascending: true });
      if (res.error) {
        if (isMissingCreditsSchema(res.error) || isMissingSchema(res.error)) throw new CreditsNotReadyError();
        check('credit read', res.error);
      }
      const rows = (res.data ?? []) as unknown as CreditRow[];
      const parties = await partiesByIds(admin, org, rows.map((r) => r.party_id));
      for (const r of rows) {
        const party = r.party_id ? parties.get(r.party_id) : undefined;
        const list = credits.get(r.track_id.toLowerCase()) ?? [];
        list.push({ name: party?.display_name || r.name, role: creditRoleLabel(r.role), ipi: party?.ipi ?? null, status: r.status });
        credits.set(r.track_id.toLowerCase(), list);
      }
    } catch (err) {
      if (!(err instanceof CreditsNotReadyError)) throw err;
      withRights = false;
      notes.push('Contributors are not included: credits need migration 153 applied.');
    }
  }

  const items: ExportItem[] = itemRows.map((i) => {
    const song = tracks.get(i.song_track_id.toLowerCase());
    const master = tracks.get(i.master_track_id.toLowerCase());
    // Credits on the song and on the recording that goes out, each person-and-role once.
    const seen = new Set<string>();
    const contributors = [...(credits.get(i.song_track_id.toLowerCase()) ?? []), ...(credits.get(i.master_track_id.toLowerCase()) ?? [])].filter((c) => {
      const key = `${c.name.trim().toLowerCase()}\0${c.role}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return { position: i.position, isrc: master?.isrc ?? null, title: song?.title ?? '', versionTitle: i.version_title, explicit: i.explicit, contributors };
  });

  return {
    release: {
      title: release.title,
      type: release.type,
      displayArtist: (artist.data as { name: string | null } | null)?.name ?? null,
      labelName: release.label_name,
      upc: release.upc,
      pLine: release.p_line,
      cLine: release.c_line,
      primaryGenre: release.primary_genre,
      releaseDate: release.release_date,
      targetDate: release.target_date,
    },
    items,
    includeRights: withRights,
    notes,
  };
}
