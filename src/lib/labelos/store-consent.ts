/**
 * Artist consent on store listing (LABEL-71, owner decisions A and E of doc 21 §5.1, doc 22 §5). Pure:
 * the routes load rows and write through the service role; this module decides.
 *
 *  - WHO is asked. The artists a release is about: its own artist, plus every
 *    CONFIRMED credit on its songs that resolves to a roster artist contact
 *    (`creditedArtistContactIds`). A proposed or disputed credit asks nobody:
 *    it is not yet a fact about who made the music.
 *  - WHAT is recorded. One row per (release, artist contact): `proposed`
 *    (asked, no answer yet), `yes`, `no`. Silence is not a no — the label may
 *    list, the artist is told, and their word comes after (decision A) — but
 *    a `no` is final: the release stops serving at once, is taken off the
 *    store, and cannot be listed again until THAT artist says `yes`
 *    (`planConsentGate`). With several artists, any one `no` withdraws it
 *    (orchestrator's reading of "the artist always has the final say", doc 22 §5).
 *  - WHO answers. Only the artist's own account (`answerableContacts`): the
 *    OWNER of an artist org for that org's one roster artist (D1: the artist
 *    is the org), a member whose role is `artist` scoped to the contact
 *    (label orgs, the only kind that has the role), or the account a party
 *    linked to the contact belongs to while it is a member of the org AND has
 *    confirmed that party itself. A
 *    manager of an artist org, or A&R staff scoped to the same artist, is NOT
 *    the artist. Nobody answers FOR an artist. (Accepted deviation: an admin with
 *    `members.manage` can invite an address they control as role `artist`
 *    scoped to the contact; that needs an invitation the invitee accepts with a
 *    verified email and leaves member audit events.)
 *  - WHAT a visitor gets. `servesPublicly` is read on EVERY public request,
 *    next to listed / released / store owner: a `no` row, or the store
 *    owner's veto (`store_listing_vetoes`), takes the release off the store
 *    without anyone having to unlist it first.
 *  - WHO is told. One notification per linked account, never the asker
 *    (`proposalRecipients`). A credited artist with no account that is a
 *    member of the org has nobody to tell: they are `unreachable`, the
 *    listing says so, and nothing is invented (no email address is ever
 *    taken from a contact card for this).
 */
import { isUUID } from '@/lib/validate';

export const CONSENT_STATES = ['proposed', 'yes', 'no'] as const;
export type ConsentState = (typeof CONSENT_STATES)[number];

export function isConsentState(v: unknown): v is ConsentState {
  return typeof v === 'string' && (CONSENT_STATES as readonly string[]).includes(v);
}

/** What an artist may answer. `proposed` is the system's word, never an answer. */
export const CONSENT_DECISIONS = ['yes', 'no'] as const;
export type ConsentDecision = (typeof CONSENT_DECISIONS)[number];

export interface ConsentRow {
  artist_contact_id: string;
  state: ConsentState;
}

const low = (s: string) => s.toLowerCase();

/* ── The gate ────────────────────────────────────────────────────────── */

/** Contacts who have said no, lower-cased and de-duplicated. */
export function refusedBy(rows: readonly ConsentRow[]): string[] {
  return [...new Set(rows.filter((r) => r.state === 'no').map((r) => low(r.artist_contact_id)))].sort();
}

/**
 * May the public store serve this release as far as consent goes? Yes while
 * nobody credited has said no. An unreadable consent table is NOT "no rows":
 * the store reads fail closed on an error that is not "table missing".
 */
export function servesPublicly(rows: readonly ConsentRow[], vetoed = false): boolean {
  return !vetoed && refusedBy(rows).length === 0;
}

export type ConsentProblem = { ok: false; status: 409 | 404 | 400 | 403; error: string; field?: string };

/** Can the label list (or re-list) this release as far as consent goes? */
export function planConsentGate(rows: readonly ConsentRow[], vetoed = false): { ok: true } | (ConsentProblem & { status: 409 }) {
  const refused = refusedBy(rows);
  if (refused.length > 0) {
    return {
      ok: false,
      status: 409,
      // No count and no name: a member limited to some artists must not learn how many, or which, of the others refused.
      error: 'An artist on this release has said no to the store. It can be listed again once every artist who said no says yes.',
      field: 'consent',
    };
  }
  if (vetoed) {
    return { ok: false, status: 409, error: 'The store owner has taken this release off their store. They can allow it again.', field: 'veto' };
  }
  return { ok: true };
}

/* ── Who is asked ────────────────────────────────────────────────────── */

