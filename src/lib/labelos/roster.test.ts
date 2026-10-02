import { describe, it, expect } from 'vitest';
import { artistOrgRemovalError, artistOrgRosterError, isRosterContact, NO_WORKSPACE, rosterSummary } from './roster';

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
