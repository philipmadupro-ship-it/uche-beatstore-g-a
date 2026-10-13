import { describe, expect, it } from 'vitest';
import { capabilitiesFor } from './capabilities';
import {
  canProposeOwn,
  canPropose,
  canWriteRights,
  creditReach,
  creditView,
  externalActor,
  mayReadLegal,
  orgActor,
  partyView,
  planDecision,
  planPropose,
  worstStatus,
  type CreditRow,
  type PartyRow,
} from './credits';

const U = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const caps = (role: string, functions: string[] = []) => capabilitiesFor('label', role, functions);

const OWNER = orgActor(U(1), caps('owner'));
const AR = orgActor(U(2), caps('member', ['a_and_r']));
const PRODUCER = orgActor(U(3), caps('member', ['producer']));
const MARKETING = orgActor(U(4), caps('member', ['marketing']));
const ARTIST = orgActor(U(5), caps('artist'));

const party = (over: Partial<PartyRow> = {}): PartyRow => ({
  id: 'p1', kind: 'person', display_name: 'Pierre', legal_name: 'Pierre Producteur', email: 'p@x.test', ipi: '00123456789', isni: null,
  pro: 'SACEM', pro_affiliation: 'affiliated', publisher_name: null, publisher_ipi: null, contact_id: null, user_id: U(3), created_at: '2026-10-01', ...over,
});
const credit = (over: Partial<CreditRow> = {}): CreditRow => ({
  id: 'c1', track_id: 't1', name: 'Pierre', role: 'producer', source: 'manual', scope: 'recording', status: 'proposed', role_detail: null,
  party_id: 'p1', contact_id: null, created_by: U(3), confirmed_by: null, confirmed_at: null, dispute_note: null, created_at: '2026-10-01', ...over,
});

describe('reach', () => {
  it('rights.read reads all; an own line reads its own; the rest nothing', () => {
    expect(creditReach(OWNER)).toBe('all');
    expect(creditReach(AR)).toBe('all');
    expect(creditReach(PRODUCER)).toBe('own');
    // A roster artist holds rights.read: every credit of THEIR songs (the artist scope narrows which songs, in the route).
    expect(creditReach(ARTIST)).toBe('all');
    expect(creditReach(MARKETING)).toBe('none');
  });
  it('an external member reads their own line only, whatever their role', () => {
    for (const role of ['viewer', 'commenter', 'contributor', 'editor']) expect(creditReach(externalActor(U(9), role)), role).toBe('own');
  });
  it('only an org member with rights.write writes rights', () => {
    expect(canWriteRights(OWNER)).toBe(true);
    expect(canWriteRights(AR)).toBe(false);
    expect(canWriteRights(PRODUCER)).toBe(false);
    expect(canWriteRights(externalActor(U(9), 'editor'))).toBe(false);
  });
});

describe('who may propose', () => {
  it('own-line holders and external contributors / editors; not viewers or commenters', () => {
    expect(canProposeOwn(PRODUCER)).toBe(true);
    expect(canProposeOwn(externalActor(U(9), 'contributor'))).toBe(true);
    expect(canProposeOwn(externalActor(U(9), 'editor'))).toBe(true);
    expect(canProposeOwn(externalActor(U(9), 'viewer'))).toBe(false);
    expect(canProposeOwn(externalActor(U(9), 'commenter'))).toBe(false);
    expect(canPropose(MARKETING)).toBe(false);
  });
});

