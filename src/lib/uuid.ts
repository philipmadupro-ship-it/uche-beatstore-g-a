/**
 * The UUID predicate, in a module with no imports so client components can use
 * it too (`@/lib/validate` imports `next/server`, which has no business in a
 * browser bundle). `validate.ts` re-exports it: one definition.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when `s` is a canonical RFC-4122-shaped UUID string. */
export function isUUID(s: unknown): s is string {
  return typeof s === 'string' && UUID_RE.test(s);
}
