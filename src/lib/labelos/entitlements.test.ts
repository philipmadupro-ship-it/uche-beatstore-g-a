import { describe, expect, it } from 'vitest';
import { ALL_CAPABILITIES, ORG_KINDS, capabilitiesFor, type Capability } from './capabilities';
import { ACCOUNT_FACES, FACE_KIND, accountFace, isAccountFace } from './account';
import {
  CAPABILITY_MODULE,
  FACE_MODULES,
  MODULES,
  MODULE_LABELS,
  artistLimitError,
  capabilityEntitled,
  entitledCapabilities,
  isModule,
  moduleCeiling,
  moduleOfCapability,
  normalizeModules,
  orgEntitlements,
  seatLimitError,
  takesSeat,
} from './entitlements';

describe('accountFace', () => {
  it('maps the two faces onto the existing kinds and nothing else', () => {
    expect(accountFace({ kind: 'artist' })).toBe('independent');
    expect(accountFace({ kind: 'label' })).toBe('label');
    // The producer's personal org is the studio, not a licensee.
    expect(accountFace({ kind: 'producer' })).toBeNull();
    for (const k of ['studio', '', 'LABEL', 'toString', '__proto__']) expect(accountFace({ kind: k })).toBeNull();
    expect(accountFace({ kind: null })).toBeNull();
    expect(accountFace({ kind: undefined })).toBeNull();
  });

  it('never invents a kind', () => {
    for (const face of ACCOUNT_FACES) expect(ORG_KINDS).toContain(FACE_KIND[face]);
    expect(new Set(ACCOUNT_FACES.map((f) => FACE_KIND[f])).size).toBe(ACCOUNT_FACES.length);
    for (const face of ACCOUNT_FACES) expect(accountFace({ kind: FACE_KIND[face] })).toBe(face);
  });

  it('recognises faces only', () => {
    expect(isAccountFace('independent')).toBe(true);
    expect(isAccountFace('label')).toBe(true);
    expect(isAccountFace('artist')).toBe(false);
    expect(isAccountFace(1)).toBe(false);
  });
});

describe('module vocabulary', () => {
  it('has a label per module and no duplicates', () => {
    expect(new Set(MODULES).size).toBe(MODULES.length);
    for (const m of MODULES) expect(MODULE_LABELS[m]).toBeTruthy();
  });

  it('maps only real capabilities to real modules', () => {
    for (const [capability, module] of Object.entries(CAPABILITY_MODULE)) {
      expect(ALL_CAPABILITIES).toContain(capability);
      expect(MODULES).toContain(module);
    }
    // Independently derived: the two module-owned capabilities that exist today.
    expect(moduleOfCapability('contracts.read')).toBe('contracts');
    expect(moduleOfCapability('finance.read')).toBe('finance');
    // The core is never module-owned: losing a module must not lock anyone out of the catalogue.
    for (const core of ['catalog.read', 'catalog.write', 'members.manage', 'org.manage', 'release.approve.legal', 'rights.read'] as const) {
      expect(moduleOfCapability(core)).toBeNull();
    }
    expect(moduleOfCapability('nope')).toBeNull();
    expect(moduleOfCapability('__proto__')).toBeNull();
  });

  it('every face may be granted every module today', () => {
    for (const face of ACCOUNT_FACES) expect([...FACE_MODULES[face]].sort()).toEqual([...MODULES].sort());
    expect(moduleCeiling('producer')).toEqual(MODULES);
    expect(moduleCeiling('weird')).toEqual(MODULES);
  });

  it('isModule fails closed', () => {
    expect(isModule('contracts')).toBe(true);
    expect(isModule('Contracts')).toBe(false);
    expect(isModule(undefined)).toBe(false);
  });
});

describe('normalizeModules', () => {
  it('drops unknowns and duplicates and keeps MODULES order', () => {
    expect(normalizeModules('label', ['export', 'nope', 'contracts', 'export', 3, null])).toEqual(['contracts', 'export']);
    expect(normalizeModules('label', null)).toEqual([]);
    expect(normalizeModules('label', [])).toEqual([]);
  });
});

