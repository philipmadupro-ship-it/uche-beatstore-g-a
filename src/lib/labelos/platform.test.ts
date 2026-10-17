import { describe, expect, it } from 'vitest';
import { MODULES } from './entitlements';
import { defaultModulesFor, licensePayload, licenseeViews, planLicense } from './platform';

describe('planLicense', () => {
  it('maps each face onto its existing kind', () => {
    expect(planLicense({ face: 'independent' }).kind).toBe('artist');
    expect(planLicense({ face: 'label' }).kind).toBe('label');
  });

  it('modules omitted = everything the face allows; given = normalised', () => {
    expect(planLicense({ face: 'label' }).modules).toEqual([...MODULES]);
    expect(defaultModulesFor('independent')).toEqual([...MODULES]);
    expect(planLicense({ face: 'label', modules: ['export', 'bogus', 'contracts', 'export'] }).modules).toEqual(['contracts', 'export']);
    expect(planLicense({ face: 'label', modules: [] }).modules).toEqual([]);
  });

  it('caps: null/omitted = unlimited; an independent account has no artist cap (D1: one artist)', () => {
    expect(planLicense({ face: 'label', max_seats: 5, max_artists: 3 })).toMatchObject({ maxSeats: 5, maxArtists: 3 });
    expect(planLicense({ face: 'label' })).toMatchObject({ maxSeats: null, maxArtists: null });
    expect(planLicense({ face: 'independent', max_seats: 2, max_artists: 9 })).toMatchObject({ maxSeats: 2, maxArtists: null });
  });
});

describe('licensePayload', () => {
  it('records what was set and what it replaced, and never an email', () => {
    const plan = planLicense({ face: 'label', modules: ['export'], max_seats: 2 });
    expect(licensePayload(plan, null)).toEqual({ source: 'platform', modules: ['export'], max_seats: 2, max_artists: null, previous: null });
    const p = licensePayload(plan, { modules: ['contracts'], max_seats: null, max_artists: 4, setup_done: true }, { created: true });
    expect(p.previous).toEqual({ modules: ['contracts'], max_seats: null, max_artists: 4 });
    expect(p).toMatchObject({ created: true });
    expect(JSON.stringify(p)).not.toMatch(/@|token|password|secret/i);
  });
});

describe('licenseeViews', () => {
  const orgs = [
    { id: 'L', name: 'Label', slug: 'label', kind: 'label', created_at: '2026-10-02' },
    { id: 'A', name: 'Solo', slug: 'solo', kind: 'artist', created_at: '2026-10-03' },
    { id: 'P', name: 'Studio', slug: 'studio', kind: 'producer', created_at: '2026-10-04' },
  ];
  const views = licenseeViews({
    orgs,
    entitlements: [{ org_id: 'L', modules: ['export', 'nope'], max_seats: 3, max_artists: 1, setup_done: false }],
    members: [
      { org_id: 'L', role: 'owner' },
      { org_id: 'L', role: 'member' },
      { org_id: 'L', role: 'artist' },
      { org_id: 'A', role: 'owner' },
    ],
    contacts: [
      { org_id: 'L', category: 'artist', secondary_category: null },
      { org_id: 'L', category: 'producer', secondary_category: 'rapper' },
      { org_id: 'L', category: 'press', secondary_category: null },
      { org_id: 'A', category: 'artist', secondary_category: null },
    ],
    ownerInvites: [{ org_id: 'A', email: 'n@x.test', expires_at: '2026-10-10' }],
  });

  it('lists licensees only (never the producer’s own org), newest first', () => {
    expect(views.map((v) => v.id)).toEqual(['A', 'L']);
    expect(views.map((v) => v.face)).toEqual(['independent', 'label']);
  });

  it('carries the licence, or the default when there is no row', () => {
    const l = views.find((v) => v.id === 'L')!;
    expect(l).toMatchObject({ licensed: true, modules: ['export'], maxSeats: 3, maxArtists: 1, setupDone: false });
    const a = views.find((v) => v.id === 'A')!;
    expect(a).toMatchObject({ licensed: false, modules: [...MODULES], maxSeats: null, setupDone: true });
  });

  it('counts staff seats (roster artists excluded), roster artists, owners and pending owner invitations', () => {
    const l = views.find((v) => v.id === 'L')!;
    expect(l).toMatchObject({ seatsUsed: 2, artists: 2, owners: 1, pendingOwnerInvites: [] });
    const a = views.find((v) => v.id === 'A')!;
    expect(a).toMatchObject({ seatsUsed: 1, artists: 1, owners: 1, pendingOwnerInvites: [{ email: 'n@x.test', expiresAt: '2026-10-10' }] });
  });
});
