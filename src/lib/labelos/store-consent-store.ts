/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Server reads and writes for artist consent on store listing (LABEL-71).
 * The rules are the pure `store-consent`; this module loads the rows they
 * judge, with the service role, by id and org — the routes above it decide
 * who may ask.
 *
 * MIGRATION 186 MISSING. Every read treats a missing table as "no rows" and
 * says so (`schemaReady: false`), so the store behaves exactly as it did
 * before LABEL-71. Every WRITE probes with a read first and answers 503
 * naming 186 (PostgREST answers an INSERT into a missing table with an
 * empty 404). Any OTHER error is thrown: the public store fails closed on a
 * consent table it cannot read, it never reads "unreadable" as "no".
 */
import { isMissingSchema } from '@/lib/artists/workspace-load';
import { inChunks } from './paged-read';
import { hasArtistRole } from './roster';
import {
  cleanIds,
  creditedArtistContactIds,
  isConsentState,
  ownerLinks,
  partyLinks,
  scopeLinks,
  type AccountLink,
  type ConsentRow,
  type ConsentState,
  type CreditFact,
} from './store-consent';

export const MIGRATION_186 = '186';
export const NEEDS_186 = 'Artist consent on store listing needs migration 186 applied on Supabase.';

export type ConsentRowFull = ConsentRow & {
  id: string;
  release_id: string;
  proposed_by: string | null;
  proposed_at: string;
  decided_by: string | null;
  decided_at: string | null;
};

const CONSENT_COLUMNS = 'id, release_id, artist_contact_id, state, proposed_by, proposed_at, decided_by, decided_at';

function toRow(r: any): ConsentRowFull | null {
  if (!r || typeof r.artist_contact_id !== 'string' || !isConsentState(r.state)) return null;
  return { ...r, artist_contact_id: r.artist_contact_id.toLowerCase() } as ConsentRowFull;
}

/** Every consent row of one release. `schemaReady` false = migration 186 is not applied (no rows). */
export async function readConsents(admin: any, releaseId: string): Promise<{ rows: ConsentRowFull[]; schemaReady: boolean }> {
  const { data, error } = await admin.from('listing_consents').select(CONSENT_COLUMNS).eq('release_id', releaseId).order('artist_contact_id', { ascending: true });
  if (error) {
    if (isMissingSchema(error)) return { rows: [], schemaReady: false };
    throw new Error(error.message);
  }
  return { rows: ((data ?? []) as any[]).map(toRow).filter((r): r is ConsentRowFull => r !== null), schemaReady: true };
}

/** The store owner's veto on a release (`store_listing_vetoes`). */
export async function readVeto(admin: any, releaseId: string): Promise<{ vetoed: boolean; schemaReady: boolean }> {
  const { data, error } = await admin.from('store_listing_vetoes').select('release_id').eq('release_id', releaseId).maybeSingle();
  if (error) {
    if (isMissingSchema(error)) return { vetoed: false, schemaReady: false };
    throw new Error(error.message);
  }
  return { vetoed: !!data, schemaReady: true };
}

/**
 * Per release: has a credited artist said no (`refused`), has the store owner
 * vetoed it (`vetoed`). The two reads are independent and run together; both
 * are chunked and paged, and a failed read throws. Before migration 186 there
 * is nothing to consult: both sets come back empty.
 */
export async function refusalsAndVetoes(admin: any, releaseIds: readonly string[]): Promise<{ refused: Set<string>; vetoed: Set<string> }> {
  const ids = cleanIds(releaseIds);
  const refused = new Set<string>();
  const vetoed = new Set<string>();
  if (ids.length === 0) return { refused, vetoed };
  try {
    const [no, veto] = await Promise.all([
      inChunks<{ release_id: string }>(
        ids,
        (part, from, to) => admin.from('listing_consents').select('release_id').in('release_id', part).eq('state', 'no').order('release_id', { ascending: true }).order('artist_contact_id', { ascending: true }).range(from, to),
        'consent read',
      ),
      inChunks<{ release_id: string }>(
        ids,
        (part, from, to) => admin.from('store_listing_vetoes').select('release_id').in('release_id', part).order('release_id', { ascending: true }).range(from, to),
        'veto read',
      ),
    ]);
    for (const r of no) refused.add(r.release_id.toLowerCase());
    for (const r of veto) vetoed.add(r.release_id.toLowerCase());
  } catch (err) {
    const raw = (err as { raw?: unknown } | null)?.raw;
    // Before 186 there is nothing to consult: the store behaves as it did.
    if (raw && isMissingSchema(raw)) return { refused: new Set(), vetoed: new Set() };
    throw err;
  }
  return { refused, vetoed };
}

/**
 * Which of these releases must the public store NOT serve for consent's sake:
 * a `no` from any credited artist, or the store owner's veto. Read on every
 * public request (release detail, each audio Range, the list), never cached;
 * a failed read throws, so the store fails closed.
 */
