/**
 * The error PostgREST answers when `org_id` (mig 141 on tracks / projects)
 * does not exist yet. Narrower than `isMissingSchema` on purpose: a producer
 * read may drop its org filter ONLY because no org row can exist, so the error
 * must name that column, not just any missing object.
 */
export function isMissingOrgColumn(error: unknown): boolean {
  const e = error as { code?: string; message?: string; details?: string } | null;
  if (!e) return false;
  const text = `${e.message ?? ''} ${e.details ?? ''}`;
  if (!/org_id/i.test(text)) return false;
  return e.code === '42703' || e.code === 'PGRST204' || /does not exist|schema cache/i.test(text);
}
