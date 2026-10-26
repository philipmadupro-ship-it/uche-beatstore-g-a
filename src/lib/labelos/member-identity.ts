/**
 * Who each org member is, for the members page (LABEL-09). Members have no
 * row of their own beyond `org_members`, so the name and email are pieced
 * together, best source first:
 *
 *  - name: `user_profiles.display_name` (Label OS), else
 *    `creator_profiles.display_name` (the producer's storefront name);
 *  - email: the invitation they accepted — 138 records `member.joined` with
 *    its `invitation_id`, and the invitation holds the normalised address —
 *    else the auth user (service role, best effort: the founding owner has
 *    no invitation, and a failure leaves the email unknown, never the page
 *    broken).
 *
 * Every read is keyed by the member ids the caller passes (which the route
 * read through scopedOrgQuery) and, where the table has one, the org.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/log';

const log = createLogger('lib.labelos.member-identity');

export type MemberIdentity = { name: string | null; email: string | null };

type AuthAdmin = { auth?: { admin?: { getUserById?: (id: string) => Promise<{ data: { user: { email?: string | null } | null } | null; error: unknown }> } } };
export type IdentityAdmin = Pick<SupabaseClient, 'from'> & AuthAdmin;

function clean(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** The label the page shows for a member: name, else email, else a neutral word. */
export function memberLabel(identity: MemberIdentity | undefined): string {
  return identity?.name ?? identity?.email ?? 'Member';
}

export async function memberIdentities(
  admin: IdentityAdmin,
  orgId: string,
  userIds: readonly string[],
  opts: { withEmail?: boolean } = {},
): Promise<Map<string, MemberIdentity>> {
  const withEmail = opts.withEmail !== false;
  const out = new Map<string, MemberIdentity>(userIds.map((id) => [id, { name: null, email: null }]));
  if (userIds.length === 0) return out;
  const ids = [...userIds];

  const names = async (table: 'user_profiles' | 'creator_profiles') => {
    try {
      const { data } = await admin.from(table).select('user_id, display_name').in('user_id', ids);
      return (data ?? []) as { user_id: string; display_name: unknown }[];
    } catch {
      return [];
    }
  };
  const joins = async () => {
    try {
      const { data } = await admin
        .from('activity_events')
        .select('subject_id, payload')
        .eq('org_id', orgId)
        .eq('verb', 'member.joined')
        .in('subject_id', ids);
      return (data ?? []) as { subject_id: string; payload: { invitation_id?: unknown } | null }[];
    } catch {
      return [];
    }
  };

  // Emails are looked up only for a caller who will be shown them.
  const [profiles, creators, joined] = await Promise.all([
    names('user_profiles'),
    names('creator_profiles'),
    withEmail ? joins() : Promise.resolve([]),
  ]);

  for (const row of [...creators, ...profiles]) {
    const name = clean(row.display_name);
    const entry = out.get(row.user_id);
    if (entry && name) entry.name = name; // profiles last: Label OS name wins
  }

  const invitationOf = new Map<string, string>();
  for (const row of joined) {
    const inv = row.payload?.invitation_id;
    if (typeof inv === 'string' && out.has(row.subject_id)) invitationOf.set(inv, row.subject_id);
  }
  if (invitationOf.size > 0) {
    try {
      const { data } = await admin
        .from('org_invitations')
        .select('id, email')
        .eq('org_id', orgId)
        .in('id', [...invitationOf.keys()]);
      for (const row of (data ?? []) as { id: string; email: unknown }[]) {
        const entry = out.get(invitationOf.get(row.id) ?? '');
        const email = clean(row.email);
        if (entry && email) entry.email = email;
      }
    } catch {
      // Leave the emails unknown.
    }
  }

  const getUserById = admin.auth?.admin?.getUserById;
  if (withEmail && getUserById) {
    await Promise.all(
      [...out.entries()]
        .filter(([, v]) => !v.email)
        .map(async ([id, v]) => {
          try {
            const { data } = await getUserById.call(admin.auth!.admin, id);
            v.email = clean(data?.user?.email)?.toLowerCase() ?? null;
          } catch (err) {
            log.debug('auth user read failed', { error: err instanceof Error ? err.message : String(err) });
          }
        }),
    );
  }
  return out;
}
