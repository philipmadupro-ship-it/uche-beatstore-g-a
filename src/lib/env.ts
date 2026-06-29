/**
 * Defensive env-var readers.
 *
 * Operators paste values into the Vercel / hosting dashboard with
 * surprising amounts of trailing whitespace and zero-width characters.
 * NEXT_PUBLIC_APP_URL with a trailing \n produces Stripe redirect
 * URLs like "https://app.com\n/projects/share/abc" — parses, redirects,
 * 404s. This module exists so we never read process.env.* directly
 * for URL-shaped values.
 */

/** Strip surrounding whitespace + trailing slash from a URL env var. */
function cleanUrl(raw: string | undefined): string {
  return (raw ?? '').trim().replace(/\/$/, '');
}

/**
 * Public app URL — used in email/Stripe success URLs/share-link
 * builders. Returns a clean string with no trailing slash and no
 * accidental whitespace. Falls back to localhost only when the
 * env var is genuinely unset.
 */
export function getAppUrl(): string {
  const v = cleanUrl(process.env.NEXT_PUBLIC_APP_URL);
  return v || 'http://localhost:3000';
}

/**
 * Required production environment variables, grouped by the capability they
 * unlock. A blank/whitespace value counts as missing — operators paste empty
 * strings surprisingly often. This is the single source of truth for "is this
 * deploy actually configured", surfaced by GET /api/health and usable as a
 * startup gate.
 */
export const REQUIRED_ENV: Record<string, string[]> = {
  supabase: ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'],
  storage: [
    'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY',
    'R2_BUCKET_NAME', 'NEXT_PUBLIC_R2_PUBLIC_URL',
  ],
  email: ['RESEND_API_KEY', 'RESEND_FROM_EMAIL'],
  stripe: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY'],
  app: ['NEXT_PUBLIC_APP_URL', 'CRON_SECRET'],
};

export interface EnvReport {
  ok: boolean;
  missing: string[];
  byGroup: Record<string, { ok: boolean; missing: string[] }>;
}

function present(name: string): boolean {
  return (process.env[name] ?? '').trim().length > 0;
}

/** Check all REQUIRED_ENV vars. Never throws — returns a structured report. */
export function validateEnv(): EnvReport {
  const missing: string[] = [];
  const byGroup: EnvReport['byGroup'] = {};
  for (const [group, vars] of Object.entries(REQUIRED_ENV)) {
    const groupMissing = vars.filter((v) => !present(v));
    byGroup[group] = { ok: groupMissing.length === 0, missing: groupMissing };
    missing.push(...groupMissing);
  }
  return { ok: missing.length === 0, missing, byGroup };
}

/**
 * Fail-fast gate. Call from a server-only entry point in production to refuse
 * to run misconfigured (e.g. a route's module scope, or instrumentation).
 * No-op in dev / local-store mode so the offline path keeps working.
 */
export function assertEnv(): void {
  if (process.env.NODE_ENV !== 'production') return;
  const report = validateEnv();
  if (!report.ok) {
    throw new Error(`Missing required environment variables: ${report.missing.join(', ')}`);
  }
}
