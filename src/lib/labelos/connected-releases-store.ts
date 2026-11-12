/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * "Releases from connected artists" (LABEL-71): what the STORE OWNER can see
 * and veto of the music artist orgs have put on their store. The store owner
 * is the producer whose store `/store` is; the orgs here are the label orgs
 * they own, and the artist orgs actively connected to them (LABEL-41).
 *
 * Nothing here reads more than the public store already shows, and nothing
 * writes to the artist org: Unlist is a row in the LABEL org
 * (`store_listing_vetoes`), which the public routes read next to `store_listed`.
 * Rows are built field by field.
 */
import { isMissingSchema } from '@/lib/artists/workspace-load';
import { resolveStoreOwner } from '@/lib/store/owner';
import { pageAll, inChunks } from './paged-read';
import { refusalsAndVetoes } from './store-consent-store';
import { effectivePlayback, isPubliclyVisible, isStorePlayback, type StorePlayback } from './store-listing';

/** Is `userId` the owner of the store (and so entitled to this list)? */
export async function isStoreOwner(admin: any, userId: string): Promise<boolean> {
  const owner = await resolveStoreOwner(admin);
  return !!owner && owner.user_id.toLowerCase() === userId.toLowerCase();
}

export type ConnectedRelease = {
  releaseId: string;
  title: string;
  type: string;
  artist: string | null;
  artistOrg: string;
  releaseDate: string | null;
  listed: boolean;
  listedAt: string | null;
  playback: StorePlayback;
  vetoed: boolean;
  /** An artist credited on it said no. */
  refused: boolean;
  /** On the store right now: listed, out, not vetoed, not refused. */
  serving: boolean;
};

const LIMIT = 200;

/** Active connections of one label org: artist org ids and names. */
async function connectedArtistOrgs(admin: any, labelOrgId: string): Promise<{ id: string; name: string }[]> {
  const links = await pageAll<{ artist_org_id: string }>(
    (from, to) => admin.from('org_connections').select('artist_org_id').eq('label_org_id', labelOrgId).eq('status', 'active').order('artist_org_id', { ascending: true }).range(from, to),
    'connections',
  );
  const ids = [...new Set(links.map((l) => l.artist_org_id))];
  if (ids.length === 0) return [];
  const orgs = await inChunks<{ id: string; name: string }>(
    ids,
    (part, from, to) => admin.from('organizations').select('id, name').in('id', part).is('deleted_at', null).order('id', { ascending: true }).range(from, to),
    'organizations',
  );
  return orgs;
}

const COLUMNS = 'id, org_id, title, type, contact_id, release_date, state, imported_released, store_listed, store_listed_at, store_playback';
const COLUMNS_NO_PLAYBACK = COLUMNS.replace(', store_playback', '');

/** `releases` read with its playback column; before migration 158 the column is absent, so retry without it. */
async function selectReleases(admin: any, apply: (q: any) => any) {
  const first = await apply(admin.from('releases').select(COLUMNS));
  if (!first.error || !isMissingSchema(first.error)) return first;
  return apply(admin.from('releases').select(COLUMNS_NO_PLAYBACK));
}

