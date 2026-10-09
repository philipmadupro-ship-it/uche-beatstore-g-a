import { describe, expect, it } from 'vitest';
import { creditRoleLabel } from './credit-roles';
import { personSummary, roleGroups, stripPeople, toStripCredit } from './credit-strip';
import type { CreditView } from './credits';

const view = (over: Partial<CreditView> = {}): CreditView => ({
  id: 'c1', trackId: 't1', name: 'Nova', role: 'songwriter', roleLabel: 'Songwriter', scope: 'composition', status: 'confirmed', roleDetail: null,
  source: 'manual', partyId: 'p1', contactId: null, mine: false, proposedByMe: false, confirmedAt: null, disputeNote: null,
  createdAt: '2026-10-01T10:00:00Z', party: { id: 'p1', kind: 'person', displayName: 'Nova', contactId: null },
  can: { confirm: false, dispute: false }, ...over,
});

describe('stripPeople', () => {
  it('one pill per person, roles joined, in the producer strip’s order', () => {
    const people = stripPeople([
      view({ id: 'a', name: 'Nova', role: 'songwriter' }),
      view({ id: 'b', name: 'nova', role: 'feature', roleLabel: 'Featured Artist' }),
      view({ id: 'c', name: 'Pierre', role: 'producer' }),
    ]);
    expect(people.map((p) => [p.name, p.roles])).toEqual([
      ['Pierre', ['producer']],
      ['nova', ['feature', 'songwriter']], // the group is named by its first credit, as in the producer strip
    ]);
  });

  it('the worst status wins: disputed over proposed over confirmed', () => {
    const [p] = stripPeople([view({ id: 'a', role: 'producer' }), view({ id: 'b', role: 'mixer', status: 'proposed' })]);
    expect(p.status).toBe('proposed');
    const [q] = stripPeople([view({ id: 'a', role: 'producer', status: 'proposed' }), view({ id: 'b', role: 'mixer', status: 'disputed' })]);
    expect(q.status).toBe('disputed');
  });

  it('a person reads as linked only when EVERY credit names a party', () => {
    expect(stripPeople([view({ id: 'a' })])[0].hasParty).toBe(true);
    expect(stripPeople([view({ id: 'a' }), view({ id: 'b', role: 'mixer', partyId: null })])[0].hasParty).toBe(false);
  });

  it('mine / actionable come from the credit views', () => {
    const [p] = stripPeople([view({ mine: true, can: { confirm: true, dispute: true } })]);
    expect(p).toMatchObject({ mine: true, actionable: true });
    expect(stripPeople([view()])[0]).toMatchObject({ mine: false, actionable: false });
  });

  it('keeps the credit views on each pill, and nothing else of the producer row', () => {
    const c = toStripCredit(view({ contactId: 'k1' }));
    expect(c).toMatchObject({ id: 'c1', track_id: 't1', name: 'Nova', role: 'songwriter', contact_id: 'k1' });
    expect(stripPeople([view({ contactId: 'k1' })])[0].credits[0].id).toBe('c1');
  });

  it('is empty for no credits', () => {
    expect(stripPeople([])).toEqual([]);
  });
});

describe('personSummary', () => {
  it('says who, in what, in what state, and when no party is behind it', () => {
    const [p] = stripPeople([view({ status: 'proposed', partyId: null })]);
    expect(personSummary(p, creditRoleLabel)).toBe('Nova · Songwriter · proposed · no rights-holder party');
    expect(personSummary(stripPeople([view()])[0], creditRoleLabel)).toBe('Nova · Songwriter · confirmed');
  });
});

describe('roleGroups', () => {
  it('offers the song’s roles and the recording’s, without the vague legacy collaborator', () => {
    const [song, recording] = roleGroups();
    expect(song).toMatchObject({ scope: 'composition', label: 'The song' });
    expect(song.roles.map((r) => r.key)).toEqual(['songwriter', 'composer', 'lyricist', 'arranger']);
    expect(recording.roles.map((r) => r.key)).toContain('mastering_engineer');
    expect(recording.roles.map((r) => r.key)).not.toContain('collaborator');
  });
});
