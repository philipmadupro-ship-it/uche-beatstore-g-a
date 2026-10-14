import { describe, expect, it } from 'vitest';
import {
  FILTER_VERSION,
  MAX_DEFINITION_BYTES,
  decodeDefinition,
  describeFilter,
  dimensionsOf,
  emptyDefinition,
  encodeDefinition,
  exampleQueries,
  filterReleases,
  involvedParties,
  isEmptyFilter,
  matchSong,
  matchSongBase,
  mentionedIds,
  parseDefinition,
  removeChip,
  sanitizeDefinition,
  songNeeds,
  sortSongs,
  unavailableDimensions,
  type Definition,
  type NameLookup,
  type SongFacts,
} from './filters';
import type { BoardRelease } from './release-board';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const X = id(1); // Producer X (a party)
const B = id(2); // Artist B's party
const A = id(3); // Artist A (roster contact)
const A2 = id(4); // another artist
const PROJECT = id(5);
const YEAR = 2026;

const song = (n: number, extra: Partial<SongFacts> = {}): SongFacts => ({
  id: id(100 + n),
  title: `Song ${n}`,
  stage: 'in_development',
  createdAt: `${YEAR}-10-01T10:00:00Z`,
  coverUrl: 'https://cdn/x.jpg',
  bpm: 120,
  key: 'F minor',
  isrc: 'USABC2600001',
  artistIds: [A],
  projectIds: [PROJECT],
  released: false,
  recordings: [],
  credits: [],
  involvedPartyIds: [],
  legalApproval: 'none',
  splitsComplete: true,
  ...extra,
});

const run = (def: Definition, facts: SongFacts[]) => {
  if (def.subject !== 'songs') throw new Error('songs only');
  return facts.filter((s) => matchSong(def.filter, s)).map((s) => s.id);
};

const queries = Object.fromEntries(exampleQueries({ producer: X, artistA: A, featured: B }, YEAR).map((q) => [q.key, q.definition]));

