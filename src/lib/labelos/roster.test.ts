import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ARTIST_GROUP_CATEGORIES, groupOfCategory } from '@/lib/contacts/roles';
import { isDuplicateEmail } from './org-contacts';
import {
  artistOrgRemovalError,
  artistOrgRosterError,
  isRosterContact,
  isSecondArtistError,
  NO_WORKSPACE,
  ONE_ARTIST,
  ONE_ARTIST_INDEX,
  rosterCapError,
  rosterSummary,
} from './roster';

describe('isRosterContact (17 R3 + Q2)', () => {
  it('a contact with an artist role is on the roster', () => {
    expect(isRosterContact({ category: 'artist' }, NO_WORKSPACE)).toBe(true);
    expect(isRosterContact({ category: 'rapper' }, NO_WORKSPACE)).toBe(true);
    expect(isRosterContact({ category: 'producer', secondary_category: 'singer' }, NO_WORKSPACE)).toBe(true);
  });

  it('a contact in workspace mode is on the roster, whatever its role (isWorkspaceMode)', () => {
    expect(isRosterContact({ category: 'label' }, { linkedProjects: 1, hasPortal: false })).toBe(true);
    expect(isRosterContact({ category: null }, { linkedProjects: 0, hasPortal: true })).toBe(true);
  });

  it('everyone else is in the directory but not the roster', () => {
    expect(isRosterContact({ category: 'producer' }, NO_WORKSPACE)).toBe(false);
    expect(isRosterContact({ category: 'buyer' }, NO_WORKSPACE)).toBe(false);
    expect(isRosterContact({}, NO_WORKSPACE)).toBe(false);
  });
});

describe('artistOrgRosterError (D1: an artist org has one roster entry, itself)', () => {
  const self = { id: 'self', category: 'artist' };
  const engineer = { id: 'eng', category: 'engineer' };

  it('other kinds have no limit', () => {
    expect(artistOrgRosterError('label', [self], { category: 'artist' })).toBeNull();
    expect(artistOrgRosterError('producer', [self], { category: 'artist' })).toBeNull();
  });

  it('an artist org may add people who are not artists', () => {
    expect(artistOrgRosterError('artist', [self], { category: 'engineer' })).toBeNull();
  });

  it('an artist org refuses a second artist', () => {
    expect(artistOrgRosterError('artist', [self, engineer], { category: 'rapper' })).toMatch(/one artist/i);
    expect(artistOrgRosterError('artist', [self], { id: 'eng', category: 'engineer', secondary_category: 'artist' })).toMatch(/one artist/i);
  });

  it('editing the one artist itself is fine', () => {
    expect(artistOrgRosterError('artist', [self], { id: 'self', category: 'singer' })).toBeNull();
  });

  it('the one artist cannot stop being an artist', () => {
    expect(artistOrgRosterError('artist', [self], { id: 'self', category: 'producer' })).toMatch(/one artist/i);
  });

  it('an artist org with no artist yet may add one', () => {
    expect(artistOrgRosterError('artist', [engineer], { category: 'artist' })).toBeNull();
  });
});

describe('rosterCapError (LABEL-47: the licence caps roster artists)', () => {
  const org = [
    { id: 'a', category: 'artist' },
    { id: 'b', category: 'producer' },
    { id: 'c', category: 'label', secondary_category: 'artist' },
  ];
  it('no cap: anything goes', () => {
    expect(rosterCapError(org, { category: 'artist' }, null)).toBeNull();
  });
  it('a new artist past the cap is refused, at the cap is fine', () => {
    expect(rosterCapError(org, { category: 'artist' }, 3)).toBeNull();
    expect(rosterCapError(org, { category: 'artist' }, 2)).toMatch(/already has 2 artists/);
    expect(rosterCapError(org, { category: 'rapper' }, 2)).toMatch(/already has 2 artists/);
  });
  it('someone who is not an artist is never counted against it', () => {
    expect(rosterCapError(org, { category: 'producer' }, 0)).toBeNull();
    expect(rosterCapError(org, { id: 'b', category: 'manager' }, 0)).toBeNull();
  });
  it('editing an existing artist never trips it; making a non-artist one does', () => {
    expect(rosterCapError(org, { id: 'a', category: 'artist' }, 1)).toBeNull();
    expect(rosterCapError(org, { id: 'b', category: 'artist' }, 2)).toMatch(/already has 2/);
    expect(rosterCapError(org, { id: 'b', category: 'artist' }, 3)).toBeNull();
  });
});

