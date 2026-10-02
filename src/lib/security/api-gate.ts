/**
 * Which /api routes a signed-in NON-producer may reach.
 *
 * Buyers sign in through the same Supabase auth as the producer (magic link /
 * Google at /store/account), so "authenticated" is not "producer". Dozens of
 * dashboard routes gated on requireUser() alone, which let any buyer send
 * email from the verified domain, write to R2, spend AI credits and so on.
 * src/proxy.ts now refuses every /api path NOT listed here to a signed-in user
 * who has no creator_profiles row, the same test it already uses to keep
 * buyers out of dashboard pages.
 *
 * Signed-OUT requests are not touched: their routes answer 401 themselves,
 * and cron/webhook routes authenticate with a bearer or a signature instead
 * of a session.
 *
 * Add a path here only for a route a buyer or share recipient legitimately
 * calls, and make sure that route does its own authorisation.
 */
const PUBLIC_PREFIXES = [
  '/api/store',          // storefront, checkout, buyer account (/api/store/me)
  '/api/share/',         // legacy share pages (HMAC media grants)
  '/api/projects/share/',// project share pages
  '/api/portal/',        // artist portals (token-gated in lib/artist-portal/gate.ts)
  '/api/stripe/webhook', // signature-verified
  '/api/resend/webhook', // signature-verified
  '/api/cron/',          // CRON_SECRET bearer
  '/api/csp-report',
  '/api/health',
  '/api/whoami',         // reports only the caller's own identity
] as const;

// Share pages log listener playheads for the producer's heatmap. The route
// takes no session and writes only an anonymous ping.
const PUBLIC_PATTERNS = [/^\/api\/tracks\/[^/]+\/heatmap\/?$/];

export function isPublicApiPath(pathname: string): boolean {
  for (const prefix of PUBLIC_PREFIXES) {
    if (prefix.endsWith('/')) {
      if (pathname.startsWith(prefix)) return true;
    } else if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      return true;
    }
  }
  return PUBLIC_PATTERNS.some((re) => re.test(pathname));
}

/**
 * The Label OS API namespace: `/api/org` and everything under `/api/org/`.
 * Look-alikes (`/api/organizations`, `/api/orgs`) are NOT in it and stay
 * producer-only like any other dashboard path.
 */
export function isLabelOsApiPath(pathname: string): boolean {
  return pathname === '/api/org' || pathname.startsWith('/api/org/');
}

/**
 * The one Label OS API path a signed-in NON-member may reach: accepting an
 * invitation (LABEL-08). The invitee is usually not a member of anything
 * yet, so the membership gate would refuse the very request that makes them
 * one. Exact match only — nothing below it, nothing beside it. The route
 * itself requires a session and checks token hash + email + expiry + revoked
 * + used (lib/labelos/invitations.ts, migration 138).
 */
export function isLabelOsJoinApiPath(pathname: string): boolean {
  return pathname === '/api/org/join';
}

/**
 * The invitation page, `/join/<token>`: behind the flag like `/o/*`, but
 * open to signed-out visitors (it signs them in itself) and to non-members.
 */
export function isLabelOsJoinPagePath(pathname: string): boolean {
  return /^\/join\/[^/]+\/?$/.test(pathname);
}

/**
 * The Label OS page namespace: `/o` and everything under `/o/`. Exact segment
 * match, because `/offline` and `/orders`-style paths share the letter.
 */
export function isLabelOsPagePath(pathname: string): boolean {
  return pathname === '/o' || pathname.startsWith('/o/');
}

/**
 * Which check the proxy runs on an /api request from this caller:
 *  - `none`     signed out, a public route, or not an /api path at all;
 *  - `member`   a Label OS path: the caller must belong to some org (or, from
 *               LABEL-21, some project). This is coarse admission only; the
 *               routes check org and capability (lib/auth/org-access.ts);
 *  - `session`  `/api/org/join` only: being signed in is enough to reach the
 *               route, which does all of the authorisation itself;
 *  - `producer` everything else: the caller must be the producer.
 *
 * Membership NEVER admits anyone to a `producer` path. That isolation is the
 * point of the separate namespace (06-permission-model.md §3.3, risk R-03).
 */
export type ApiGate = 'none' | 'session' | 'member' | 'producer';

export function apiGateFor(pathname: string, signedIn: boolean): ApiGate {
  if (!signedIn || !pathname.startsWith('/api/')) return 'none';
  if (isLabelOsJoinApiPath(pathname)) return 'session';
  if (isLabelOsApiPath(pathname)) return 'member';
  if (isPublicApiPath(pathname)) return 'none';
  return 'producer';
}

/** True when the proxy must check the caller is the producer. */
export function requiresProducerForApi(pathname: string, signedIn: boolean): boolean {
  return apiGateFor(pathname, signedIn) === 'producer';
}
