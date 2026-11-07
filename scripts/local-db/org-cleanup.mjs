// When the local gateway ages `organizations.deleted_at` before forwarding a DELETE.
//
// Migration 195 lets an organization row go only 30 days after it was scheduled for deletion (the purge). The e2e
// specs clean up their orgs with the service key, so those deletes need the grace period to have passed. Only a request
// that carries the test-only header below gets that; the header is set by playwright.config.ts on the specs' own request
// contexts and by no app code. The app's own service-role client therefore still meets the real refusal, so a route that
// deletes an org too early still fails e2e.
import { verify } from './jwt.mjs';

export const ORG_CLEANUP_HEADER = 'x-e2e-org-cleanup';

/** `headers` are Node's lower-cased request headers. */
export function shouldAgeOrgDelete({ method, pathname, headers }) {
  if (method !== 'DELETE' || pathname !== '/rest/v1/organizations') return false;
  if (headers[ORG_CLEANUP_HEADER] !== '1') return false;
  return verify(String(headers.authorization ?? '').replace(/^Bearer /, ''))?.role === 'service_role';
}
