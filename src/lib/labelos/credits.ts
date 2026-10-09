/**
 * Who may do what with an org track's credits (LABEL-27, 06 §2.3/§2.6, D2).
 * Pure; the route loads the rows and the actor, asks these, then writes.
 *
 *  - READ: `rights.read` sees every credit of the song (and the parties'
 *    legal identifiers); `rights.read.own_line` — a producer or engineer
 *    function, or an external project member (D2) — sees only the credits
 *    whose party is THEM; everyone else sees none.
 *  - PROPOSE: `rights.write` may propose a credit for anyone. Anyone who
 *    holds an own line, or an external contributor / editor
 *    (`propose_own_credit`, 06 §2.6), may propose a credit that names
 *    THEMSELVES — their own party, never another person's, never a free
 *    name that is not theirs.
 *  - CONFIRM / DISPUTE: `rights.write` decides any credit. The credited
 *    person decides their own — but cannot confirm a credit they proposed
 *    themselves (a confirmation by the proposer is not a second pair of eyes).
 *    Both are audit events.
 *
 * Nothing here trusts a client: a body that names another party, another
 * contact or another person's name is refused with 403, not trimmed.
 */
import { externalCan, externalCapabilities } from './capabilities';
import { creditRoleLabel, isCreditStatus, resolveCreditScope, type CreditScope, type CreditStatus } from './credit-roles';

export type CreditActor = {
  userId: string;
  /** Org capabilities, or `externalCapabilities(role)` for an external member. */
  caps: ReadonlySet<string>;
  /** Set for an external project member (LABEL-21): their role in the project. */
  externalRole?: string;
};

export function orgActor(userId: string, caps: ReadonlySet<string>): CreditActor {
  return { userId, caps };
}

export function externalActor(userId: string, role: string): CreditActor {
  return { userId, caps: externalCapabilities(role), externalRole: role };
}

export type CreditReach = 'all' | 'own' | 'none';

/** What of a song's credits the actor reads. */
export function creditReach(actor: CreditActor): CreditReach {
  if (!actor.externalRole && actor.caps.has('rights.read')) return 'all';
  if (actor.caps.has('rights.read.own_line')) return 'own';
  return 'none';
}

export function canWriteRights(actor: CreditActor): boolean {
  return !actor.externalRole && actor.caps.has('rights.write');
}

/** May this actor propose a credit naming themselves? */
export function canProposeOwn(actor: CreditActor): boolean {
  if (actor.externalRole) return externalCan(actor.externalRole, 'propose_own_credit');
  return actor.caps.has('rights.read.own_line');
}

export function canPropose(actor: CreditActor): boolean {
  return canWriteRights(actor) || canProposeOwn(actor);
}

/** Legal name and IPI: `rights.read`, or the party is the actor's own. */
export function mayReadLegal(actor: CreditActor, partyUserId: string | null | undefined): boolean {
  if (!actor.externalRole && actor.caps.has('rights.read')) return true;
  return !!partyUserId && partyUserId === actor.userId;
}

const norm = (v: string) => v.trim().replace(/\s+/g, ' ').toLowerCase();

export type ProposeInput = {
  role: string;
  scope?: CreditScope | null;
  partyId?: string | null;
  name?: string | null;
  contactId?: string | null;
};

/** The party a proposal is attached to. `own` = the actor's own party (made on first use). */
export type ProposeTarget = { kind: 'own' } | { kind: 'party'; id: string } | { kind: 'name'; name: string };

export type ProposePlan =
  | { ok: true; scope: CreditScope; target: ProposeTarget; contactId: string | null }
  | { ok: false; status: 400 | 403; error: string };

/**
 * Decide a proposal. `ownPartyId` / `ownName` describe the actor's own party
 * (null when none exists yet; `ownName` is what it will be called);
 * `partyUserId` is the account of the party the body names, when it names one.
 */
export function planPropose(
  actor: CreditActor,
  input: ProposeInput,
  ctx: { ownPartyId: string | null; ownName: string; partyUserId?: string | null },
): ProposePlan {
  const scope = resolveCreditScope(input.role, input.scope);
  if (!scope.ok) return { ok: false, status: 400, error: scope.error };

  if (canWriteRights(actor)) {
    if (input.partyId) return { ok: true, scope: scope.scope, target: { kind: 'party', id: input.partyId }, contactId: input.contactId ?? null };
    const name = input.name?.trim().replace(/\s+/g, ' ');
    if (!name) return { ok: false, status: 400, error: 'Name the person: a party or a name' };
    return { ok: true, scope: scope.scope, target: { kind: 'name', name }, contactId: input.contactId ?? null };
  }

  if (!canProposeOwn(actor)) return { ok: false, status: 403, error: 'You cannot propose credits here' };

  const SELF = 'You can only propose a credit that names you';
  if (input.contactId) return { ok: false, status: 403, error: SELF };
  if (input.partyId && input.partyId !== ctx.ownPartyId && ctx.partyUserId !== actor.userId) return { ok: false, status: 403, error: SELF };
  if (input.name && norm(input.name) !== norm(ctx.ownName)) return { ok: false, status: 403, error: SELF };
  return { ok: true, scope: scope.scope, target: { kind: 'own' }, contactId: null };
}

export type CreditDecision = 'confirmed' | 'disputed';
export type DecisionPlan = { ok: true } | { ok: false; status: 403 | 404 | 409; error: string };

