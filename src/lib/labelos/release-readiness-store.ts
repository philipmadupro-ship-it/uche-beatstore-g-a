/**
 * The reads behind `GET /api/org/[orgId]/releases/[id]/readiness` (LABEL-32).
 * The rules are `release-readiness.ts`; this file only touches the database,
 * with the service role and an org filter on every query. It writes nothing
 * and reads everything whoever asks — what the caller is TOLD is the route's
 * decision (`releaseReadinessView`).
 *
 * Migrations 144 (releases), 153 / 155 (credits, splits: legal readiness) and
 * 157 (approvals) may not be applied: any missing is
 * `ReleaseReadinessNotReadyError`, which the route answers `schemaReady: false`.
 */
import { parseReadinessSettings, type OrgReadinessSettings } from '@/lib/contracts';
import type { AdminClient } from '@/lib/auth/ownership';
import { isMissingSchema } from '@/lib/artists/workspace-load';
import { ApprovalsNotReadyError, currentSnapshot, isMissingApprovalsSchema, listApprovals, readReleaseFacts } from './approvals-store';
import { CreditsNotReadyError } from './credits-store';
import { SplitsNotReadyError } from './splits-store';
import { currentDecision, GATES, type Gate } from './approvals';
import { evaluateLegalReadiness, type LegalReadiness } from './legal-readiness';
import { LegalReadinessNotReadyError, loadLegalFacts, readReadinessSong } from './legal-readiness-store';
import type { MasterRelation, ReadinessApproval, ReadinessItem, ReleaseReadinessFacts } from './release-readiness';
import { RELEASE_ITEM_COLUMNS, type ReleaseItemRow } from './releases';

export class ReleaseReadinessNotReadyError extends Error {
  constructor() {
    super('migration 144, 153, 155 or 157 is not applied');
  }
}

type DbError = { message: string; code?: string } | null | undefined;

function check(what: string, error: DbError): void {
  if (!error) return;
  if (isMissingSchema(error) || isMissingApprovalsSchema(error)) throw new ReleaseReadinessNotReadyError();
  throw new Error(`${what}: ${error.message}`);
}

/** The org's switches, validated: any stored value reads as a total settings object. */
export async function readReadinessSettings(admin: AdminClient, org: string): Promise<OrgReadinessSettings> {
  const res = await admin.from('organizations').select('settings').eq('id', org).maybeSingle();
  check('org settings read', res.error);
  return parseReadinessSettings((res.data as { settings?: unknown } | null)?.settings);
}

const RELATIONS: readonly MasterRelation[] = ['master', 'instrumental', 'version'];

