import { describe, expect, it } from 'vitest';
import {
  answerableContacts,
  cleanIds,
  creditedArtistContactIds,
  ownerLinks,
  partyLinks,
  planConsentGate,
  planDecision,
  planProposal,
  planVeto,
  proposalRecipients,
  refusedBy,
  scopeLinks,
  servesPublicly,
  summarizeConsents,
  type AccountLink,
  type ConsentRow,
} from './store-consent';
import { planList, type ListInput } from './store-listing';

const A = '10000000-0000-4000-8000-00000000000a';
const B = '10000000-0000-4000-8000-00000000000b';
const C = '10000000-0000-4000-8000-00000000000c';
const U1 = '20000000-0000-4000-8000-000000000001';
const U2 = '20000000-0000-4000-8000-000000000002';
const STAFF = '20000000-0000-4000-8000-000000000009';

const row = (id: string, state: ConsentRow['state']): ConsentRow => ({ artist_contact_id: id, state });

describe('the gate: a listing serves while no credited artist has said no', () => {
  it('serves with no rows at all (before migration 186 the store behaves as it did)', () => {
    expect(servesPublicly([])).toBe(true);
  });

  it('serves while artists are only asked or have agreed', () => {
    expect(servesPublicly([row(A, 'proposed'), row(B, 'yes')])).toBe(true);
  });

  it('stops serving at any single no, whatever the others said', () => {
    expect(servesPublicly([row(A, 'yes'), row(B, 'no'), row(C, 'yes')])).toBe(false);
    expect(refusedBy([row(A.toUpperCase(), 'no'), row(A, 'no'), row(B, 'yes')])).toEqual([A]);
  });

  it('the store owner’s veto stops it as well', () => {
    expect(servesPublicly([row(A, 'yes')], true)).toBe(false);
  });

  it('planConsentGate refuses a re-listing until the artist says yes, naming nothing of them', () => {
    const one = planConsentGate([row(A, 'no')]);
    expect(one).toMatchObject({ ok: false, status: 409, field: 'consent' });
    // The words never carry a count or a name (a scoped member must not learn how many others refused).
    const many = planConsentGate([row(A, 'no'), row(B, 'no')]);
    expect(many.ok).toBe(false);
    if (!many.ok) {
      expect(many.error).toBe((one as { error: string }).error);
      expect(many.error).not.toMatch(/\d|\bnamed\b/);
    }
    expect(planConsentGate([row(A, 'yes'), row(B, 'proposed')])).toEqual({ ok: true });
    expect(planConsentGate([row(A, 'yes')], true)).toMatchObject({ ok: false, field: 'veto' });
  });

  it('after the artist flips a no to yes the same release can be listed again', () => {
    expect(planConsentGate([row(A, 'no')]).ok).toBe(false);
    const d = planDecision('no', 'yes');
    expect(d).toMatchObject({ ok: true, change: 'set', to: 'yes', withdraw: false });
    expect(planConsentGate([row(A, 'yes')]).ok).toBe(true);
  });
});

describe('planList carries the consent gate', () => {
  const input = (over: Partial<ListInput> = {}): ListInput => ({
    release: { state: 'delivered', imported_released: false, release_date: '2020-01-01', store_listed: false },
    itemCount: 2,
    orgId: '30000000-0000-4000-8000-000000000001',
    owner: { producerOrgId: '30000000-0000-4000-8000-000000000001', connectedArtistOrgIds: [] },
    currentPlayback: 'preview',
    ...over,
  });
  const now = new Date('2026-10-27T00:00:00Z');

  it('lists with no consent rows, with agreeing rows and with unanswered rows', () => {
    expect(planList(input(), now).ok).toBe(true);
    expect(planList(input({ consent: [row(A, 'yes'), row(B, 'proposed')] }), now).ok).toBe(true);
  });

  it('refuses a release one artist declined, and one the store owner vetoed', () => {
    expect(planList(input({ consent: [row(A, 'no')] }), now)).toMatchObject({ ok: false, status: 409, field: 'consent' });
    expect(planList(input({ vetoed: true }), now)).toMatchObject({ ok: false, status: 409, field: 'veto' });
  });
});

describe('who is asked', () => {
  const credit = (over: Partial<{ contact_id: string | null; party_contact_id: string | null; status: string }>) => ({
    contact_id: null,
    party_contact_id: null,
    status: 'confirmed',
    ...over,
  });

  it('is the release’s artist plus the roster artists behind confirmed credits', () => {
    expect(
      creditedArtistContactIds({
        releaseContactId: A,
        rosterContactIds: [A, B],
        credits: [credit({ contact_id: B }), credit({ party_contact_id: B }), credit({ contact_id: C })],
      }),
    ).toEqual([A, B]);
  });

  it('ignores proposed and disputed credits, and credited people who are not roster artists', () => {
    expect(
      creditedArtistContactIds({
        releaseContactId: A,
        rosterContactIds: new Set([A, B, C]),
        credits: [credit({ contact_id: B, status: 'proposed' }), credit({ contact_id: C, status: 'disputed' })],
      }),
    ).toEqual([A]);
    expect(creditedArtistContactIds({ releaseContactId: A, rosterContactIds: [A], credits: [credit({ contact_id: B })] })).toEqual([A]);
  });

  it('is case-insensitive and lists each artist once', () => {
    expect(
      creditedArtistContactIds({ releaseContactId: A.toUpperCase(), rosterContactIds: [A], credits: [credit({ contact_id: A }), credit({ party_contact_id: A.toUpperCase() })] }),
    ).toEqual([A]);
  });

  it('planProposal asks only those not asked yet and never rewrites an answer', () => {
    const plan = planProposal([A, B, C], [row(A, 'yes'), row(B, 'proposed')]);
    expect(plan.insert).toEqual([C]);
    expect(plan.keep.map((r) => r.state).sort()).toEqual(['proposed', 'yes']);
    expect(planProposal([A], [row(A, 'no')]).refused).toEqual([A]);
  });
});

