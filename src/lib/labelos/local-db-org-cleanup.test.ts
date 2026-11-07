import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain ESM helper of the local verification stack
import { shouldAgeOrgDelete, ORG_CLEANUP_HEADER } from '../../../scripts/local-db/org-cleanup.mjs';
// @ts-expect-error — plain ESM helper of the local verification stack
import { SERVICE_KEY, ANON_KEY } from '../../../scripts/local-db/jwt.mjs';

const base = { method: 'DELETE', pathname: '/rest/v1/organizations' };
const bearer = (k: string) => ({ authorization: `Bearer ${k}` });

describe('local gateway: when an organization DELETE gets its grace period aged (migration 195 test cleanup)', () => {
  it('only with the test header AND the service role', () => {
    expect(shouldAgeOrgDelete({ ...base, headers: { ...bearer(SERVICE_KEY), [ORG_CLEANUP_HEADER]: '1' } })).toBe(true);
  });
  it('the app\'s own service-role delete (no header) is forwarded untouched and meets the guard', () => {
    expect(shouldAgeOrgDelete({ ...base, headers: bearer(SERVICE_KEY) })).toBe(false);
  });
  it('a wrong header value, a user or anon key, another method or another table never qualify', () => {
    expect(shouldAgeOrgDelete({ ...base, headers: { ...bearer(SERVICE_KEY), [ORG_CLEANUP_HEADER]: '0' } })).toBe(false);
    expect(shouldAgeOrgDelete({ ...base, headers: { ...bearer(ANON_KEY), [ORG_CLEANUP_HEADER]: '1' } })).toBe(false);
    expect(shouldAgeOrgDelete({ ...base, headers: { [ORG_CLEANUP_HEADER]: '1' } })).toBe(false);
    expect(shouldAgeOrgDelete({ method: 'PATCH', pathname: base.pathname, headers: { ...bearer(SERVICE_KEY), [ORG_CLEANUP_HEADER]: '1' } })).toBe(false);
    expect(shouldAgeOrgDelete({ method: 'DELETE', pathname: '/rest/v1/org_members', headers: { ...bearer(SERVICE_KEY), [ORG_CLEANUP_HEADER]: '1' } })).toBe(false);
  });
});