export async function loadConnectedReleases(
  admin: any,
  labelOrgId: string,
  now: Date,
): Promise<{ releases: ConnectedRelease[]; schemaReady: boolean; truncated: boolean }> {
  const orgs = await connectedArtistOrgs(admin, labelOrgId);
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));
  const orgIds = orgs.map((o) => o.id);

  // The owner's own vetoes, every one (paged): each is a row they must be able to lift, connected or not any more.
  let schemaReady = true;
  let vetoIds: string[] = [];
  try {
    vetoIds = (
      await pageAll<{ release_id: string }>(
        (from, to) => admin.from('store_listing_vetoes').select('release_id').eq('org_id', labelOrgId).order('release_id', { ascending: true }).range(from, to),
        'vetoes',
      )
    ).map((r) => r.release_id);
  } catch (err) {
    const raw = (err as { raw?: unknown } | null)?.raw;
    if (!(raw && isMissingSchema(raw))) throw err;
    schemaReady = false;
  }

  const vetoedRows = await inChunks<any>(vetoIds, (part, from, to) => selectReleases(admin, (q) => q.in('id', part).order('id', { ascending: true }).range(from, to)), 'vetoed releases');
  const vetoedSet = new Set(vetoedRows.map((r: any) => r.id));
  const listedRows =
    orgIds.length === 0
      ? []
      : await inChunks<any>(
          orgIds,
          (part, from, to) =>
            selectReleases(admin, (q) => q.in('org_id', part).eq('store_listed', true).order('store_listed_at', { ascending: false }).order('id', { ascending: true }).range(from, to)),
          'listed releases',
        );
  // Vetoed first: those are the rows that need an act from the owner, and they must never fall off the end.
  const merged = [...vetoedRows, ...listedRows.filter((r: any) => !vetoedSet.has(r.id))];
  const all = merged.slice(0, LIMIT);
  if (all.length === 0) return { releases: [], schemaReady, truncated: false };

  const { refused, vetoed } = await refusalsAndVetoes(admin, all.map((r: any) => r.id));
  const contactIds = [...new Set(all.map((r: any) => r.contact_id as string))];
  const contacts = await inChunks<{ id: string; name: string | null }>(
    contactIds,
    (part, from, to) => admin.from('contacts').select('id, name').in('id', part).order('id', { ascending: true }).range(from, to),
    'artists',
  );
  const artistName = new Map(contacts.map((c) => [c.id, c.name]));

  return {
    schemaReady,
    truncated: merged.length > all.length,
    releases: all.map((r: any): ConnectedRelease => {
      const id = r.id.toLowerCase();
      const isVetoed = vetoedSet.has(r.id) || vetoed.has(id);
      const isRefused = refused.has(id);
      return {
        releaseId: r.id,
        title: r.title,
        type: r.type,
        artist: artistName.get(r.contact_id) ?? null,
        artistOrg: orgName.get(r.org_id) ?? 'Former connection',
        releaseDate: r.release_date,
        listed: r.store_listed === true,
        listedAt: r.store_listed_at ?? null,
        playback: effectivePlayback(isStorePlayback(r.store_playback) ? r.store_playback : 'preview', r, now),
        vetoed: isVetoed,
        refused: isRefused,
        serving: r.store_listed === true && isPubliclyVisible(r, now) && !isVetoed && !isRefused,
      };
    }),
  };
}

/**
 * The release row a veto concerns: one that belongs to an artist org actively connected to this label org — or,
 * for LIFTING a veto (`hasVeto`), one the label already vetoed even if the connection has ended since (otherwise
 * the veto could never be taken back, and would silently bite again on a reconnection).
 */
export async function connectedReleaseFor(
  admin: any,
  labelOrgId: string,
  releaseId: string,
  opts: { hasVeto?: boolean } = {},
): Promise<{ id: string; org_id: string; contact_id: string; project_id: string; store_listed: boolean } | null> {
  const { data, error } = await admin.from('releases').select('id, org_id, contact_id, project_id, store_listed').eq('id', releaseId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  if (opts.hasVeto) {
    const { data: veto, error: vetoErr } = await admin.from('store_listing_vetoes').select('release_id').eq('release_id', releaseId).eq('org_id', labelOrgId).maybeSingle();
    if (vetoErr) throw new Error(vetoErr.message);
    if (veto) return data as any;
  }
  const { data: link, error: linkErr } = await admin
    .from('org_connections')
    .select('id')
    .eq('label_org_id', labelOrgId)
    .eq('artist_org_id', (data as { org_id: string }).org_id)
    .eq('status', 'active')
    .maybeSingle();
  if (linkErr) throw new Error(linkErr.message);
  return link ? (data as any) : null;
}
