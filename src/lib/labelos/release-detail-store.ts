/**
 * The reads behind the release detail page (LABEL-33). One server-side load of
 * what the page draws: the release and its tracklist with song titles, the
 * gates (LABEL-32, as this member may read them), the artwork on offer, and
 * what this member may do. It writes nothing; every change goes through the
 * release routes the client calls.
 *
 * Titles come from the artist's workspace (`loadOrgArtistWorkspace`), which
 * already applies D4 and the member's scope: a song the member may not see is
 * listed as "restricted", never named (07 §3.4). The songs on offer to add are
 * the same list minus the ones already on the release.
 */
import type { ObjectAccessResult } from '@/lib/auth/org-access';
import { requireObjectAccess } from '@/lib/auth/org-access';
import { isMissingSchema } from '@/lib/artists/workspace-load';
import { canReadOrgAsset } from './org-assets';
import { loadOrgArtistWorkspace } from './org-workspace-store';
import { skippedGates } from './org-settings';
import { evaluateReleaseReadiness, releaseReadinessView, type ReleaseReadinessView } from './release-readiness';
import { loadReleaseReadinessFacts, ReleaseReadinessNotReadyError } from './release-readiness-store';
import { RELEASE_COLUMNS, RELEASE_ITEM_COLUMNS, toReleaseView, type ReleaseItemRow, type ReleaseRow, type ReleaseView } from './releases';

type Access = Extract<ObjectAccessResult, { ok: true }>;

export type DetailItem = {
  id: string;
  position: number;
  songId: string;
  /** Null: a song the member may not see (restricted), or one outside the artist's workspace. */
  title: string | null;
  masterId: string;
  /** The song's own mix goes out (no separate master). */
  ownMaster: boolean;
  versionTitle: string | null;
  explicit: boolean;
};

export type ArtworkOption = { id: string; label: string; fileName: string; mime: string | null };

export type ReleaseDetail = {
  release: ReleaseView;
  artist: { id: string; name: string } | null;
  items: DetailItem[];
  /** Songs of the artist the member may add, not already on the release. */
  candidates: { id: string; title: string }[];
  /** Null before migrations 153 / 155 / 157 or when the gates could not be worked out. */
  readiness: ReleaseReadinessView | null;
  /** Approval gates the owner switched off (LABEL-51); shown as a banner on this release. */
  gatesSkipped: ('legal' | 'marketing')[];
  artwork: { current: ArtworkOption | null; options: ArtworkOption[] };
  me: { canWrite: boolean; isOwner: boolean; /** owner or admin: the public-facing side of a release (LABEL-42) */ canManagePublic: boolean; mayReadRights: boolean };
};

/** `access` is requireObjectAccess on `releases` (`catalog.read`). Null when the release is not there. */
export async function loadReleaseDetail(access: Access): Promise<ReleaseDetail | null> {
  const { admin } = access;
  const org = access.object.orgId;
  const id = access.object.id;

  const relRes = await admin.from('releases').select(RELEASE_COLUMNS).eq('id', id).eq('org_id', org).maybeSingle();
  if (relRes.error) {
    if (isMissingSchema(relRes.error)) return null;
    throw new Error(`release read: ${relRes.error.message}`);
  }
  const row = relRes.data as unknown as ReleaseRow | null;
  if (!row) return null;

  const itemRes = await admin.from('release_items').select(RELEASE_ITEM_COLUMNS).eq('release_id', id).eq('org_id', org).order('position', { ascending: true });
  if (itemRes.error) throw new Error(`release items read: ${itemRes.error.message}`);
  const itemRows = ((itemRes.data ?? []) as unknown as ReleaseItemRow[]).sort((a, b) => a.position - b.position);

  // Songs the member may name: the artist's workspace, through the member's own access to the artist.
  const artistAccess = await requireObjectAccess({ table: 'contacts', id: row.contact_id, cap: 'catalog.read', orgId: org });
  const workspace = artistAccess.ok ? await loadOrgArtistWorkspace(artistAccess) : null;
  const titles = new Map((workspace?.songs ?? []).map((s) => [s.id.toLowerCase(), s.title?.trim() || 'Untitled']));
  const onRelease = new Set(itemRows.map((i) => i.song_track_id.toLowerCase()));

  const items: DetailItem[] = itemRows.map((i) => ({
    id: i.id,
    position: i.position,
    songId: i.song_track_id,
    title: titles.get(i.song_track_id.toLowerCase()) ?? null,
    masterId: i.master_track_id,
    ownMaster: i.master_track_id.toLowerCase() === i.song_track_id.toLowerCase(),
    versionTitle: i.version_title,
    explicit: i.explicit,
  }));
  const candidates = (workspace?.songs ?? [])
    .filter((s) => !onRelease.has(s.id.toLowerCase()))
    .map((s) => ({ id: s.id, title: s.title?.trim() || 'Untitled' }))
    .sort((a, b) => a.title.localeCompare(b.title));

  // Gates, as this member may read them.
  let readiness: ReleaseReadinessView | null = null;
  let gatesSkipped: ('legal' | 'marketing')[] = [];
  try {
    const facts = await loadReleaseReadinessFacts(admin, org, id);
    if (facts) gatesSkipped = skippedGates(facts.settings);
    if (facts) readiness = releaseReadinessView(evaluateReleaseReadiness(facts), access.capabilities.has('rights.read'));
  } catch (err) {
    if (!(err instanceof ReleaseReadinessNotReadyError)) throw err;
  }

  // Artwork the release may use: visual files of its own project the member may open.
  const assetRes = await admin
    .from('project_assets')
    .select('id, kind, sensitivity, label, file_name, mime')
    .eq('org_id', org)
    .eq('project_id', row.project_id)
    .in('kind', ['artwork', 'photo']);
  if (assetRes.error && !isMissingSchema(assetRes.error)) throw new Error(`artwork read: ${assetRes.error.message}`);
  const options = ((assetRes.data ?? []) as { id: string; kind: string; sensitivity: string; label: string | null; file_name: string | null; mime: string | null }[])
    .filter((a) => canReadOrgAsset(access.capabilities, { kind: a.kind, sensitivity: a.sensitivity as 'normal' | 'restricted' }))
    .map((a): ArtworkOption => ({ id: a.id, label: a.label || a.file_name || 'Artwork', fileName: a.file_name ?? '', mime: a.mime }));
  const current = row.artwork_asset_id ? options.find((o) => o.id === row.artwork_asset_id) ?? null : null;

  return {
    release: toReleaseView(row),
    artist: workspace ? { id: workspace.contact.id, name: workspace.contact.name } : null,
    items,
    candidates,
    readiness,
    gatesSkipped,
    artwork: { current, options },
    me: {
      canWrite: access.capabilities.has('release.write'),
      isOwner: access.role === 'owner', canManagePublic: access.role === 'owner' || access.role === 'admin',
      mayReadRights: access.capabilities.has('rights.read'),
    },
  };
}
