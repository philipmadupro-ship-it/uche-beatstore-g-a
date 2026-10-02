import { describe, it, expect } from 'vitest';
import { artistScopeFilter, scopeAllowsAnyContact, scopeAllowsContact, toArtistScope } from './artist-scope';

const C1 = '00000000-0000-4000-8000-0000000000c1';
const C2 = '00000000-0000-4000-8000-0000000000c2';

describe('toArtistScope', () => {
  it('an org-scoped member sees the whole org (null list)', () => {
    expect(toArtistScope('member', 'org', [C1])).toBeNull();
    expect(toArtistScope('owner', 'org', [])).toBeNull();
  });

  it('an artists-scoped member sees exactly their list, lower-cased', () => {
    expect(toArtistScope('member', 'artists', [C1.toUpperCase(), C2])).toEqual(new Set([C1, C2]));
  });

  it('role artist is always scoped, whatever the column says (06 §2.5)', () => {
    expect(toArtistScope('artist', 'org', [C1])).toEqual(new Set([C1]));
  });

  it('an unknown scope value is the narrowest reading', () => {
    expect(toArtistScope('member', 'everything', [])).toEqual(new Set());
  });

  it('drops values that are not uuids', () => {
    expect(toArtistScope('member', 'artists', [C1, 'nope', null as unknown as string])).toEqual(new Set([C1]));
  });
});

describe('scopeAllowsContact', () => {
  it('whole org: every object, with or without a contact', () => {
    expect(scopeAllowsContact(null, C1)).toBe(true);
    expect(scopeAllowsContact(null, null)).toBe(true);
  });

  it('scoped: only a listed contact, compared case-insensitively', () => {
    const scope = new Set([C1]);
    expect(scopeAllowsContact(scope, C1.toUpperCase())).toBe(true);
    expect(scopeAllowsContact(scope, C2)).toBe(false);
  });

  it('scoped: an object with no contact is not visible', () => {
    expect(scopeAllowsContact(new Set([C1]), null)).toBe(false);
  });

  it('scoped with zero contacts sees nothing', () => {
    expect(scopeAllowsContact(new Set(), C1)).toBe(false);
  });
});

describe('artistScopeFilter', () => {
  it('whole org: no extra filter', () => {
    expect(artistScopeFilter(null, 'id')).toEqual({ kind: 'all' });
    expect(artistScopeFilter(null, null)).toEqual({ kind: 'all' });
  });

  it('scoped: the contact column limited to the list, sorted', () => {
    expect(artistScopeFilter(new Set([C2, C1]), 'artist_id')).toEqual({ kind: 'in', column: 'artist_id', values: [C1, C2] });
  });

  it('scoped with zero contacts, or a table without a contact column: nothing', () => {
    expect(artistScopeFilter(new Set(), 'id')).toEqual({ kind: 'none' });
    expect(artistScopeFilter(new Set([C1]), null)).toEqual({ kind: 'none' });
  });
});

describe('scopeAllowsAnyContact (a project / track reaches its artists through projects, LABEL-12)', () => {
  it('whole org: always, even with no artist', () => {
    expect(scopeAllowsAnyContact(null, [])).toBe(true);
  });

  it('scoped: at least one of the artists is listed', () => {
    const scope = new Set([C1]);
    expect(scopeAllowsAnyContact(scope, [C2, C1.toUpperCase()])).toBe(true);
    expect(scopeAllowsAnyContact(scope, [C2])).toBe(false);
  });

  it('scoped: an object with no artist is not visible', () => {
    expect(scopeAllowsAnyContact(new Set([C1]), [])).toBe(false);
  });
});
