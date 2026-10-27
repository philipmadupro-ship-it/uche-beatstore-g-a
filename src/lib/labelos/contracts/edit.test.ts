import { describe, expect, it } from 'vitest';
import { cleanContractClauses, markClauses } from './clause-edit';
import { planSend } from './send';
import { buildHistory } from './history';
import type { PartyRole } from './types';
import { suggestArtistParties, suggestFromSplits } from './suggest';

const base = [
  { id: 'a', heading: 'Advance', body: 'Pay {{advance}}.' },
  { id: 'b', heading: 'Term', body: 'For {{contract.term}}.' },
];

describe('clause edits', () => {
  it('accepts known merge fields and mints ids for new clauses', () => {
    const res = cleanContractClauses([...base, { heading: ' Extra ', body: 'More for {{party.artist}}' }]);
    expect(res).toMatchObject({ ok: true });
    if (res.ok) expect(res.clauses.map((c) => c.id)).toEqual(['a', 'b', 'clause-3']);
  });
  it('refuses an unknown merge field, an empty clause and no clauses', () => {
    expect(cleanContractClauses([{ id: 'a', heading: 'H', body: '{{tax_id}}' }])).toMatchObject({ ok: false });
    expect(cleanContractClauses([{ id: 'a', heading: 'H', body: ' ' }])).toMatchObject({ ok: false });
    expect(cleanContractClauses([])).toMatchObject({ ok: false });
  });
  it('marks edited, added and removed clauses against the starting wording', () => {
    const now = [{ id: 'a', heading: 'Advance', body: 'Pay {{advance}} in full.' }, { id: 'z', heading: 'New', body: 'x' }];
    const m = markClauses(base, now);
    expect(m.marks).toEqual({ a: 'edited', z: 'added' });
    expect(m.removed.map((c) => c.id)).toEqual(['b']);
    expect(m.changed).toBe(3);
    expect(markClauses(base, base)).toMatchObject({ changed: 0, removed: [] });
  });
});

describe('planSend', () => {
  const slots = [{ role: 'artist', label: 'Artist', required: true }, { role: 'label', label: 'Label', required: false }] as const;
  const ok = { status: 'draft', missing: [], slots, filledRoles: new Set<PartyRole>(['artist']) } as const;
  it('sends a complete draft', () => expect(planSend(ok)).toEqual({ ok: true }));
  it('only a draft is sent', () => {
    expect(planSend({ ...ok, status: 'sent' })).toMatchObject({ ok: false, status: 409 });
    expect(planSend({ ...ok, status: 'void' })).toMatchObject({ ok: false, status: 409, error: 'A void contract cannot be sent' });
  });
  it('names a required party that is missing', () => {
    expect(planSend({ ...ok, filledRoles: new Set<PartyRole>() })).toMatchObject({ ok: false, status: 422, error: 'Choose the artist before sending' });
  });
  it('lists empty values', () => {
    const r = planSend({ ...ok, missing: ['advance', 'currency'] });
    expect(r).toMatchObject({ ok: false, status: 422, missing: ['advance', 'currency'] });
  });
});

describe('history', () => {
  const ev = (id: string, verb: string, at: string, payload: Record<string, unknown> | null) => ({ id, verb, actor_id: 'u1', created_at: at, payload });
  it('is newest first, names clause ids with their headings and ignores unrelated verbs', () => {
    const h = buildHistory(
      [
        ev('1', 'contract.created', '2026-10-01T10:00:00Z', { type: 'recording' }),
        ev('2', 'contract.updated', '2026-10-02T10:00:00Z', { changed: ['fields', 'clauses'], changed_clauses: ['a', 'gone'], version: 2 }),
        ev('3', 'contract.sent', '2026-10-03T10:00:00Z', { version: 2 }),
        ev('4', 'file.uploaded', '2026-10-03T11:00:00Z', {}),
      ],
      (id) => (id === 'a' ? 'Advance' : null),
    );
    expect(h.map((e) => e.kind)).toEqual(['sent', 'edited', 'created']);
    expect(h[1]).toMatchObject({ version: 2, changed: ['fields'], clauses: [{ id: 'a', heading: 'Advance' }, { id: 'gone', heading: null }] });
    expect(h[2].version).toBeNull();
  });
});

describe('history of a contract whose sent event lost the race', () => {
  const ev = (id: string, verb: string, at: string, version: number) => ({ id, verb, actor_id: 'u1', created_at: at, payload: { version } });
  it('keeps only the oldest sent event of the real sent version, and none while it is a draft', () => {
    const events = [ev('1', 'contract.sent', '2026-10-02T10:00:00Z', 2), ev('2', 'contract.sent', '2026-10-02T10:00:05Z', 2), ev('3', 'contract.send_failed', '2026-10-02T10:00:06Z', 2), ev('4', 'contract.sent', '2026-10-01T10:00:00Z', 1)];
    expect(buildHistory(events, () => null, 2).map((e) => [e.id, e.kind])).toEqual([['3', 'send_failed'], ['1', 'sent']]);
    expect(buildHistory(events, () => null, null).map((e) => e.kind)).toEqual(['send_failed']);
    expect(buildHistory(events, () => null).filter((e) => e.kind === 'sent')).toHaveLength(3);
  });
});

describe('suggestions', () => {
  const parties = [{ party_id: 'p1', role: 'artist' as const, name: 'Nova' }, { party_id: 'p2', role: 'label' as const, name: 'Label Co' }];
  it('offers the artist’s share from the live sheets, exact to four decimals', () => {
    const s = suggestFromSplits(
      [
        { kind: 'master', status: 'circulated', version: 2, lines: [{ party_id: 'p1', units: 333_333 }, { party_id: 'p2', units: 666_667 }] },
        { kind: 'master', status: 'superseded', version: 1, lines: [{ party_id: 'p1', units: 1_000_000 }] },
        { kind: 'composition', status: 'draft', version: 1, lines: [{ party_id: 'p1', units: 500_000 }] },
      ],
      parties,
    );
    expect(s).toEqual([{ key: 'master_share', value: '33.3333', source: 'Master split v2 · Nova', partyId: 'p1' }]);
  });
  it('offers 50 for a half share and a composition share from a signed sheet', () => {
    const s = suggestFromSplits([{ kind: 'composition', status: 'signed', version: 1, lines: [{ party_id: 'p1', units: 500_000 }] }], parties);
    expect(s[0]).toMatchObject({ key: 'publishing_share', value: '50' });
  });
  it('offers nothing when the party has no line', () => {
    expect(suggestFromSplits([{ kind: 'master', status: 'circulated', version: 1, lines: [{ party_id: 'zz', units: 1_000_000 }] }], parties)).toEqual([]);
  });
  it('finds the parties standing for the artist contact', () => {
    const ps = [{ id: 'p1', contact_id: 'c1' }, { id: 'p2', contact_id: null }, { id: 'p3', contact_id: 'c2' }];
    expect(suggestArtistParties(ps, 'c1').map((p) => p.id)).toEqual(['p1']);
    expect(suggestArtistParties(ps, null)).toEqual([]);
  });
});