describe('the seven 08 §A2 example queries', () => {
  it('produced-by: songs with a producer credit for Producer X (any production role), not other roles or parties', () => {
    const facts = [
      song(1, { credits: [{ partyId: X, role: 'producer', status: 'confirmed' }] }),
      song(2, { credits: [{ partyId: X, role: 'co_producer', status: 'proposed' }] }),
      song(3, { credits: [{ partyId: X, role: 'mixer', status: 'confirmed' }] }), // credited, but not as producer
      song(4, { credits: [{ partyId: B, role: 'producer', status: 'confirmed' }] }), // another producer
      song(5),
    ];
    expect(run(queries['produced-by'], facts)).toEqual([facts[0].id, facts[1].id]);
  });

  it('demos-september: Artist A songs with a demo recording created in September', () => {
    const facts = [
      song(1, { recordings: [{ kind: 'demo', createdAt: `${YEAR}-09-30T23:59:00Z` }] }),
      song(2, { recordings: [{ kind: 'demo', createdAt: `${YEAR}-09-01T00:00:00Z` }] }),
      song(3, { recordings: [{ kind: 'demo', createdAt: `${YEAR}-10-01T00:00:00Z` }] }), // October
      song(4, { recordings: [{ kind: 'demo', createdAt: `${YEAR}-08-31T23:59:59Z` }] }), // August
      song(5, { recordings: [{ kind: 'master', createdAt: `${YEAR}-09-15T00:00:00Z` }] }), // not a demo
      song(6, { artistIds: [A2], recordings: [{ kind: 'demo', createdAt: `${YEAR}-09-15T00:00:00Z` }] }), // another artist
    ];
    expect(run(queries['demos-september'], facts)).toEqual([facts[0].id, facts[1].id]);
  });

  it('missing-artwork: songs with no cover', () => {
    const facts = [song(1, { coverUrl: null }), song(2), song(3, { coverUrl: null })];
    expect(run(queries['missing-artwork'], facts)).toEqual([facts[0].id, facts[2].id]);
  });

  it('waiting-legal: songs whose legal approval is requested and undecided; releases whose legal gate awaits approval', () => {
    const facts = [song(1, { legalApproval: 'waiting' }), song(2, { legalApproval: 'approved' }), song(3, { legalApproval: 'none' }), song(4, { legalApproval: 'changes_requested' })];
    expect(run(queries['waiting-legal'], facts)).toEqual([facts[0].id]);

    const rel = (n: number, legal: 'awaiting_approval' | 'approved'): BoardRelease => ({
      id: id(300 + n), title: `R${n}`, type: 'single', state: 'draft', artistId: A, artistName: 'A', targetDate: null, releaseDate: null,
      deliveredAt: null, deliveredTo: null, itemCount: 1, readyToDeliver: false, createdAt: '2026-10-01T00:00:00Z',
      gates: [{ gate: 'legal', status: legal, blockerCount: 0 }, { gate: 'artwork', status: 'blocked', blockerCount: 1 }],
    });
    const def = parseDefinition({ v: 1, subject: 'releases', filter: { gates: [{ gate: 'legal', status: ['awaiting_approval'] }] } });
    expect(def.ok).toBe(true);
    if (def.ok && def.definition.subject === 'releases') {
      const rows = [rel(1, 'awaiting_approval'), rel(2, 'approved')];
      expect(filterReleases(rows, def.definition.filter).map((r) => r.id)).toEqual([rows[0].id]);
    }
  });

  it('involving: credited, on a split line, or the uploader / task assignee / project member behind the party', () => {
    const partyUsers = new Map([[X, 'u-x']]);
    const base = { credits: [] as { partyId: string | null }[], splitPartyIds: [] as string[], accountUserIds: [] as string[], partyUsers };
    const involved = {
      credit: involvedParties({ ...base, credits: [{ partyId: X }] }),
      split: involvedParties({ ...base, splitPartyIds: [X] }),
      upload: involvedParties({ ...base, accountUserIds: ['U-X'] }), // uploader, case-insensitive
      none: involvedParties({ ...base, accountUserIds: ['u-other'] }),
    };
    expect(involved.credit).toEqual([X]);
    expect(involved.split).toEqual([X]);
    expect(involved.upload).toEqual([X]);
    expect(involved.none).toEqual([]);
    const facts = [song(1, { involvedPartyIds: involved.credit }), song(2, { involvedPartyIds: involved.upload }), song(3, { involvedPartyIds: involved.none }), song(4, { involvedPartyIds: [B] })];
    expect(run(queries['involving'], facts)).toEqual([facts[0].id, facts[1].id]);
  });

  it('unreleased-featuring: not released, with a featured-artist credit for B', () => {
    const facts = [
      song(1, { credits: [{ partyId: B, role: 'feature', status: 'confirmed' }] }),
      song(2, { released: true, credits: [{ partyId: B, role: 'feature', status: 'confirmed' }] }), // released
      song(3, { credits: [{ partyId: B, role: 'producer', status: 'confirmed' }] }), // B but not featured
      song(4, { credits: [{ partyId: X, role: 'feature', status: 'confirmed' }] }), // someone else featured
    ];
    expect(run(queries['unreleased-featuring'], facts)).toEqual([facts[0].id]);
  });

  it('splits-incomplete: songs whose splits are not complete', () => {
    const facts = [song(1, { splitsComplete: false }), song(2, { splitsComplete: true }), song(3, { splitsComplete: false })];
    expect(run(queries['splits-incomplete'], facts)).toEqual([facts[0].id, facts[2].id]);
  });

  it('every example parses, round-trips through the URL form and is not empty', () => {
    for (const q of Object.values(queries)) {
      const parsed = parseDefinition(q);
      expect(parsed.ok).toBe(true);
      expect(isEmptyFilter(q)).toBe(false);
      const back = decodeDefinition(encodeDefinition(q));
      expect(back.ok && back.definition).toEqual(parsed.ok && parsed.definition);
    }
    expect(Object.keys(queries)).toHaveLength(7);
  });
});

