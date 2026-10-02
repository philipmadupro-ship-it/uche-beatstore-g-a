/**
 * An org's people directory (LABEL-10, 17-reconciliation R3, Q2): the
 * `contacts` rows whose `org_id` is the org. Kept apart from the producer's
 * CRM in the database itself: an org contact never has a `user_id`
 * (migration 139's contacts_org_or_owner), so no producer route, which
 * filters on the producer's user_id, can ever list one, and nothing the
 * producer owns (org_id IS NULL) is ever read here.
 *
 * What a member sees of it is decided by org-access: capability
 * `catalog.read` and the member's artist scope, applied by
 * `scopedOrgQuery` / `requireObjectAccess`. Routes read through those
 * helpers, never by id alone.
 */
import { scopedOrgQuery, type OrgContext } from '@/lib/auth/org-access';
import type { AdminClient } from '@/lib/auth/ownership';
import { normalizeEmail } from '@/lib/contacts/email';
import { contactGroups, type RoleGroup } from '@/lib/contacts/roles';
import { isUUID } from '@/lib/validate';
import { isRosterContact, NO_WORKSPACE } from './roster';

/** Everything a member sees of an org contact. Never `user_id` (always null). */
export const ORG_CONTACT_COLUMNS =
  'id, name, email, phone, role, label, category, secondary_category, genre, country, city, instagram, twitter, website, notes, crm_status, avatar_url, created_at';

export type OrgContactRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string | null;
  label: string | null;
  category: string | null;
  secondary_category: string | null;
  genre: string | null;
  country: string | null;
  city: string | null;
  instagram: string | null;
  twitter: string | null;
  website: string | null;
  notes: string | null;
  crm_status: string | null;
  avatar_url: string | null;
  created_at: string;
};

export type OrgContactView = OrgContactRow & {
  /** On the artist roster (lib/labelos/roster). */
  in_roster: boolean;
  /** The /contacts role tabs this person belongs in, main first. */
  groups: RoleGroup[];
};

export function toOrgContactView(row: OrgContactRow): OrgContactView {
  return {
    ...row,
    in_roster: isRosterContact(row, NO_WORKSPACE),
    groups: contactGroups(row, false),
  };
}

/**
 * The row a create/patch body writes. Email normalised (lib/contacts/email,
 * CLAUDE.md: on every write); an empty email is no email.
 */
export function toContactWrite<T extends { email?: string | null }>(body: T): T {
  if (body.email === undefined) return body;
  const email = body.email === null ? null : normalizeEmail(body.email);
  return { ...body, email: email ? email : null };
}

/** The org directory's unique (org, email) index (139) refused the write. */
export function isDuplicateEmail(error: { code?: string; message?: string } | null): boolean {
  return !!error && (error.code === '23505' || /contacts_org_email_uniq/.test(error.message ?? ''));
}

export const DUPLICATE_EMAIL = 'Someone with this email is already in the directory.';

/**
 * Which of `ids` are NOT contacts of the context's org (within its scope).
 * For validating a list a request names — invitation contact_ids, a
 * member's artist scope — before writing it. Throws on a database error.
 */
export async function missingOrgContacts(admin: AdminClient, ctx: OrgContext, ids: readonly string[]): Promise<string[]> {
  const wanted = [...new Set(ids.map((id) => id.toLowerCase()))];
  if (wanted.length === 0) return [];
  if (wanted.some((id) => !isUUID(id))) return wanted.filter((id) => !isUUID(id));
  const { data, error } = await scopedOrgQuery(admin, 'contacts', ctx, 'id').in('id', wanted);
  if (error) throw new Error(error.message);
  const found = new Set(((data ?? []) as unknown as { id: string }[]).map((r) => r.id.toLowerCase()));
  return wanted.filter((id) => !found.has(id));
}

/**
 * The categories of EVERY contact in the org, for the artist-org rule
 * (`artistOrgRosterError`, D1). Deliberately not scopedOrgQuery: an
 * invariant over the whole directory must not be judged on the slice a
 * scoped member happens to see. Used only for that check; nothing read
 * here is returned to the caller. Throws on a database error.
 */
export async function orgContactRoles(
  admin: AdminClient,
  ctx: OrgContext,
): Promise<{ id: string; category: string | null; secondary_category: string | null }[]> {
  const { data, error } = await admin.from('contacts').select('id, category, secondary_category').eq('org_id', ctx.orgId);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as { id: string; category: string | null; secondary_category: string | null }[];
}
