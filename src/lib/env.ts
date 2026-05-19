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