describe('fail closed', () => {
  it('a needed fact the store did not load is a no, never a widening', () => {
    const def = queries['produced-by'];
    const bare = { ...song(1), credits: undefined };
    if (def.subject === 'songs') expect(matchSong(def.filter, bare)).toBe(false);
    const legal = queries['waiting-legal'];
    if (legal.subject === 'songs') expect(matchSong(legal.filter, { ...song(1), legalApproval: undefined })).toBe(false);
    const splits = queries['splits-incomplete'];
    if (splits.subject === 'songs') expect(matchSong(splits.filter, { ...song(1), splitsComplete: undefined })).toBe(false);
  });

  it('matchSongBase ignores the derived clauses (the store applies them after loading)', () => {
    const def = queries['produced-by'];
    if (def.subject === 'songs') expect(matchSongBase(def.filter, song(1))).toBe(true);
  });
});

describe('base predicates', () => {
  const f = (filter: object): Definition => {
    const p = parseDefinition({ v: 1, subject: 'songs', filter });
    if (!p.ok) throw new Error(p.error);
    return p.definition;
  };
  const m = (filter: object, s: SongFacts) => {
    const d = f(filter);
    return d.subject === 'songs' && matchSong(d.filter, s);
  };
  it('stage, project, text, tempo, key, ISRC, creation range', () => {
    expect(m({ stages: ['selected'] }, song(1, { stage: 'selected' }))).toBe(true);
    expect(m({ stages: ['selected'] }, song(1))).toBe(false);
    expect(m({ projectIds: [PROJECT] }, song(1))).toBe(true);
    expect(m({ projectIds: [id(9)] }, song(1))).toBe(false);
    expect(m({ text: 'SONG 1' }, song(1))).toBe(true);
    expect(m({ bpmMin: 130 }, song(1))).toBe(false);
    expect(m({ bpmMin: 100, bpmMax: 130 }, song(1))).toBe(true);
    expect(m({ bpmMin: 100 }, song(1, { bpm: null }))).toBe(false);
    expect(m({ key: 'f  MINOR' }, song(1))).toBe(true);
    expect(m({ missing: ['isrc'] }, song(1, { isrc: null }))).toBe(true);
    expect(m({ missing: ['isrc'] }, song(1))).toBe(false);
    expect(m({ createdFrom: `${YEAR}-10-01`, createdTo: `${YEAR}-10-01` }, song(1))).toBe(true);
    expect(m({ createdTo: `${YEAR}-09-30` }, song(1))).toBe(false);
  });
  it('missing credits means no credit at all', () => {
    expect(m({ missing: ['credits'] }, song(1))).toBe(true);
    expect(m({ missing: ['credits'] }, song(1, { credits: [{ partyId: X, role: 'producer', status: 'confirmed' }] }))).toBe(false);
  });
  it('several credit clauses must all hold', () => {
    const s = song(1, { credits: [{ partyId: X, role: 'producer', status: 'confirmed' }, { partyId: B, role: 'feature', status: 'proposed' }] });
    expect(m({ credits: [{ partyId: X, roles: ['producer'] }, { partyId: B, roles: ['feature'] }] }, s)).toBe(true);
    expect(m({ credits: [{ partyId: X, roles: ['producer'] }, { partyId: B, roles: ['producer'] }] }, s)).toBe(false);
    expect(m({ credits: [{ partyId: B, status: ['confirmed'] }] }, s)).toBe(false);
  });
});