export interface CreditFact {
  /** The credit's own contact link (`track_collaborators.contact_id`). */
  contact_id: string | null;
  /** The contact of the party the credit names (`parties.contact_id`). */
  party_contact_id: string | null;
  status: string;
}

/**
 * The artists a listing asks: the release's artist and the roster artists
 * behind confirmed credits on its songs. Anyone who is credited but is not a
 * roster artist (an engineer, a mixer) is not asked — consent is the artists'.
 */
export function creditedArtistContactIds(input: {
  releaseContactId: string;
  credits: readonly CreditFact[];
  /** Contacts of the release's org that are on the artist roster. */
  rosterContactIds: ReadonlySet<string> | readonly string[];
}): string[] {
  const roster = new Set([...input.rosterContactIds].map(low));
  const out = new Set<string>([low(input.releaseContactId)]);
  for (const c of input.credits) {
    if (c.status !== 'confirmed') continue;
    for (const id of [c.contact_id, c.party_contact_id]) {
      if (id && roster.has(low(id))) out.add(low(id));
    }
  }
  return [...out].sort();
}

export interface ProposalPlan {
  /** Contacts that get a new `proposed` row. */
  insert: string[];
  /** Rows that exist already and stay as they are (`yes`, `no`, `proposed`). */
  keep: ConsentRow[];
  /** Rows of contacts no longer credited: kept (history), never counted as asked again. */
  refused: string[];
}

/**
 * Listing asks everyone credited who has not been asked. Existing rows are
 * never rewritten: a `yes` stays a yes, a `no` stays a no (the gate refuses
 * before this is used), a `proposed` is not asked twice.
 */
export function planProposal(credited: readonly string[], existing: readonly ConsentRow[]): ProposalPlan {
  const have = new Map(existing.map((r) => [low(r.artist_contact_id), r]));
  return {
    insert: credited.map(low).filter((id) => !have.has(id)),
    keep: [...have.values()],
    refused: refusedBy(existing),
  };
}

/* ── Who answers, and who is told ────────────────────────────────────── */

/** An account that stands for an artist contact in the release's org. */
export interface AccountLink {
  contact_id: string;
  user_id: string;
}

/** Roster artists a member may answer for: only members whose role is `artist`, via their scope. */
export function scopeLinks(members: readonly { user_id: string; role: string; contact_ids: readonly string[] }[]): AccountLink[] {
  return members.filter((m) => m.role === 'artist').flatMap((m) => m.contact_ids.map((c) => ({ contact_id: low(c), user_id: low(m.user_id) })));
}

/**
 * D1: an artist org IS its artist, so the org's owners stand for its roster artist (there is exactly one:
 * migration 166). Admins and members — a manager, an accountant — do not. Other kinds have no such rule.
 */
export function ownerLinks(orgKind: string, ownerUserIds: readonly string[], contactIds: readonly string[]): AccountLink[] {
  if (orgKind !== 'artist') return [];
  return ownerUserIds.flatMap((u) => contactIds.map((c) => ({ contact_id: low(c), user_id: low(u) })));
}

/**
 * The account a party stands for — only while that account is a member of the org AND has CONFIRMED the
 * party itself (LABEL-54: `details_confirmed_at`, stamped by the party's own account through
 * `/parties/[id]/confirm`, and cleared when the link or the details change). A rights writer can create or edit
 * a party and put any account on it, so the link alone proves nothing about who the artist is; the stamp is
 * the account's own act. (Residual, accepted: a rights writer who links THEMSELVES can also confirm themselves,
 * which leaves `party.updated` / `party.confirmed` events.)
 */
export function partyLinks(
  parties: readonly { contact_id: string | null; user_id: string | null; details_confirmed_at?: string | null; details_confirmed_by?: string | null }[],
  memberUserIds: ReadonlySet<string>,
): AccountLink[] {
  return parties
    .filter(
      (p): p is { contact_id: string; user_id: string; details_confirmed_at: string; details_confirmed_by: string } =>
        !!p.contact_id &&
        !!p.user_id &&
        memberUserIds.has(low(p.user_id)) &&
        !!p.details_confirmed_at &&
        !!p.details_confirmed_by &&
        low(p.details_confirmed_by) === low(p.user_id),
    )
    .map((p) => ({ contact_id: low(p.contact_id), user_id: low(p.user_id) }));
}

