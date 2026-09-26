/**
 * A project_access_links row grants bundle downloads until `expires_at`.
 * Refunds and disputes revoke access by setting `expires_at` to now (there is
 * no download_unlocked column on this table), so every path that grants a
 * download from one of these rows — by token OR by Stripe session id — must
 * run this check, or a refunded bundle stays downloadable.
 */
export function isProjectAccessActive(
  row: { expires_at?: string | null } | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!row) return false;
  if (!row.expires_at) return true;
  const t = new Date(row.expires_at).getTime();
  return Number.isFinite(t) && t > now;
}