describe('the parser', () => {
  it('rejects a wrong version, subject, shape and bad ids', () => {
    expect(parseDefinition(null).ok).toBe(false);
    expect(parseDefinition({ v: 2, subject: 'songs', filter: {} }).ok).toBe(false);
    expect(parseDefinition({ v: 1, subject: 'people', filter: {} }).ok).toBe(false);
    expect(parseDefinition({ v: 1, subject: 'songs', filter: { artistIds: ['nope'] } }).ok).toBe(false);
    expect(parseDefinition({ v: 1, subject: 'songs', filter: { stages: ['bogus'] } }).ok).toBe(false);
    expect(parseDefinition({ v: 1, subject: 'songs', filter: { createdFrom: '2026-02-30' } }).ok).toBe(false);
  });
  it('rejects a reversed range instead of saving a view that can match nothing', () => {
    expect(parseDefinition({ v: 1, subject: 'songs', filter: { createdFrom: '2026-10-02', createdTo: '2026-10-01' } }).ok).toBe(false);
    expect(parseDefinition({ v: 1, subject: 'songs', filter: { bpmMin: 150, bpmMax: 100 } }).ok).toBe(false);
    expect(parseDefinition({ v: 1, subject: 'releases', filter: { targetFrom: '2026-10-02', targetTo: '2026-10-01' } }).ok).toBe(false);
    expect(parseDefinition({ v: 1, subject: 'songs', filter: { recording: { kind: 'demo', from: '2026-10-02', to: '2026-10-01' } } }).ok).toBe(false);
  });
  it('drops unknown keys, empties and duplicates; lowercases ids', () => {
    const p = parseDefinition({ v: 1, subject: 'songs', filter: { stages: [], artistIds: [A.toUpperCase(), A], junk: 1 } });
    expect(p.ok && p.definition.filter).toEqual({ artistIds: [A] });
  });
  it('caps the size and the id lists', () => {
    const many = Array.from({ length: 26 }, (_, i) => id(1000 + i));
    expect(parseDefinition({ v: 1, subject: 'songs', filter: { artistIds: many } }).ok).toBe(false);
    expect(parseDefinition({ v: 1, subject: 'songs', filter: { text: 'x'.repeat(MAX_DEFINITION_BYTES) } }).ok).toBe(false);
  });
  it('an empty filter is a valid definition', () => {
    const e = emptyDefinition('songs');
    expect(e.v).toBe(FILTER_VERSION);
    expect(parseDefinition(e).ok).toBe(true);
    expect(isEmptyFilter(e)).toBe(true);
  });
  it('a corrupt URL parameter is an error, not a throw', () => {
    expect(decodeDefinition('%%%').ok).toBe(false);
    expect(decodeDefinition('').ok).toBe(false);
    expect(decodeDefinition('e30').ok).toBe(false); // "{}" — no version
  });
});

describe('needs and capabilities', () => {
  it('names what a song filter must load', () => {
    const q = (k: string) => {
      const d = queries[k];
      return d.subject === 'songs' ? [...songNeeds(d.filter)].sort() : [];
    };
    expect(q('produced-by')).toEqual(['credits']);
    expect(q('demos-september')).toEqual(['recordings']);
    expect(q('missing-artwork')).toEqual([]);
    expect(q('waiting-legal')).toEqual(['legal_approval']);
    expect(q('involving')).toEqual(['involved']);
    expect(q('splits-incomplete')).toEqual(['splits']);
  });
  it('a viewer without the rights or approval ability cannot use those dimensions', () => {
    const plain = new Set(['catalog.read']);
    expect(unavailableDimensions(queries['produced-by'], plain, false)).toEqual(['credits']);
    expect(unavailableDimensions(queries['splits-incomplete'], plain, false)).toEqual(['splits']);
    expect(unavailableDimensions(queries['waiting-legal'], plain, false)).toEqual(['legal_approval']);
    expect(unavailableDimensions(queries['waiting-legal'], plain, true)).toEqual([]);
    expect(unavailableDimensions(queries['produced-by'], new Set(['catalog.read', 'rights.read']), false)).toEqual([]);
    expect(unavailableDimensions(queries['missing-artwork'], plain, false)).toEqual([]);
    expect(dimensionsOf(queries['involving'])).toEqual(['involved']);
  });
});