describe('orgEntitlements', () => {
  it('no row = everything the face allows, unlimited, already set up', () => {
    for (const kind of ['artist', 'label', 'producer']) {
      const e = orgEntitlements({ kind }, null);
      expect([...e.modules]).toEqual([...moduleCeiling(kind)]);
      expect(e).toMatchObject({ maxSeats: null, maxArtists: null, setupDone: true, licensed: false });
    }
  });

  it('a row narrows to its modules and carries its caps', () => {
    const e = orgEntitlements({ kind: 'label' }, { modules: ['digest', 'store', 'bogus'], max_seats: 5, max_artists: 0, setup_done: false });
    expect([...e.modules]).toEqual(['store', 'digest']);
    expect(e).toMatchObject({ maxSeats: 5, maxArtists: 0, setupDone: false, licensed: true });
  });

  it('a malformed cap reads as unlimited, a malformed module list as none', () => {
    const e = orgEntitlements(
      { kind: 'artist' },
      { modules: null, max_seats: -1 as number, max_artists: 1.5 as number, setup_done: null },
    );
    expect(e.modules.size).toBe(0);
    expect(e).toMatchObject({ maxSeats: null, maxArtists: null, setupDone: false });
  });
});

describe('entitledCapabilities', () => {
  const ownerCaps = () => capabilitiesFor('label', 'owner', []);

  it('an owner without contracts loses contracts.read and nothing else', () => {
    const modules = new Set(MODULES.filter((m) => m !== 'contracts'));
    const caps = entitledCapabilities(ownerCaps(), modules);
    expect(caps.has('contracts.read')).toBe(false);
    expect(caps.has('catalog.read')).toBe(true);
    expect(caps.has('release.approve.legal')).toBe(true);
    expect(caps.size).toBe(ALL_CAPABILITIES.length - 1);
  });

  it('with every module, nothing changes', () => {
    expect(entitledCapabilities(ownerCaps(), new Set(MODULES))).toEqual(new Set(ownerCaps()));
  });

  it('with no module, only module-owned capabilities go', () => {
    const caps = entitledCapabilities(ownerCaps(), new Set());
    const owned = Object.keys(CAPABILITY_MODULE) as Capability[];
    for (const c of owned) expect(caps.has(c)).toBe(false);
    expect(caps.size).toBe(ALL_CAPABILITIES.length - owned.length);
  });

  it('a legal member keeps the catalogue that contracts.read implied', () => {
    const legal = capabilitiesFor('label', 'member', ['legal']);
    const caps = entitledCapabilities(legal, new Set(['export']));
    expect(caps.has('contracts.read')).toBe(false);
    expect(caps.has('catalog.read')).toBe(true);
    expect(caps.has('rights.write')).toBe(true);
  });

  it('capabilityEntitled answers per capability', () => {
    expect(capabilityEntitled('catalog.read', new Set())).toBe(true);
    expect(capabilityEntitled('contracts.read', new Set())).toBe(false);
    expect(capabilityEntitled('contracts.read', new Set(['contracts']))).toBe(true);
    expect(capabilityEntitled('finance.read', new Set(['contracts']))).toBe(false);
  });
});

describe('caps', () => {
  it('null is unlimited', () => {
    expect(seatLimitError(10_000, null)).toBeNull();
    expect(artistLimitError(10_000, null)).toBeNull();
  });

  it('refuses the one that would exceed', () => {
    expect(seatLimitError(2, 3)).toBeNull();
    expect(seatLimitError(3, 3)).toMatch(/all 3 of its seats/);
    expect(seatLimitError(4, 3)).not.toBeNull();
    expect(artistLimitError(0, 1)).toBeNull();
    expect(artistLimitError(1, 1)).toMatch(/already has 1 artist,/);
    expect(artistLimitError(2, 2)).toMatch(/2 artists/);
    expect(artistLimitError(0, 0)).not.toBeNull();
  });

  it('roster artists do not take seats', () => {
    expect(takesSeat('artist')).toBe(false);
    for (const r of ['owner', 'admin', 'member']) expect(takesSeat(r)).toBe(true);
  });
});