describe('planPropose', () => {
  const ctx = { ownPartyId: 'own-p', ownName: 'Pierre Producteur' };
  const ext = externalActor(U(9), 'contributor');

  it('a rights writer proposes for a party or for a free name', () => {
    expect(planPropose(OWNER, { role: 'mixer', partyId: 'p9' }, ctx)).toEqual({ ok: true, scope: 'recording', target: { kind: 'party', id: 'p9' }, contactId: null });
    expect(planPropose(OWNER, { role: 'songwriter', name: '  Nova   Okafor ', contactId: 'c9' }, ctx)).toEqual({
      ok: true, scope: 'composition', target: { kind: 'name', name: 'Nova Okafor' }, contactId: 'c9',
    });
    expect(planPropose(OWNER, { role: 'mixer' }, ctx)).toMatchObject({ ok: false, status: 400 });
  });

  it('an external member can propose a credit naming themselves — their own party, or their own name', () => {
    expect(planPropose(ext, { role: 'mixer' }, ctx)).toEqual({ ok: true, scope: 'recording', target: { kind: 'own' }, contactId: null });
    expect(planPropose(ext, { role: 'mixer', partyId: 'own-p' }, ctx)).toMatchObject({ ok: true, target: { kind: 'own' } });
    expect(planPropose(ext, { role: 'mixer', name: ' pierre   PRODUCTEUR' }, ctx)).toMatchObject({ ok: true, target: { kind: 'own' } });
    expect(planPropose(ext, { role: 'mixer', partyId: 'other', }, { ...ctx, partyUserId: ext.userId })).toMatchObject({ ok: true });
  });

  it('an external member CANNOT propose a credit for someone else: another party, another name, a contact', () => {
    expect(planPropose(ext, { role: 'mixer', partyId: 'p-nova' }, ctx)).toEqual({ ok: false, status: 403, error: 'You can only propose a credit that names you' });
    expect(planPropose(ext, { role: 'mixer', partyId: 'p-nova' }, { ...ctx, partyUserId: U(77) })).toMatchObject({ ok: false, status: 403 });
    expect(planPropose(ext, { role: 'mixer', name: 'Nova Okafor' }, ctx)).toMatchObject({ ok: false, status: 403 });
    expect(planPropose(ext, { role: 'mixer', contactId: 'c1' }, ctx)).toMatchObject({ ok: false, status: 403 });
    expect(planPropose(PRODUCER, { role: 'mixer', name: 'Nova Okafor' }, ctx)).toMatchObject({ ok: false, status: 403 });
  });

  it('a viewer, a commenter and marketing cannot propose at all', () => {
    for (const role of ['viewer', 'commenter']) {
      expect(planPropose(externalActor(U(9), role), { role: 'mixer' }, ctx)).toEqual({ ok: false, status: 403, error: 'You cannot propose credits here' });
    }
    expect(planPropose(MARKETING, { role: 'mixer' }, ctx)).toMatchObject({ ok: false, status: 403 });
  });

  it('the role must exist and the scope must be the role’s', () => {
    expect(planPropose(OWNER, { role: 'wizard', partyId: 'p' }, ctx)).toMatchObject({ ok: false, status: 400 });
    expect(planPropose(ext, { role: 'mixer', scope: 'composition' }, ctx)).toMatchObject({ ok: false, status: 400 });
  });
});