describe('chips and per-viewer sanitising', () => {
  const names: NameLookup = {
    artists: new Map([[A, 'Nova']]),
    parties: new Map([[X, 'Producer X']]),
    projects: new Map(),
  };

  it('draws a chip per filter and resolves names; an id the viewer cannot see draws none', () => {
    const d = parseDefinition({ v: 1, subject: 'songs', filter: { artistIds: [A, A2], credits: [{ partyId: X, roles: ['producer'] }, { partyId: B }], missing: ['artwork'], projectIds: [PROJECT] } });
    if (!d.ok) throw new Error(d.error);
    const labels = describeFilter(d.definition, names).map((c) => c.label);
    expect(labels).toContain('Nova');
    expect(labels).toContain('Producer X · Producer');
    expect(labels).toContain('Missing artwork');
    expect(labels.join('|')).not.toContain(A2);
    expect(labels.join('|')).not.toContain(B);
    expect(labels.join('|')).not.toContain(PROJECT);
  });

  it('removing a chip removes exactly that filter', () => {
    const d = parseDefinition({ v: 1, subject: 'songs', filter: { stages: ['inbox', 'selected'], artistIds: [A, A2], credits: [{ partyId: X }, { partyId: B }], bpmMin: 90, bpmMax: 100 } });
    if (!d.ok) throw new Error(d.error);
    let def = removeChip(d.definition, 'stage:inbox');
    expect(def.filter).toMatchObject({ stages: ['selected'] });
    def = removeChip(def, `artist:${A}`);
    expect(def.filter).toMatchObject({ artistIds: [A2] });
    def = removeChip(def, 'credit:0');
    expect(def.filter).toMatchObject({ credits: [{ partyId: B }] });
    def = removeChip(def, 'bpm');
    expect(def.filter).not.toHaveProperty('bpmMin');
    def = removeChip(def, 'credit:0');
    def = removeChip(def, `artist:${A2}`);
    def = removeChip(def, 'stage:selected');
    expect(isEmptyFilter(def)).toBe(true);
    expect(removeChip(def, 'nonsense')).toEqual(def);
  });

  it('chips for a release definition', () => {
    const d = parseDefinition({ v: 1, subject: 'releases', filter: { states: ['draft'], gates: [{ gate: 'artwork', status: ['blocked', 'not_started'] }], targetTo: '2026-12-31' } });
    if (!d.ok) throw new Error(d.error);
    expect(describeFilter(d.definition).map((c) => c.label)).toEqual(['State: draft', 'Target to 2026-12-31', 'Artwork: blocked / not started']);
    expect(removeChip(d.definition, 'gate:artwork').filter).not.toHaveProperty('gates');
  });

  it('a view shared by an unscoped owner names nothing outside a scoped member’s reach', () => {
    const d = parseDefinition({ v: 1, subject: 'songs', filter: { artistIds: [A, A2], projectIds: [PROJECT], involves: X, credits: [{ partyId: B, roles: ['feature'] }], released: false } });
    if (!d.ok) throw new Error(d.error);
    const { definition, narrowed } = sanitizeDefinition(d.definition, { artists: new Set([A]), parties: new Set(), projects: new Set() });
    expect(narrowed).toBe(true);
    const json = JSON.stringify(definition);
    for (const hidden of [A2, PROJECT, X, B]) expect(json).not.toContain(hidden);
    expect(json).toContain(A);
    expect(json).toContain('feature'); // the clause stays; only the id the viewer cannot see goes
    expect((definition.filter as { released?: boolean }).released).toBe(false);
  });

  it('nothing is narrowed when the viewer sees it all', () => {
    const d = parseDefinition({ v: 1, subject: 'songs', filter: { artistIds: [A], involves: X } });
    if (!d.ok) throw new Error(d.error);
    const { definition, narrowed } = sanitizeDefinition(d.definition, { artists: new Set([A]), parties: new Set([X]), projects: new Set() });
    expect(narrowed).toBe(false);
    expect(definition).toEqual(d.definition);
    expect(mentionedIds(d.definition)).toEqual({ artists: [A], parties: [X], projects: [] });
  });
});

describe('ordering', () => {
  it('newest first, id as the tiebreak', () => {
    const rows = [
      { id: 'b', createdAt: '2026-10-01T00:00:00Z' },
      { id: 'a', createdAt: '2026-10-01T00:00:00Z' },
      { id: 'c', createdAt: '2026-10-02T00:00:00Z' },
    ];
    expect(sortSongs(rows).map((r) => r.id)).toEqual(['c', 'a', 'b']);
  });
});
