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

/** True when the proxy must check the caller is the producer. */
export function requiresProducerForApi(pathname: string, signedIn: boolean): boolean {
  return signedIn && pathname.startsWith('/api/') && !isPublicApiPath(pathname);
}
