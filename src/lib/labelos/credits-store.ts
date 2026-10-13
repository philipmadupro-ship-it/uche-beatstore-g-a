/**
 * The reads and writes behind the party and credit routes (LABEL-27). The
 * rules are `credits.ts` / `parties.ts`; this file only touches the database.
 * Service-role client, org filter on every query: authorisation is the
 * route's (`requireTrackActor`, `requireOrgCapability`), and rows go out only
 * through `creditView` / `partyView`.
 *
 * Migration 153 may not be applied: a missing table or column is
 * `CreditsNotReadyError`, which the routes answer as "not set up yet" (GET:
 * `schemaReady: false`; writes: 503), never a raw 500.
 */
import type { AdminClient } from '@/lib/auth/ownership';
import { isUUID } from '@/lib/validate';
import type { EventSubject } from './activity';
import type { CreditRow, PartyRow } from './credits';
import { memberIdentities, type IdentityAdmin } from './member-identity';
import { ownPartyName, PARTY_COLUMNS, type PartyColumns } from './parties';
import { orgProjectIdsInScope, type OrgContext } from '@/lib/auth/org-access';
import { songEventSubject } from './song-stage-store';

export const CREDIT_COLUMNS =
  'id, track_id, name, role, source, scope, status, role_detail, party_id, contact_id, created_by, confirmed_by, confirmed_at, dispute_note, created_at';

export class CreditsNotReadyError extends Error {
  constructor() {
    super('migration 153 is not applied');
  }
}

type DbError = { message: string; code?: string } | null | undefined;

/** PostgREST's answers for a missing table / column / function. */
export function isMissingCreditsSchema(error: DbError): boolean {
  if (!error) return false;
  return ['PGRST205', '42P01', '42703', 'PGRST204', 'PGRST202', '42883'].includes(error.code ?? '');
}

export const isUniqueViolation = (error: DbError): boolean => error?.code === '23505';

function check(what: string, error: DbError): void {
  if (!error) return;
  if (isMissingCreditsSchema(error)) throw new CreditsNotReadyError();
  throw new Error(`${what}: ${error.message}`);
}

// ── Credits ─────────────────────────────────────────────────────────────

/** Every credit of an org track, oldest first. */
export async function listCredits(admin: AdminClient, org: string, trackId: string): Promise<CreditRow[]> {
  const res = await admin.from('track_collaborators').select(CREDIT_COLUMNS).eq('org_id', org).eq('track_id', trackId).order('created_at', { ascending: true });
  check('credit list', res.error);
  return (res.data ?? []) as unknown as CreditRow[];
}

export async function readCredit(admin: AdminClient, org: string, trackId: string, creditId: string): Promise<CreditRow | null> {
  if (!isUUID(creditId)) return null;
  const res = await admin.from('track_collaborators').select(CREDIT_COLUMNS).eq('org_id', org).eq('track_id', trackId).eq('id', creditId).maybeSingle();
  check('credit read', res.error);
  return (res.data as unknown as CreditRow | null) ?? null;
}

export type NewCredit = {
  org: string;
  trackId: string;
  name: string;
  role: string;
  scope: string;
  roleDetail: string | null;
  partyId: string | null;
  contactId: string | null;
  createdBy: string;
};

/** Insert a PROPOSED credit. `duplicate` = the same name and role is already credited on the track. */
export async function insertCredit(admin: AdminClient, c: NewCredit): Promise<{ credit: CreditRow } | { duplicate: true }> {
  const res = await admin
    .from('track_collaborators')
    .insert({
      track_id: c.trackId,
      org_id: c.org,
      name: c.name,
      role: c.role,
      source: 'manual',
      scope: c.scope,
      status: 'proposed',
      role_detail: c.roleDetail,
      party_id: c.partyId,
      contact_id: c.contactId,
      created_by: c.createdBy,
    })
    .select(CREDIT_COLUMNS)
    .single();
  if (isUniqueViolation(res.error)) return { duplicate: true };
  check('credit insert', res.error);
  return { credit: res.data as unknown as CreditRow };
}

/** The song's context keys, for the event's filing; the subject itself is the credit. */
export async function creditEventSubject(admin: AdminClient, org: string, trackId: string, creditId: string | null): Promise<EventSubject> {
  const song = await songEventSubject(admin, org, trackId);
  return { ...song, type: 'credit', id: creditId };
}

// ── Parties ─────────────────────────────────────────────────────────────

export async function readParty(admin: AdminClient, org: string, partyId: string): Promise<PartyRow | null> {
  if (!isUUID(partyId)) return null;
  const res = await admin.from('parties').select(PARTY_COLUMNS).eq('org_id', org).eq('id', partyId).maybeSingle();
  check('party read', res.error);
  return (res.data as unknown as PartyRow | null) ?? null;
}

export async function partiesByIds(admin: AdminClient, org: string, ids: readonly (string | null)[]): Promise<Map<string, PartyRow>> {
  const unique = [...new Set(ids.filter((i): i is string => !!i && isUUID(i)))];
  const out = new Map<string, PartyRow>();
  if (unique.length === 0) return out;
  const res = await admin.from('parties').select(PARTY_COLUMNS).eq('org_id', org).in('id', unique);
  check('party read', res.error);
  for (const p of (res.data ?? []) as unknown as PartyRow[]) out.set(p.id, p);
  return out;
}

export async function ownPartyRow(admin: AdminClient, org: string, userId: string): Promise<PartyRow | null> {
  const res = await admin.from('parties').select(PARTY_COLUMNS).eq('org_id', org).eq('user_id', userId).maybeSingle();
  check('own party read', res.error);
  return (res.data as unknown as PartyRow | null) ?? null;
}