export async function blockedByConsent(admin: any, releaseIds: readonly string[]): Promise<Set<string>> {
  const { refused, vetoed } = await refusalsAndVetoes(admin, releaseIds);
  return new Set([...refused, ...vetoed]);
}

/* ── Who is credited, who they are ───────────────────────────────────── */

type ReleaseRef = { id: string; org_id: string; contact_id: string };

/**
 * The credited artists of a release: its artist plus the roster artists behind
 * CONFIRMED credits on the songs of its tracklist (`creditedArtistContactIds`).
 * Credits come from `track_collaborators` (153: `contact_id`, or `party_id`
 * whose party links a contact); only contacts of the release's own org that
 * hold an artist role count — a credit naming a producer or an engineer asks
 * nobody.
 */
export async function loadCreditedArtists(admin: any, release: ReleaseRef): Promise<string[]> {
  const items = await inChunks<{ song_track_id: string }>(
    [release.id],
    (part, from, to) => admin.from('release_items').select('song_track_id').in('release_id', part).order('position', { ascending: true }).order('id', { ascending: true }).range(from, to),
    'release items',
  );
  const songIds = [...new Set(items.map((i) => i.song_track_id))];
  let credits: { contact_id: string | null; party_id: string | null; status: string }[] = [];
  if (songIds.length > 0) {
    credits = await inChunks(
      songIds,
      (part, from, to) =>
        admin.from('track_collaborators').select('id, contact_id, party_id, status').in('track_id', part).eq('org_id', release.org_id).eq('status', 'confirmed').order('id', { ascending: true }).range(from, to),
      'credits',
    );
  }
  const partyIds = [...new Set(credits.map((c) => c.party_id).filter((p): p is string => !!p))];
  const partyContact = new Map<string, string | null>();
  if (partyIds.length > 0) {
    const parties = await inChunks<{ id: string; contact_id: string | null }>(
      partyIds,
      (part, from, to) => admin.from('parties').select('id, contact_id').in('id', part).eq('org_id', release.org_id).order('id', { ascending: true }).range(from, to),
      'parties',
    );
    for (const p of parties) partyContact.set(p.id, p.contact_id);
  }
  const facts: CreditFact[] = credits.map((c) => ({ contact_id: c.contact_id, party_contact_id: c.party_id ? partyContact.get(c.party_id) ?? null : null, status: c.status }));

  const candidates = [...new Set(facts.flatMap((f) => [f.contact_id, f.party_contact_id]).filter((c): c is string => !!c))];
  const roster = new Set<string>();
  if (candidates.length > 0) {
    const contacts = await inChunks<{ id: string; category: string | null; secondary_category: string | null }>(
      candidates,
      (part, from, to) => admin.from('contacts').select('id, category, secondary_category').in('id', part).eq('org_id', release.org_id).order('id', { ascending: true }).range(from, to),
      'contacts',
    );
    for (const c of contacts) if (hasArtistRole(c)) roster.add(c.id.toLowerCase());
  }
  return creditedArtistContactIds({ releaseContactId: release.contact_id, credits: facts, rosterContactIds: roster });
}

/**
 * The accounts that stand for these artist contacts in the org: members whose
 * role is `artist` scoped to the contact (`member_artist_scopes`), and the
 * account of a party linked to the contact while it is a member of the org.
 * Nobody else — in particular not the label staff scoped to the same artist,
 * and never an address read off a contact card.
 */
export async function loadAccountLinks(admin: any, orgId: string, contactIds: readonly string[]): Promise<AccountLink[]> {
  const ids = cleanIds(contactIds);
  if (ids.length === 0) return [];
  const scopes = await inChunks<{ user_id: string; contact_id: string }>(
    ids,
    (part, from, to) => admin.from('member_artist_scopes').select('user_id, contact_id').eq('org_id', orgId).in('contact_id', part).order('user_id', { ascending: true }).order('contact_id', { ascending: true }).range(from, to),
    'artist scopes',
  );
  const parties = await inChunks<{ id: string; contact_id: string | null; user_id: string | null }>(
    ids,
    (part, from, to) => admin.from('parties').select('id, contact_id, user_id').eq('org_id', orgId).in('contact_id', part).not('user_id', 'is', null).order('id', { ascending: true }).range(from, to),
    'party accounts',
  );
  const userIds = [...new Set([...scopes.map((s) => s.user_id), ...parties.map((p) => p.user_id).filter((u): u is string => !!u)])];
  const owners = await artistOrgOwners(admin, orgId);
  if (userIds.length === 0) return ownerLinks(owners.kind, owners.userIds, ids);
  const members = await inChunks<{ user_id: string; role: string }>(
    userIds,
    (part, from, to) => admin.from('org_members').select('user_id, role').eq('org_id', orgId).in('user_id', part).order('user_id', { ascending: true }).range(from, to),
    'members',
  );
  const roleOf = new Map(members.map((m) => [m.user_id.toLowerCase(), m.role]));
  const byUser = new Map<string, string[]>();
  for (const s of scopes) byUser.set(s.user_id.toLowerCase(), [...(byUser.get(s.user_id.toLowerCase()) ?? []), s.contact_id]);
  const fromScopes = scopeLinks([...byUser].filter(([u]) => roleOf.has(u)).map(([user_id, contact_ids]) => ({ user_id, role: roleOf.get(user_id) as string, contact_ids })));
  const fromParties = partyLinks(parties, new Set(roleOf.keys()));
  return [...fromScopes, ...fromParties, ...ownerLinks(owners.kind, owners.userIds, ids)];
}

