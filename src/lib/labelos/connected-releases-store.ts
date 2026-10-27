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
import { blockedByConsent } from './store-consent-store';
import { isStorePlayback, isReleasedForStore, type StorePlayback } from './store-listing';

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

export async function loadConnectedReleases(admin: any, labelOrgId: string, now: Date): Promise<{ releases: ConnectedRelease[]; schemaReady: boolean }> {
  const orgs = await connectedArtistOrgs(admin, labelOrgId);
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));
  const orgIds = orgs.map((o) => o.id);

  let schemaReady = true;
  let vetoIds: string[] = [];
  {
    const { data, error } = await admin.from('store_listing_vetoes').select('release_id').eq('org_id', labelOrgId).limit(1000);
    if (error) {
      if (!isMissingSchema(error)) throw new Error(error.message);
      schemaReady = false;
    } else {
      vetoIds = ((data ?? []) as { release_id: string }[]).map((r) => r.release_id);
    }
  }
  if (orgIds.length === 0) return { releases: [], schemaReady };

  const COLUMNS = 'id, org_id, title, type, contact_id, release_date, state, imported_released, store_listed, store_listed_at, store_playback';
  const COLUMNS_NO_PLAYBACK = COLUMNS.replace(', store_playback', '');
  const listed = await inChunks<any>(
    orgIds,
    async (part, from, to) => {
      const first = await admin.from('releases').select(COLUMNS).in('org_id', part).eq('store_listed', true).order('store_listed_at', { ascending: false }).order('id', { ascending: true }).range(from, to);
      if (!first.error || !isMissingSchema(first.error)) return first;
      return admin.from('releases').select(COLUMNS_NO_PLAYBACK).in('org_id', part).eq('store_listed', true).order('store_listed_at', { ascending: false }).order('id', { ascending: true }).range(from, to);
    },
    'listed releases',
  );
  const have = new Set(listed.map((r: any) => r.id));
  const vetoedOnly = await inChunks<any>(
    vetoIds.filter((id) => !have.has(id)),
    async (part, from, to) => {
      const first = await admin.from('releases').select(COLUMNS).in('id', part).in('org_id', orgIds).order('id', { ascending: true }).range(from, to);
      if (!first.error || !isMissingSchema(first.error)) return first;
      return admin.from('releases').select(COLUMNS_NO_PLAYBACK).in('id', part).in('org_id', orgIds).order('id', { ascending: true }).range(from, to);
    },
    'vetoed releases',
  );
  const all = [...listed, ...vetoedOnly].slice(0, LIMIT);
  if (all.length === 0) return { releases: [], schemaReady };

  const blocked = await blockedByConsent(admin, all.map((r: any) => r.id));
  const vetoed = new Set(vetoIds.map((v) => v.toLowerCase()));
  const contactIds = [...new Set(all.map((r: any) => r.contact_id as string))];
  const contacts = await inChunks<{ id: string; name: string | null }>(
    contactIds,
    (part, from, to) => admin.from('contacts').select('id, name').in('id', part).order('id', { ascending: true }).range(from, to),
    'artists',
  );
  const artistName = new Map(contacts.map((c) => [c.id, c.name]));

  // Refusal is read separately from the veto so the page can say which of the two took it off.
  const refusedIds = await refused(admin, all.map((r: any) => r.id));

  return {
    schemaReady,
    releases: all.map((r: any): ConnectedRelease => {
      const isVetoed = vetoed.has(r.id.toLowerCase());
      const isRefused = refusedIds.has(r.id.toLowerCase());
      const out = isReleasedForStore(r, now);
      return {
        releaseId: r.id,
        title: r.title,
        type: r.type,
        artist: artistName.get(r.contact_id) ?? null,
        artistOrg: orgName.get(r.org_id) ?? 'Artist',
        releaseDate: r.release_date,
        listed: r.store_listed === true,
        listedAt: r.store_listed_at ?? null,
        playback: isStorePlayback(r.store_playback) ? r.store_playback : 'preview',
        vetoed: isVetoed,
        refused: isRefused,
        serving: r.store_listed === true && out && !blocked.has(r.id.toLowerCase()),
      };
    }),
  };
}

async function refused(admin: any, releaseIds: readonly string[]): Promise<Set<string>> {
  const out = new Set<string>();
  try {
    const rows = await inChunks<{ release_id: string }>(
      [...releaseIds],
      (part, from, to) => admin.from('listing_consents').select('release_id').in('release_id', part).eq('state', 'no').order('release_id', { ascending: true }).order('artist_contact_id', { ascending: true }).range(from, to),
      'consent read',
    );
    for (const r of rows) out.add(r.release_id.toLowerCase());
  } catch (err) {
    const raw = (err as { raw?: unknown } | null)?.raw;
    if (!(raw && isMissingSchema(raw))) throw err;
  }
  return out;
}

/** The release row a veto concerns, only if it belongs to an artist org actively connected to this label org. */
export async function connectedReleaseFor(admin: any, labelOrgId: string, releaseId: string): Promise<{ id: string; org_id: string; contact_id: string; project_id: string; store_listed: boolean } | null> {
  const { data, error } = await admin.from('releases').select('id, org_id, contact_id, project_id, store_listed').eq('id', releaseId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
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