/** The name a member's own party will carry on first use: their profile name, else their email's local part. */
export async function ownDisplayName(admin: AdminClient, org: string, userId: string): Promise<string> {
  const ids = await memberIdentities(admin as unknown as IdentityAdmin, org, [userId], { withEmail: true });
  return ownPartyName(ids.get(userId) ?? { name: null, email: null });
}

/**
 * The caller's own party, made on first use (kind `person`, linked to their
 * account). A concurrent first use loses the unique index (org, user) and
 * reads the winner.
 */
export async function ensureOwnParty(admin: AdminClient, org: string, userId: string): Promise<PartyRow> {
  const existing = await ownPartyRow(admin, org, userId);
  if (existing) return existing;
  const res = await admin
    .from('parties')
    .insert({ org_id: org, kind: 'person', display_name: await ownDisplayName(admin, org, userId), user_id: userId, created_by: userId })
    .select(PARTY_COLUMNS)
    .single();
  if (isUniqueViolation(res.error)) {
    const winner = await ownPartyRow(admin, org, userId);
    if (winner) return winner;
  }
  check('own party insert', res.error);
  return res.data as unknown as PartyRow;
}

/** Every party of the org, by name. */
export async function listParties(admin: AdminClient, org: string): Promise<PartyRow[]> {
  const res = await admin.from('parties').select(PARTY_COLUMNS).eq('org_id', org).order('display_name', { ascending: true });
  check('party list', res.error);
  return (res.data ?? []) as unknown as PartyRow[];
}

/**
 * The party ids a member limited to some artists may see (06 §3): those
 * credited on a song of a project their scope reaches — the TS twin of 153's
 * `labelos_scoped_parties()`.
 */
export async function scopedPartyIds(admin: AdminClient, ctx: OrgContext): Promise<string[]> {
  const projectIds = await orgProjectIdsInScope(admin, ctx);
  if (projectIds === null) return [];
  if (projectIds.length === 0) return [];
  const links = await admin.from('project_tracks').select('track_id').in('project_id', projectIds);
  if (links.error) throw new Error(`scoped tracks: ${links.error.message}`);
  const trackIds = [...new Set(((links.data ?? []) as { track_id: string }[]).map((l) => l.track_id))];
  if (trackIds.length === 0) return [];
  const res = await admin.from('track_collaborators').select('party_id').eq('org_id', ctx.orgId).in('track_id', trackIds);
  check('scoped credits', res.error);
  return [...new Set(((res.data ?? []) as { party_id: string | null }[]).map((r) => r.party_id).filter((p): p is string => !!p))];
}

export async function insertParty(admin: AdminClient, org: string, createdBy: string, columns: PartyColumns): Promise<{ party: PartyRow } | { duplicate: true }> {
  const res = await admin.from('parties').insert({ org_id: org, kind: 'person', created_by: createdBy, ...columns }).select(PARTY_COLUMNS).single();
  if (isUniqueViolation(res.error)) return { duplicate: true };
  check('party insert', res.error);
  return { party: res.data as unknown as PartyRow };
}

export async function updateParty(admin: AdminClient, org: string, partyId: string, columns: PartyColumns): Promise<{ party: PartyRow } | { duplicate: true } | { missing: true }> {
  const res = await admin.from('parties').update(columns).eq('org_id', org).eq('id', partyId).select(PARTY_COLUMNS).maybeSingle();
  if (isUniqueViolation(res.error)) return { duplicate: true };
  check('party update', res.error);
  if (!res.data) return { missing: true };
  const party = res.data as unknown as PartyRow;
  // Credits carry the party's display name (what the strip shows): a rename follows.
  if (typeof columns.display_name === 'string') {
    const renamed = await admin.from('track_collaborators').update({ name: columns.display_name }).eq('org_id', org).eq('party_id', partyId);
    check('credit rename', renamed.error);
  }
  return { party };
}

/** How many credits name the party (a party with credits is not deleted). */
export async function creditsOfParty(admin: AdminClient, org: string, partyId: string): Promise<number> {
  const res = await admin.from('track_collaborators').select('id', { count: 'exact', head: true }).eq('org_id', org).eq('party_id', partyId);
  check('party credits', res.error);
  return res.count ?? 0;
}

export async function deleteParty(admin: AdminClient, org: string, partyId: string): Promise<boolean> {
  const res = await admin.from('parties').delete().eq('org_id', org).eq('id', partyId).select('id');
  check('party delete', res.error);
  return ((res.data ?? []) as unknown[]).length > 0;
}

/** Is this account a member of the org, or of one of its projects? (A party may be linked to either.) */
export async function accountBelongsToOrg(admin: AdminClient, org: string, userId: string): Promise<boolean> {
  if (!isUUID(userId)) return false;
  const member = await admin.from('org_members').select('user_id').eq('org_id', org).eq('user_id', userId).maybeSingle();
  if (member.error) throw new Error(`member read: ${member.error.message}`);
  if (member.data) return true;
  const external = await admin.from('project_members').select('user_id').eq('org_id', org).eq('user_id', userId).limit(1);
  if (external.error) throw new Error(`external member read: ${external.error.message}`);
  return ((external.data ?? []) as unknown[]).length > 0;
}

/** Is this contact one of the org's? */
export async function contactInOrg(admin: AdminClient, org: string, contactId: string): Promise<boolean> {
  if (!isUUID(contactId)) return false;
  const res = await admin.from('contacts').select('id').eq('org_id', org).eq('id', contactId).maybeSingle();
  if (res.error) throw new Error(`contact read: ${res.error.message}`);
  return !!res.data;
}
