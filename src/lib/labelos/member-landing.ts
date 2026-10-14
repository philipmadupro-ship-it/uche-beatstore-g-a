/**
 * Where src/proxy.ts sends a signed-in NON-producer who has a Label OS
 * membership, when they open `/login` or a producer dashboard page.
 *
 * Without this a returning label member (not the producer, so no
 * `creator_profiles` row) who signs in at `/login`, or types the bare domain
 * (`/` → `/library`), was sent to the buyer account page with no way to their
 * label. `next` is honoured only for the Label OS page namespaces — never for
 * any other path, so this does not loosen the rule that keeps non-producers
 * out of the dashboard.
 */

/** `/o`, `/o/…`, `/join/…`, `/shared`, `/shared/…`: same-origin, no `//`, `\`, `.` segments or control characters. */
export function isLabelOsNextPath(raw: string | null | undefined): raw is string {
  if (!raw || raw.length > 2048) return false;
  if (!/^\/(?!\/)/.test(raw)) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return false;
  const [pathOnly] = raw.split(/[?#]/);
  if (pathOnly.split('/').some((seg) => seg === '.' || seg === '..' || /^%2e$/i.test(seg) || /^%2e%2e$/i.test(seg))) return false;
  return /^\/(?:o(?:\/|$)|join\/[^/]|shared(?:\/|$))/.test(pathOnly);
}

/** The path + query to redirect a member to. `/o` resolves the org (one org opens straight away). */
export function memberLanding(pathname: string, nextParam: string | null): string {
  if (pathname === '/login' && isLabelOsNextPath(nextParam)) return nextParam;
  return '/o';
}