/** The owners of an ARTIST org (who stand for its one roster artist, D1); other kinds answer `kind` and no owners. */
async function artistOrgOwners(admin: any, orgId: string): Promise<{ kind: string; userIds: string[] }> {
  const { data: org, error } = await admin.from('organizations').select('kind').eq('id', orgId).maybeSingle();
  if (error) throw new Error(error.message);
  const kind = (org as { kind?: string } | null)?.kind ?? '';
  if (kind !== 'artist') return { kind, userIds: [] };
  const owners = await inChunks<{ user_id: string }>(
    [orgId],
    (part, from, to) => admin.from('org_members').select('user_id').in('org_id', part).eq('role', 'owner').order('user_id', { ascending: true }).range(from, to),
    'owners',
  );
  return { kind, userIds: owners.map((o) => o.user_id) };
}

/** The contacts of this org a user answers for, among `contactIds` (or every contact they stand for when omitted). */
export async function answerableFor(admin: any, orgId: string, userId: string): Promise<string[]> {
  const [scopes, parties] = await Promise.all([
    inChunks<{ contact_id: string }>(
      [userId],
      (part, from, to) => admin.from('member_artist_scopes').select('contact_id').eq('org_id', orgId).in('user_id', part).order('contact_id', { ascending: true }).range(from, to),
      'artist scopes',
    ),
    inChunks<{ contact_id: string | null }>(
      [userId],
      (part, from, to) => admin.from('parties').select('contact_id').eq('org_id', orgId).in('user_id', part).not('contact_id', 'is', null).order('id', { ascending: true }).range(from, to),
      'party accounts',
    ),
  ]);
  const { data: member, error } = await admin.from('org_members').select('role').eq('org_id', orgId).eq('user_id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!member) return [];
  const fromScopes = (member as { role: string }).role === 'artist' ? scopes.map((s) => s.contact_id) : [];
  let fromOwner: string[] = [];
  if ((member as { role: string }).role === 'owner') {
    const { kind } = await artistOrgOwners(admin, orgId);
    if (kind === 'artist') {
      const contacts = await inChunks<{ id: string; category: string | null; secondary_category: string | null }>(
        [orgId],
        (part, from, to) => admin.from('contacts').select('id, category, secondary_category').in('org_id', part).order('id', { ascending: true }).range(from, to),
        'contacts',
      );
      fromOwner = contacts.filter((c) => hasArtistRole(c)).map((c) => c.id);
    }
  }
  return cleanIds([...fromScopes, ...fromOwner, ...parties.map((p) => p.contact_id).filter((c): c is string => !!c)]);
}

/* ── Writes ──────────────────────────────────────────────────────────── */

/** Insert `proposed` rows for the artists not yet asked. Idempotent: an existing (release, artist) row is left alone. */
export async function insertProposals(admin: any, release: ReleaseRef, contactIds: readonly string[], proposedBy: string | null): Promise<{ error: { message: string } | null }> {
  const ids = cleanIds(contactIds);
  if (ids.length === 0) return { error: null };
  const { error } = await admin
    .from('listing_consents')
    .upsert(
      ids.map((artist_contact_id) => ({ org_id: release.org_id, release_id: release.id, artist_contact_id, state: 'proposed', proposed_by: proposedBy })),
      { onConflict: 'release_id,artist_contact_id', ignoreDuplicates: true },
    );
  return { error: error ?? null };
}

/**
 * Move one row to `to` from `from` — compare-and-set on the state read, so
 * two answers cannot both win. Returns whether this call changed it.
 */
export async function setConsent(
  admin: any,
  row: { release_id: string; artist_contact_id: string },
  from: ConsentState,
  to: 'yes' | 'no',
  decidedBy: string,
  now: Date,
): Promise<{ changed: boolean; error: { message: string } | null }> {
  const { data, error } = await admin
    .from('listing_consents')
    .update({ state: to, decided_by: decidedBy, decided_at: now.toISOString() })
    .eq('release_id', row.release_id)
    .eq('artist_contact_id', row.artist_contact_id)
    .eq('state', from)
    .select('id')
    .maybeSingle();
  return { changed: !!data, error: error ?? null };
}

/**
 * Put a consent row back exactly as it was, after the event that was to
 * record the change could not be written (the put-back pattern, in the
 * direction that matters: a `yes` that is not on record must not stand).
 * The database refuses to move an answered row back to "asked", so a row
 * that was only asked is deleted and written again as it was.
 */
export async function restoreConsent(admin: any, orgId: string, before: ConsentRowFull): Promise<{ error: { message: string } | null }> {
  if (before.state !== 'proposed') {
    const { error } = await admin
      .from('listing_consents')
      .update({ state: before.state, decided_by: before.decided_by, decided_at: before.decided_at })
      .eq('release_id', before.release_id)
      .eq('artist_contact_id', before.artist_contact_id);
    return { error: error ?? null };
  }
  const del = await admin.from('listing_consents').delete().eq('release_id', before.release_id).eq('artist_contact_id', before.artist_contact_id);
  if (del.error) return { error: del.error };
  const { error } = await admin.from('listing_consents').insert({
    org_id: orgId,
    release_id: before.release_id,
    artist_contact_id: before.artist_contact_id,
    state: 'proposed',
    proposed_by: before.proposed_by,
    proposed_at: before.proposed_at,
  });
  return { error: error ?? null };
}

/**
 * Take a release off the store because an artist said no (or the store owner
 * vetoed): `store_listed` false, playback back to `preview`. Conditional on
 * the release still being listed, so a repeat changes nothing. Previews that
 * were promoted to the public bucket are NOT touched here — the unlist plan
 * (`planUnlist`) decides that, and music that was publicly out keeps them.
 */
export async function takeOffStore(admin: any, orgId: string, releaseId: string, playbackColumn: boolean): Promise<{ changed: boolean; error: { message: string } | null }> {
  const { data, error } = await admin
    .from('releases')
    .update({ store_listed: false, store_listed_at: null, ...(playbackColumn ? { store_playback: 'preview' } : {}) })
    .eq('id', releaseId)
    .eq('org_id', orgId)
    .eq('store_listed', true)
    .select('id')
    .maybeSingle();
  return { changed: !!data, error: error ?? null };
}

/**
 * The LISTED releases an artist account is credited on, whether or not they were ever asked (a release listed
 * before migration 186, or a credit confirmed after the listing, has no consent row — the artist still has the
 * last word on it). The release's own artist, plus confirmed credits on the songs of its tracklist, directly or
 * through a party linked to the contact. Chunked and paged; releases only of this org.
 */
export async function loadListedReleasesOfArtist(admin: any, orgId: string, contactIds: readonly string[]): Promise<string[]> {
  const ids = cleanIds(contactIds);
  if (ids.length === 0) return [];
  const own = await inChunks<{ id: string }>(
    ids,
    (part, from, to) => admin.from('releases').select('id').eq('org_id', orgId).eq('store_listed', true).in('contact_id', part).order('id', { ascending: true }).range(from, to),
    'releases of the artist',
  );
  const parties = await inChunks<{ id: string }>(
    ids,
    (part, from, to) => admin.from('parties').select('id').eq('org_id', orgId).in('contact_id', part).order('id', { ascending: true }).range(from, to),
    'parties of the artist',
  );
  const direct = await inChunks<{ id: string; track_id: string }>(
    ids,
    (part, from, to) => admin.from('track_collaborators').select('id, track_id').eq('org_id', orgId).eq('status', 'confirmed').in('contact_id', part).order('id', { ascending: true }).range(from, to),
    'credits of the artist',
  );
  const viaParty = await inChunks<{ id: string; track_id: string }>(
    parties.map((p) => p.id),
    (part, from, to) => admin.from('track_collaborators').select('id, track_id').eq('org_id', orgId).eq('status', 'confirmed').in('party_id', part).order('id', { ascending: true }).range(from, to),
    'credits through parties',
  );
  const songs = [...new Set([...direct, ...viaParty].map((c) => c.track_id))];
  const items = await inChunks<{ id: string; release_id: string }>(
    songs,
    (part, from, to) => admin.from('release_items').select('id, release_id').eq('org_id', orgId).in('song_track_id', part).order('id', { ascending: true }).range(from, to),
    'release items of the credits',
  );
  const credited = [...new Set(items.map((i) => i.release_id))];
  const viaCredits = await inChunks<{ id: string }>(
    credited,
    (part, from, to) => admin.from('releases').select('id').eq('org_id', orgId).eq('store_listed', true).in('id', part).order('id', { ascending: true }).range(from, to),
    'listed releases of the credits',
  );
  return [...new Set([...own, ...viaCredits].map((r) => r.id.toLowerCase()))];
}