describe('artistOrgRemovalError', () => {
  it("refuses removing an artist org's artist, allows everyone else", () => {
    expect(artistOrgRemovalError('artist', { category: 'artist' })).toMatch(/one artist/i);
    expect(artistOrgRemovalError('artist', { category: 'engineer' })).toBeNull();
    expect(artistOrgRemovalError('label', { category: 'artist' })).toBeNull();
  });
});

describe('rosterSummary', () => {
  it('draws an org artist as a new relationship with nothing moving, never invented activity', () => {
    const s = rosterSummary({ id: 'c1', name: 'Nova', avatar_url: null, crm_status: null });
    expect(s.contact).toEqual({ id: 'c1', name: 'Nova', avatar_url: null });
    expect(s.relationship.stage).toBe('new');
    expect([s.projectCount, s.plays, s.downloads, s.notifyCount, s.moving]).toEqual([0, 0, 0, 0, 0]);
    expect(s.portal).toBeNull();
    expect(s.activeProject).toBeNull();
  });

  it('a parked contact reads as parked', () => {
    expect(rosterSummary({ id: 'c1', name: 'Nova', avatar_url: null, crm_status: 'cold' }).relationship.parked).toBe('cold');
  });
});

describe('one artist per artist org, held by the database (migration 166)', () => {
  const sql = readFileSync(join(process.cwd(), 'supabase/migrations/166_labelos_one_artist_per_artist_org.sql'), 'utf8').replace(/--[^\n]*/g, '');

  it('the second artist is recognised by its index name and answered with the route’s own sentence', () => {
    const err = { code: '23505', message: `duplicate key value violates unique constraint "${ONE_ARTIST_INDEX}"` };
    expect(isSecondArtistError(err)).toBe(true);
    expect(ONE_ARTIST).toMatch(/exactly one artist/);
  });

  it('another unique violation (the directory email) is not mistaken for it, and vice versa', () => {
    const email = { code: '23505', message: 'duplicate key value violates unique constraint "contacts_org_email_uniq"' };
    expect(isSecondArtistError(email)).toBe(false);
    expect(isDuplicateEmail(email)).toBe(true);
    expect(isDuplicateEmail({ code: '23505', message: `duplicate key value violates unique constraint "${ONE_ARTIST_INDEX}"` })).toBe(false);
    expect(isSecondArtistError(null)).toBe(false);
    expect(isSecondArtistError({ code: '23514', message: ONE_ARTIST_INDEX })).toBe(false);
  });

  it('the SQL artist categories are exactly the ones groupOfCategory calls artist (TS ↔ SQL)', () => {
    const fn = sql.match(/FUNCTION public\.labelos_is_artist_category\(p text\)[\s\S]*?ARRAY\[([^\]]*)\]/);
    expect(fn, 'labelos_is_artist_category with an ARRAY literal').not.toBeNull();
    const inSql = fn![1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).sort();
    expect(inSql).toEqual([...ARTIST_GROUP_CATEGORIES].sort());
    for (const c of inSql) expect(groupOfCategory(c), c).toBe('artist');
    // Matched as groupOfCategory matches: trimmed of ANY whitespace (JS trim, not btrim's spaces only) and lower-cased.
    expect(sql).toContain("lower(regexp_replace(p, '^\\s+|\\s+$', '', 'g'))");
  });

  it('the index is partial on the trigger-kept flag, keyed by org', () => {
    expect(sql).toMatch(new RegExp(`CREATE UNIQUE INDEX IF NOT EXISTS ${ONE_ARTIST_INDEX}\\s+ON public\\.contacts \\(org_id\\)\\s+WHERE org_self_artist`));
  });
});