/** Everything `evaluateReleaseReadiness` needs for one release of `org`; null when it is not one. */
export async function loadReleaseReadinessFacts(admin: AdminClient, org: string, releaseId: string): Promise<ReleaseReadinessFacts | null> {
  let base;
  try {
    base = await readReleaseFacts(admin, org, releaseId);
  } catch (err) {
    if (err instanceof Error && /relation|schema cache|does not exist|PGRST205|42P01/i.test(err.message)) throw new ReleaseReadinessNotReadyError();
    throw err;
  }
  if (!base) return null;

  const [relRes, settings] = await Promise.all([
    admin.from('releases').select('title, type, upc, label_name, c_line, p_line, primary_genre, target_date, release_date, state').eq('id', releaseId).eq('org_id', org).maybeSingle(),
    readReadinessSettings(admin, org),
  ]);
  check('release read', relRes.error);
  const rel = relRes.data as Record<string, string | null> | null;
  if (!rel) return null;

  const [artistRes, itemRes] = await Promise.all([
    admin.from('contacts').select('name').eq('id', base.contactId).eq('org_id', org).maybeSingle(),
    admin.from('release_items').select(RELEASE_ITEM_COLUMNS).eq('release_id', releaseId).eq('org_id', org).order('position', { ascending: true }),
  ]);
  check('artist read', artistRes.error);
  check('release items read', itemRes.error);
  const itemRows = (itemRes.data ?? []) as unknown as ReleaseItemRow[];

  let artwork: ReleaseReadinessFacts['artwork'] = null;
  if (base.artworkAssetId) {
    const a = await admin.from('project_assets').select('mime').eq('id', base.artworkAssetId).eq('org_id', org).eq('project_id', base.projectId).maybeSingle();
    check('artwork read', a.error);
    if (a.data) artwork = { mime: (a.data as { mime: string | null }).mime ?? null };
  }

  // Songs, masters and the link that makes a recording a master.
  const songIds = [...new Set(itemRows.map((i) => i.song_track_id))];
  const trackIds = [...new Set([...songIds, ...itemRows.map((i) => i.master_track_id)])];
  const [tracks, links] = trackIds.length
    ? await Promise.all([
        admin.from('tracks').select('id, type, isrc').eq('org_id', org).in('id', trackIds),
        admin.from('track_links').select('from_track_id, to_track_id, relation').in('from_track_id', songIds),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];
  check('track read', tracks.error);
  check('link read', links.error);
  const trackById = new Map(((tracks.data ?? []) as { id: string; type: string | null; isrc: string | null }[]).map((t) => [t.id.toLowerCase(), t]));
  const linkRows = (links.data ?? []) as { from_track_id: string; to_track_id: string; relation: string }[];

  const items: ReadinessItem[] = itemRows.map((i) => {
    const song = trackById.get(i.song_track_id.toLowerCase());
    const master = trackById.get(i.master_track_id.toLowerCase());
    let masterRelation: MasterRelation = null;
    if (i.master_track_id.toLowerCase() === i.song_track_id.toLowerCase()) masterRelation = 'self';
    else {
      const link = linkRows.find(
        (l) => l.from_track_id.toLowerCase() === i.song_track_id.toLowerCase() && l.to_track_id.toLowerCase() === i.master_track_id.toLowerCase() && (RELATIONS as readonly string[]).includes(l.relation),
      );
      masterRelation = (link?.relation as MasterRelation | undefined) ?? null;
    }
    return {
      id: i.id,
      position: i.position,
      songId: i.song_track_id,
      songOk: song?.type === 'song',
      masterId: i.master_track_id,
      masterRelation,
      isrc: master?.isrc ?? null,
    };
  });

  // Legal readiness of every distinct song (LABEL-29), never a percentage.
  const legal = new Map<string, LegalReadiness>();
  try {
    for (const id of songIds) {
      const song = await readReadinessSong(admin, org, id);
      if (!song || song.type !== 'song') continue;
      legal.set(id, evaluateLegalReadiness(await loadLegalFacts(admin, org, song)));
    }
  } catch (err) {
    if (err instanceof LegalReadinessNotReadyError) throw new ReleaseReadinessNotReadyError();
    throw err;
  }

  // Approvals and the snapshot of what each gate covers right now (LABEL-30).
  let rows;
  const approvals = {} as Record<Gate, ReadinessApproval>;
  try {
    rows = await listApprovals(admin, org, { kind: 'release', id: releaseId });
    for (const gate of GATES) {
      approvals[gate] = {
        current: currentDecision(rows.filter((r) => r.gate === gate)),
        now: await currentSnapshot(admin, org, { kind: 'release', id: releaseId }, gate, base),
      };
    }
  } catch (err) {
    if (err instanceof ApprovalsNotReadyError || err instanceof CreditsNotReadyError || err instanceof SplitsNotReadyError) throw new ReleaseReadinessNotReadyError();
    throw err;
  }

  return {
    release: {
      state: String(rel.state),
      title: rel.title,
      type: rel.type,
      primaryArtist: (artistRes.data as { name: string | null } | null)?.name ?? null,
      labelName: rel.label_name,
      pLine: rel.p_line,
      cLine: rel.c_line,
      primaryGenre: rel.primary_genre,
      targetDate: rel.target_date,
      releaseDate: rel.release_date,
      upc: rel.upc,
      artworkAssetId: base.artworkAssetId,
    },
    artwork,
    items,
    legal,
    approvals,
    settings,
  };
}