function uniqueLinks(links: readonly AccountLink[]): AccountLink[] {
  const seen = new Set<string>();
  const out: AccountLink[] = [];
  for (const l of links) {
    const key = `${low(l.contact_id)}:${low(l.user_id)}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ contact_id: low(l.contact_id), user_id: low(l.user_id) });
    }
  }
  return out;
}

/** The contacts this user answers for. */
export function answerableContacts(links: readonly AccountLink[], userId: string): string[] {
  return [...new Set(uniqueLinks(links).filter((l) => l.user_id === low(userId)).map((l) => l.contact_id))].sort();
}

export interface ProposalRecipients {
  /** One entry per account to tell; never the asker. */
  recipients: { contactId: string; userId: string }[];
  /** Asked contacts with no account at all: nobody can answer for them. */
  unreachable: string[];
}

/**
 * Who hears about a proposal. A contact whose only account is the asker's own
 * is reachable (the asker is that artist) but gets no message — asking
 * yourself notifies nobody.
 */
export function proposalRecipients(contactIds: readonly string[], links: readonly AccountLink[], actorId: string | null): ProposalRecipients {
  const all = uniqueLinks(links);
  const recipients: { contactId: string; userId: string }[] = [];
  const unreachable: string[] = [];
  for (const raw of contactIds) {
    const contactId = low(raw);
    const mine = all.filter((l) => l.contact_id === contactId);
    if (mine.length === 0) unreachable.push(contactId);
    for (const l of mine) if (!actorId || l.user_id !== low(actorId)) recipients.push({ contactId, userId: l.user_id });
  }
  return { recipients, unreachable: [...new Set(unreachable)].sort() };
}

/* ── An answer ───────────────────────────────────────────────────────── */

export type DecisionPlan =
  | { ok: true; change: 'none'; state: ConsentState }
  | { ok: true; change: 'set'; from: ConsentState; to: ConsentDecision; /** A no takes the release off the store in the same step. */ withdraw: boolean }
  | ConsentProblem;

/**
 * An artist's answer. Reversible both ways — they have the final say, also on
 * changing their mind — but nobody else may answer, and a repeat is not an
 * error and writes nothing. `current` null = this artist was never asked.
 */
export function planDecision(current: ConsentState | null, decision: unknown): DecisionPlan {
  if (decision !== 'yes' && decision !== 'no') return { ok: false, status: 400, error: 'Answer yes or no', field: 'decision' };
  if (current === null) return { ok: false, status: 404, error: 'Not found' };
  if (current === decision) return { ok: true, change: 'none', state: current };
  return { ok: true, change: 'set', from: current, to: decision, withdraw: decision === 'no' };
}

/* ── Summaries (what a lister or an artist reads) ────────────────────── */

export interface ConsentSummary {
  total: number;
  yes: number;
  proposed: number;
  no: number;
  /** `none` = nobody asked yet; `refused` = at least one no; `waiting` = no no, some unanswered; `agreed` = all yes. */
  status: 'none' | 'refused' | 'waiting' | 'agreed';
}

export function summarizeConsents(rows: readonly ConsentRow[]): ConsentSummary {
  const yes = rows.filter((r) => r.state === 'yes').length;
  const no = rows.filter((r) => r.state === 'no').length;
  const proposed = rows.filter((r) => r.state === 'proposed').length;
  const total = rows.length;
  const status = total === 0 ? 'none' : no > 0 ? 'refused' : proposed > 0 ? 'waiting' : 'agreed';
  return { total, yes, proposed, no, status };
}

/* ── The store owner's veto ──────────────────────────────────────────── */

export type VetoPlan = { ok: true; change: 'veto' | 'allow' | 'none' } | ConsentProblem;

/**
 * The store owner's own control over music of connected artists on THEIR
 * store: Unlist (a veto row in the owner's org — the artist org is never
 * written to, LABEL-41) and Allow again. Repeats are not errors.
 */
export function planVeto(input: { want: 'veto' | 'allow'; vetoed: boolean; listed: boolean }): VetoPlan {
  if (input.want === 'veto') {
    if (input.vetoed) return { ok: true, change: 'none' };
    // A release that is not on the store has nothing to unlist; a veto is for what is public.
    if (!input.listed) return { ok: false, status: 409, error: 'This release is not on the store', field: 'store_listed' };
    return { ok: true, change: 'veto' };
  }
  return input.vetoed ? { ok: true, change: 'allow' } : { ok: true, change: 'none' };
}

/** Ids that may be used in a filter or a key: validated lowercase UUIDs only. */
export function cleanIds(ids: readonly string[]): string[] {
  return [...new Set(ids.filter((i) => isUUID(i)).map(low))];
}