/**
 * Decide a confirm / dispute. A person who is not the credit's party and not a
 * rights writer gets 404, not 403: a credit that is not theirs does not exist
 * for them (D2).
 */
export function planDecision(
  actor: CreditActor,
  decision: CreditDecision,
  credit: { status: string; createdBy: string | null; partyUserId: string | null },
): DecisionPlan {
  const writer = canWriteRights(actor);
  const own = !!credit.partyUserId && credit.partyUserId === actor.userId;
  if (!writer) {
    if (!own) return { ok: false, status: 404, error: 'Not found' };
    if (!actor.caps.has('rights.read.own_line')) return { ok: false, status: 403, error: 'You cannot decide credits here' };
    if (decision === 'confirmed' && credit.createdBy === actor.userId) {
      return { ok: false, status: 403, error: 'Someone else has to confirm a credit you proposed' };
    }
  }
  if (credit.status === decision) return { ok: false, status: 409, error: decision === 'confirmed' ? 'Already confirmed' : 'Already disputed' };
  return { ok: true };
}

// ── Views ───────────────────────────────────────────────────────────────

export type CreditRow = {
  id: string;
  track_id: string;
  name: string;
  role: string;
  source: string;
  scope: string | null;
  status: string;
  role_detail: string | null;
  party_id: string | null;
  contact_id: string | null;
  created_by: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  dispute_note: string | null;
  created_at: string;
};

export type PartyRow = {
  id: string;
  kind: string;
  display_name: string;
  legal_name: string | null;
  email: string | null;
  ipi: string | null;
  isni: string | null;
  pro: string | null;
  pro_affiliation: string;
  publisher_name: string | null;
  publisher_ipi: string | null;
  contact_id: string | null;
  user_id: string | null;
  created_at: string;
};

export type PartyView = {
  id: string;
  kind: string;
  displayName: string;
  contactId: string | null;
  /** Present only for `rights.read` (or the party's own account). */
  legal?: {
    legalName: string | null;
    email: string | null;
    ipi: string | null;
    isni: string | null;
    pro: string | null;
    proAffiliation: string;
    publisherName: string | null;
    publisherIpi: string | null;
  };
};

/** Built field by field: no account id, no creator id of a party. */
export function partyView(row: PartyRow, actor: CreditActor): PartyView {
  const view: PartyView = { id: row.id, kind: row.kind, displayName: row.display_name, contactId: row.contact_id };
  if (mayReadLegal(actor, row.user_id)) {
    view.legal = {
      legalName: row.legal_name,
      email: row.email,
      ipi: row.ipi,
      isni: row.isni,
      pro: row.pro,
      proAffiliation: row.pro_affiliation,
      publisherName: row.publisher_name,
      publisherIpi: row.publisher_ipi,
    };
  }
  return view;
}

export type CreditView = {
  id: string;
  trackId: string;
  name: string;
  role: string;
  roleLabel: string;
  scope: CreditScope | null;
  status: CreditStatus;
  roleDetail: string | null;
  source: string;
  partyId: string | null;
  contactId: string | null;
  /** The credit names the actor / the actor proposed it — never an id of anyone else. */
  mine: boolean;
  proposedByMe: boolean;
  confirmedAt: string | null;
  disputeNote: string | null;
  createdAt: string;
  party: PartyView | null;
  can: { confirm: boolean; dispute: boolean };
};

export function creditView(row: CreditRow, party: PartyRow | null, actor: CreditActor): CreditView {
  const status: CreditStatus = isCreditStatus(row.status) ? row.status : 'proposed';
  const scope = row.scope === 'composition' || row.scope === 'recording' ? row.scope : null;
  const partyUserId = party?.user_id ?? null;
  const facts = { status, createdBy: row.created_by, partyUserId };
  return {
    id: row.id,
    trackId: row.track_id,
    name: row.name,
    role: row.role,
    roleLabel: creditRoleLabel(row.role),
    scope,
    status,
    roleDetail: row.role_detail,
    source: row.source,
    partyId: row.party_id,
    contactId: row.contact_id,
    mine: !!partyUserId && partyUserId === actor.userId,
    proposedByMe: !!row.created_by && row.created_by === actor.userId,
    confirmedAt: row.confirmed_at,
    disputeNote: row.dispute_note,
    createdAt: row.created_at,
    party: party ? partyView(party, actor) : null,
    can: {
      confirm: planDecision(actor, 'confirmed', facts).ok,
      dispute: planDecision(actor, 'disputed', facts).ok,
    },
  };
}

/** The worst status in a set: a person with a disputed credit reads as disputed. */
export function worstStatus(statuses: readonly string[]): CreditStatus {
  if (statuses.includes('disputed')) return 'disputed';
  if (statuses.includes('proposed')) return 'proposed';
  return 'confirmed';
}

export const CREDIT_STATUS_LABEL: Record<CreditStatus, string> = {
  proposed: 'Proposed',
  confirmed: 'Confirmed',
  disputed: 'Disputed',
};

const ROLE_STRENGTH = ['viewer', 'commenter', 'contributor', 'editor'] as const;

/**
 * An external member can belong to several projects a track sits in, with a
 * role in each. They act with the strongest — the same union `externalMayAny`
 * applies to every other §2.6 action.
 */
export function strongestExternalRole(memberships: readonly { role: string }[]): string | null {
  let best = -1;
  for (const m of memberships) best = Math.max(best, (ROLE_STRENGTH as readonly string[]).indexOf(m.role));
  return best < 0 ? null : ROLE_STRENGTH[best];
}