describe('planDecision', () => {
  const mine = { status: 'proposed', createdBy: U(2), partyUserId: U(3) };

  it('a rights writer decides any credit', () => {
    expect(planDecision(OWNER, 'confirmed', mine)).toEqual({ ok: true });
    expect(planDecision(OWNER, 'disputed', mine)).toEqual({ ok: true });
    expect(planDecision(OWNER, 'confirmed', { ...mine, createdBy: OWNER.userId })).toEqual({ ok: true });
  });
  it('the credited person confirms or disputes THEIR credit', () => {
    expect(planDecision(PRODUCER, 'confirmed', mine)).toEqual({ ok: true });
    expect(planDecision(PRODUCER, 'disputed', mine)).toEqual({ ok: true });
  });
  it('… but not one they proposed themselves (a self-confirmation is not a confirmation)', () => {
    const self = { ...mine, createdBy: PRODUCER.userId };
    expect(planDecision(PRODUCER, 'confirmed', self)).toMatchObject({ ok: false, status: 403 });
    expect(planDecision(PRODUCER, 'disputed', self)).toEqual({ ok: true });
  });
  it('a credit that is not theirs does not exist for them (404, never 403)', () => {
    expect(planDecision(PRODUCER, 'confirmed', { ...mine, partyUserId: U(77) })).toMatchObject({ ok: false, status: 404 });
    expect(planDecision(PRODUCER, 'confirmed', { ...mine, partyUserId: null })).toMatchObject({ ok: false, status: 404 });
    expect(planDecision(AR, 'confirmed', mine)).toMatchObject({ ok: false, status: 404 });
    expect(planDecision(externalActor(U(9), 'editor'), 'confirmed', mine)).toMatchObject({ ok: false, status: 404 });
  });
  it('an external member decides their own credit', () => {
    const ext = externalActor(U(9), 'viewer');
    expect(planDecision(ext, 'confirmed', { status: 'proposed', createdBy: U(1), partyUserId: U(9) })).toEqual({ ok: true });
  });
  it('a decision that changes nothing is a 409', () => {
    expect(planDecision(OWNER, 'confirmed', { ...mine, status: 'confirmed' })).toMatchObject({ ok: false, status: 409 });
    expect(planDecision(OWNER, 'disputed', { ...mine, status: 'disputed' })).toMatchObject({ ok: false, status: 409 });
    expect(planDecision(OWNER, 'confirmed', { ...mine, status: 'disputed' })).toEqual({ ok: true });
  });
});

describe('views', () => {
  it('legal name and IPI only with rights.read — or on the party’s own account', () => {
    expect(partyView(party(), OWNER).legal).toMatchObject({ legalName: 'Pierre Producteur', ipi: '00123456789' });
    expect(partyView(party(), AR).legal).toBeDefined();
    expect(partyView(party(), PRODUCER).legal).toBeDefined(); // their own
    expect(partyView(party({ user_id: U(77) }), PRODUCER).legal).toBeUndefined();
    expect(partyView(party({ user_id: null }), MARKETING).legal).toBeUndefined();
    expect(partyView(party({ user_id: U(77) }), externalActor(U(9), 'editor')).legal).toBeUndefined();
    expect(mayReadLegal(OWNER, null)).toBe(true);
  });
  it('a party view carries no account id, no creator', () => {
    const text = JSON.stringify(partyView(party(), OWNER));
    expect(text).not.toContain(U(3));
    expect(Object.keys(partyView(party({ user_id: U(77) }), MARKETING)).sort()).toEqual(['contactId', 'displayName', 'id', 'kind']);
  });
  it('a credit view names the status, the label, mine, and what the actor can do — and no foreign id', () => {
    const v = creditView(credit(), party(), AR);
    expect(v).toMatchObject({ status: 'proposed', roleLabel: 'Producer', scope: 'recording', mine: false, proposedByMe: false, can: { confirm: false, dispute: false } });
    expect(JSON.stringify(v)).not.toContain(U(3));
    const own = creditView(credit({ created_by: U(2) }), party(), PRODUCER);
    expect(own).toMatchObject({ mine: true, proposedByMe: false, can: { confirm: true, dispute: true } });
    expect(creditView(credit(), party(), OWNER).can).toEqual({ confirm: true, dispute: true });
  });
  it('an unknown status reads as proposed, never as confirmed', () => {
    expect(creditView(credit({ status: 'weird' }), null, OWNER).status).toBe('proposed');
    expect(creditView(credit({ scope: 'weird' }), null, OWNER).scope).toBeNull();
  });
  it('worst status', () => {
    expect(worstStatus(['confirmed', 'proposed'])).toBe('proposed');
    expect(worstStatus(['confirmed', 'disputed', 'proposed'])).toBe('disputed');
    expect(worstStatus(['confirmed'])).toBe('confirmed');
    expect(worstStatus([])).toBe('confirmed');
  });
});
