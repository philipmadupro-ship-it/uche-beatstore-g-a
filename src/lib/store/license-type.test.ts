import { describe, it, expect } from 'vitest';
import { resolveLicenseType, type LicenseLike } from './license-type';

const UUID_EXCL = '11111111-1111-4111-8111-111111111111';
const UUID_LEASE = '22222222-2222-4222-8222-222222222222';
const UUID_UNKNOWN = '33333333-3333-4333-8333-333333333333';

const byId = new Map<string, LicenseLike>([
  [UUID_EXCL, { is_exclusive: true }],
  [UUID_LEASE, { is_exclusive: false }],
]);

describe('resolveLicenseType — UUID ids', () => {
  it('resolves an exclusive license row to exclusive', () => {
    expect(resolveLicenseType(UUID_EXCL, byId)).toBe('exclusive');
  });

  it('resolves a non-exclusive license row to lease', () => {
    expect(resolveLicenseType(UUID_LEASE, byId)).toBe('lease');
  });

  it('falls back to lease for a UUID not in the map (never auto-delist on unknown)', () => {
    expect(resolveLicenseType(UUID_UNKNOWN, byId)).toBe('lease');
  });

  it('treats a missing is_exclusive as lease', () => {
    const m = new Map<string, LicenseLike>([[UUID_LEASE, {}]]);
    expect(resolveLicenseType(UUID_LEASE, m)).toBe('lease');
  });
});

describe('resolveLicenseType — legacy string ids', () => {
  it('normalises the known exclusive aliases', () => {
    expect(resolveLicenseType('exclusive', byId)).toBe('exclusive');
    expect(resolveLicenseType('exclusive-rights', byId)).toBe('exclusive');
  });

  it('maps lease aliases (and anything unrecognised) to lease', () => {
    expect(resolveLicenseType('lease', byId)).toBe('lease');
    expect(resolveLicenseType('basic-lease', byId)).toBe('lease');
    expect(resolveLicenseType('', byId)).toBe('lease');
    expect(resolveLicenseType('Exclusive', byId)).toBe('lease'); // case-sensitive by design
  });
});

describe('resolveLicenseType — legacy type hint (checkout)', () => {
  it('honours an exclusive hint for an unrecognised/legacy id', () => {
    expect(resolveLicenseType('basic-lease', byId, 'exclusive')).toBe('exclusive');
    expect(resolveLicenseType('', byId, 'exclusive')).toBe('exclusive');
  });

  it('lets the DB row win over the hint for a known UUID', () => {
    expect(resolveLicenseType(UUID_LEASE, byId, 'exclusive')).toBe('lease');
    expect(resolveLicenseType(UUID_EXCL, byId, 'lease')).toBe('exclusive');
  });

  it('falls back to the hint for a UUID not in the map', () => {
    expect(resolveLicenseType(UUID_UNKNOWN, byId, 'exclusive')).toBe('exclusive');
    expect(resolveLicenseType(UUID_UNKNOWN, byId)).toBe('lease'); // no hint → safe default
  });

  it('a non-exclusive hint never escalates to exclusive', () => {
    expect(resolveLicenseType('lease', byId, 'lease')).toBe('lease');
    expect(resolveLicenseType('lease', byId, undefined)).toBe('lease');
  });
});