describe('who answers, and who is told', () => {
  it('only a member whose role is artist, through their scope, stands for the artist', () => {
    const links = scopeLinks([
      { user_id: U1, role: 'artist', contact_ids: [A] },
      { user_id: STAFF, role: 'member', contact_ids: [A, B] },
    ]);
    expect(answerableContacts(links, U1)).toEqual([A]);
    // A&R staff scoped to the same artist is not the artist.
    expect(answerableContacts(links, STAFF)).toEqual([]);
  });

  it('the owners of an artist org stand for its artist; managers and other kinds’ owners do not (D1)', () => {
    expect(ownerLinks('artist', [U1], [A])).toEqual([{ contact_id: A, user_id: U1 }]);
    expect(ownerLinks('producer', [U1], [A])).toEqual([]);
    expect(ownerLinks('label', [U1], [A])).toEqual([]);
    expect(answerableContacts(ownerLinks('artist', [U1], [A]), STAFF)).toEqual([]);
  });

  it('a party’s account stands for its contact only while it is a member of the org AND confirmed the party itself', () => {
    const ok = { details_confirmed_at: '2026-10-01', details_confirmed_by: U2 };
    const parties = [
      { contact_id: B, user_id: U2, ...ok },
      { contact_id: C, user_id: STAFF, details_confirmed_at: '2026-10-01', details_confirmed_by: STAFF }, // not a member
      { contact_id: A, user_id: U1 }, // typed in by a writer, never confirmed
      { contact_id: A, user_id: U2, details_confirmed_at: '2026-10-01', details_confirmed_by: STAFF }, // confirmed by somebody else
      { contact_id: null, user_id: U1, ...ok },
      { contact_id: A, user_id: null, ...ok },
    ];
    const links = partyLinks(parties, new Set([U1, U2]));
    expect(links).toEqual([{ contact_id: B, user_id: U2 }]);
    expect(answerableContacts(links, U2)).toEqual([B]);
  });

  it('tells each linked account once, never the asker, and names who has nobody', () => {
    const links: AccountLink[] = [
      { contact_id: A, user_id: U1 },
      { contact_id: A, user_id: U1 },
      { contact_id: B, user_id: U2 },
    ];
    const out = proposalRecipients([A, B, C], links, U2);
    expect(out.recipients).toEqual([{ contactId: A, userId: U1 }]);
    expect(out.unreachable).toEqual([C]);
  });

  it('the asker being the artist is reachable, not unreachable, and gets no message', () => {
    const out = proposalRecipients([A], [{ contact_id: A, user_id: U1 }], U1);
    expect(out).toEqual({ recipients: [], unreachable: [] });
  });
});

describe('an answer', () => {
  it('moves asked → yes, asked → no, yes → no and no → yes; a no withdraws', () => {
    expect(planDecision('proposed', 'yes')).toEqual({ ok: true, change: 'set', from: 'proposed', to: 'yes', withdraw: false });
    expect(planDecision('proposed', 'no')).toEqual({ ok: true, change: 'set', from: 'proposed', to: 'no', withdraw: true });
    expect(planDecision('yes', 'no')).toMatchObject({ change: 'set', withdraw: true });
    expect(planDecision('no', 'yes')).toMatchObject({ change: 'set', to: 'yes', withdraw: false });
  });

  it('a repeat is a no-op, not an error', () => {
    expect(planDecision('no', 'no')).toEqual({ ok: true, change: 'none', state: 'no' });
    expect(planDecision('yes', 'yes')).toEqual({ ok: true, change: 'none', state: 'yes' });
  });

  it('refuses anything but yes or no, and an artist who was never asked', () => {
    for (const bad of ['proposed', 'maybe', '', null, undefined, 1]) expect(planDecision('proposed', bad), String(bad)).toMatchObject({ ok: false, status: 400 });
    expect(planDecision(null, 'yes')).toMatchObject({ ok: false, status: 404 });
  });
});

describe('summaries', () => {
  it('rolls rows up to one status, a no above everything', () => {
    expect(summarizeConsents([])).toMatchObject({ total: 0, status: 'none' });
    expect(summarizeConsents([row(A, 'yes'), row(B, 'yes')])).toMatchObject({ yes: 2, status: 'agreed' });
    expect(summarizeConsents([row(A, 'yes'), row(B, 'proposed')])).toMatchObject({ proposed: 1, status: 'waiting' });
    expect(summarizeConsents([row(A, 'proposed'), row(B, 'no')])).toMatchObject({ no: 1, status: 'refused' });
  });
});

describe('the store owner’s veto', () => {
  it('vetoes a listed release, repeats are no-ops, allow undoes it', () => {
    expect(planVeto({ want: 'veto', vetoed: false, listed: true })).toEqual({ ok: true, change: 'veto' });
    expect(planVeto({ want: 'veto', vetoed: true, listed: true })).toEqual({ ok: true, change: 'none' });
    expect(planVeto({ want: 'allow', vetoed: true, listed: false })).toEqual({ ok: true, change: 'allow' });
    expect(planVeto({ want: 'allow', vetoed: false, listed: true })).toEqual({ ok: true, change: 'none' });
  });

  it('has nothing to unlist on a release that is not listed', () => {
    expect(planVeto({ want: 'veto', vetoed: false, listed: false })).toMatchObject({ ok: false, status: 409 });
  });
});

describe('cleanIds', () => {
  it('keeps only lowercase unique uuids', () => {
    expect(cleanIds([A.toUpperCase(), A, 'x', 'a,b', ''])).toEqual([A]);
  });
});
