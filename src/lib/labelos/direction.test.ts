import { describe, expect, it } from 'vitest';
import {
  canReadInternalReference,
  changedDirectionFields,
  isEmptyDirection,
  nextReferencePosition,
  normalizeDirection,
  partitionReferences,
  referenceFileAllowed,
  referenceReadableBy,
  safeReferenceUrl,
  sameDirection,
  toReferenceView,
  type ReferenceRow,
} from './direction';

const row = (over: Partial<ReferenceRow> = {}): ReferenceRow => ({
  id: 'r1', kind: 'note', title: 'T', note: 'n', url: null, track_id: null, asset_id: null,
  visibility: 'artist', position: 0, created_at: '2026-10-01', updated_at: '2026-10-01', ...over,
});

describe('normalizeDirection', () => {
  it('keeps the known fields, trims, drops empties and unknown keys', () => {
    expect(normalizeDirection({ sound: '  warm ', lyrics: '   ', wiki: 'no', next: 5 })).toEqual({ sound: 'warm' });
  });
  it('de-duplicates keywords case-insensitively, keeps the first spelling and caps the list', () => {
    expect(normalizeDirection({ keywords: ['Soul', 'soul', ' ', 'Dusty', 3] })).toEqual({ keywords: ['Soul', 'Dusty'] });
    const many = normalizeDirection({ keywords: Array.from({ length: 30 }, (_, i) => `k${i}`) });
    expect(many.keywords).toHaveLength(12);
  });
  it('is total over junk', () => {
    for (const junk of [null, undefined, 'x', 4, [], [1]]) expect(normalizeDirection(junk)).toEqual({});
  });
  it('compares and diffs by meaning', () => {
    expect(sameDirection({ sound: ' a ' }, { sound: 'a' })).toBe(true);
    expect(isEmptyDirection({ sound: ' ' })).toBe(true);
    expect(changedDirectionFields({ sound: 'a', keywords: ['x'] }, { sound: 'b', avoid: 'c', keywords: ['y'] })).toEqual(['sound', 'avoid', 'keywords']);
  });
});

describe('who reads an internal reference (twin of migration 152)', () => {
  it('the team does; role artist and unknown roles never do', () => {
    for (const r of ['owner', 'admin', 'member']) expect(canReadInternalReference(r), r).toBe(true);
    for (const r of ['artist', '', 'viewer', 'ARTIST']) expect(canReadInternalReference(r), r).toBe(false);
  });
  it('only the exact value `artist` is open to everyone', () => {
    expect(referenceReadableBy('artist', 'artist')).toBe(true);
    expect(referenceReadableBy('artist', 'internal')).toBe(false);
    expect(referenceReadableBy('artist', 'friends')).toBe(false);
    expect(referenceReadableBy('member', 'internal')).toBe(true);
  });
});

describe('safeReferenceUrl', () => {
  it('accepts https and refuses everything else', () => {
    expect(safeReferenceUrl(' https://open.spotify.com/playlist/1 ')).toBe('https://open.spotify.com/playlist/1');
    for (const bad of ['http://a.com', 'javascript:alert(1)', 'data:text/html,x', 'https://u:p@a.com', 'https://localhost', 'ftp://a.com', '', 7, null]) {
      expect(safeReferenceUrl(bad), String(bad)).toBeNull();
    }
  });
});

describe('referenceFileAllowed', () => {
  it('visual and normal only', () => {
    expect(referenceFileAllowed({ kind: 'artwork', sensitivity: 'normal' })).toBe(true);
    expect(referenceFileAllowed({ kind: 'artwork', sensitivity: 'restricted' })).toBe(false);
    for (const kind of ['contract', 'split_sheet', 'audio', 'session', 'reference', 'other']) expect(referenceFileAllowed({ kind, sensitivity: 'normal' }), kind).toBe(false);
  });
});

describe('partitionReferences', () => {
  const rows = [
    row({ id: 'a', title: 'Open note', position: 1 }),
    row({ id: 'b', title: 'Internal', visibility: 'internal', position: 0 }),
    row({ id: 'c', title: 'Track', kind: 'track', note: null, track_id: 't1', position: 2 }),
    row({ id: 'd', title: 'Link', kind: 'link', note: null, url: 'https://a.com/x', position: 3 }),
    row({ id: 'e', title: 'Bad link', kind: 'link', note: null, url: 'http://a.com', position: 4 }),
  ];
  const resolve = (r: ReferenceRow) => (r.track_id === 't1' ? ({ kind: 'track', title: 'Midnight' } as const) : null);

  it('the team sees internal ones, in position order', () => {
    const { visible } = partitionReferences(rows, 'member', resolve);
    expect(visible.map((v) => v.id)).toEqual(['b', 'a', 'c', 'd']);
  });
  it('the roster artist does not see internal ones and they are not counted', () => {
    const { visible, restricted } = partitionReferences(rows, 'artist', resolve);
    expect(visible.map((v) => v.id)).toEqual(['a', 'c', 'd']);
    // Only the unusable link counts; the internal one leaves no trace.
    expect(restricted).toBe(1);
  });
  it('an unresolved track pointer is restricted, not titled', () => {
    const { visible, restricted } = partitionReferences(rows, 'member', () => null);
    expect(visible.map((v) => v.id)).toEqual(['b', 'a', 'd']);
    expect(restricted).toBe(2);
  });
  it('a view carries no org id or author id', () => {
    const v = toReferenceView(row({ kind: 'link', note: null, url: 'https://www.a.com/x' }), null)!;
    expect(v.host).toBe('a.com');
    expect(Object.keys(v)).not.toContain('org_id');
    expect(Object.keys(v)).not.toContain('created_by');
  });
});

describe('nextReferencePosition', () => {
  it('goes after the last', () => {
    expect(nextReferencePosition([])).toBe(0);
    expect(nextReferencePosition([0, 4, 2])).toBe(5);
  });
});
