/**
 * /api/org/[orgId]/members (LABEL-09, 07 §2.6, 06 §2):
 *
 *  GET     every member of the org. Any member may read the list (136's RLS
 *          lets members read co-members); emails only for callers who manage
 *          members. `contact_ids` (LABEL-10) is an artists-scoped member's
 *          roster list, shown to managers for everyone and to each member
 *          for themselves (139's RLS on member_artist_scopes: the same rule).
 *  PATCH   { user_id, role?, functions?, scope?, cap_grants?, cap_revokes? }
 *          — capability `members.manage`. What may change, and by whom, is
 *          `planMemberChange` (lib/labelos/members): kind-offered roles and
 *          functions only, never `owner`, never a NEVER_GRANTABLE switch, an
 *          owner row only by an owner, nobody raises themselves.
 *  DELETE  ?user_id= — capability `members.manage`; an owner only by an owner.
 *
 * Artist scope rows (member_artist_scopes, LABEL-10) follow the membership:
 * a change that leaves a member seeing the whole org clears their list (so
 * a later limit starts from none, never from a list nobody chose for it),
 * named in the event's payload.
 *
 * The last owner is never demoted or removed: 409, checked here and held by
 * 136's deferred trigger, whose error is answered as the same 409 rather
 * than a raw database error. Each change is an audit event (member.*) written
 * by the database function that makes the change (LABEL-19, migration 146):
 * the change, the cleared artist list and the event are one transaction, so
 * if the event cannot be written none of it happened.
 *
 * A member row is addressed by (org, user) through `memberRowQuery`, never a
 * `user_id` filter in this file.
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  memberRowQuery,
  requireOrgCapability,
  requireOrgMember,
  scopedOrgQuery,
  type OrgAccessOk,
} from '@/lib/auth/org-access';
import { OrgMemberPatchBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { AUDIT_RPC_NOT_READY, auditRpc, isMissingAuditRpc } from '@/lib/labelos/audit-rpc';
import { memberIdentities, type IdentityAdmin } from '@/lib/labelos/member-identity';
import { planMemberChange, planMemberRemoval, type MemberState } from '@/lib/labelos/members';
import { toArtistScope } from '@/lib/labelos/artist-scope';
import { createLogger } from '@/lib/log';
import { isUUID, readBody } from '@/lib/validate';

const log = createLogger('api.org.members');

const COLUMNS = 'user_id, role, functions, scope, cap_grants, cap_revokes, joined_at, invited_by';

type MemberRow = {
  user_id: string;
  role: string;
  functions: string[] | null;
  scope: string;
  cap_grants: string[] | null;
  cap_revokes: string[] | null;
  joined_at: string;
  invited_by: string | null;
};

function toState(row: MemberRow): MemberState {
  return {
    userId: row.user_id,
    role: row.role,
    functions: row.functions ?? [],
    scope: row.scope,
    capGrants: row.cap_grants ?? [],
    capRevokes: row.cap_revokes ?? [],
  };
}

function toView(
  row: MemberRow,
  viewer: string,
  identity?: { name: string | null; email: string | null },
  withEmail = false,
  contactIds: string[] | null = null,
) {
  return {
    user_id: row.user_id,
    name: identity?.name ?? null,
    email: withEmail ? identity?.email ?? null : null,
    role: row.role,
    functions: row.functions ?? [],
    scope: row.scope,
    cap_grants: row.cap_grants ?? [],
    cap_revokes: row.cap_revokes ?? [],
    joined_at: row.joined_at,
    is_you: row.user_id.toLowerCase() === viewer.toLowerCase(),
    /** null = not shown to this viewer, or the member sees the whole org. */
    contact_ids: contactIds,
  };
}

/** Each artists-scoped member's roster list, as this viewer may see it. */
async function scopeLists(access: OrgAccessOk, rows: MemberRow[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const scoped = rows.filter((r) => toArtistScope(r.role, r.scope, []) !== null);
  if (scoped.length === 0) return out;
  if (access.capabilities.has('members.manage')) {
    const { data, error } = await scopedOrgQuery(access.admin, 'member_artist_scopes', access, 'user_id, contact_id');
    if (error) throw new Error(error.message);
    for (const r of scoped) out.set(r.user_id, []);
    for (const s of (data ?? []) as unknown as { user_id: string; contact_id: string }[]) {
      out.get(s.user_id)?.push(s.contact_id);
    }
  } else if (access.artistScope !== null) {
    // Only their own: the list the access helper already read.
    out.set(access.userId, [...access.artistScope]);
  }
  for (const list of out.values()) list.sort();
  return out;
}

/**
 * 136's "≥1 owner" constraint trigger, raised at commit. Matched on its own
 * message, not on SQLSTATE 23514 alone: every CHECK constraint on
 * org_members raises that code too, and those are real 500s.
 */
function isLastOwnerError(error: { code?: string; message?: string } | null): boolean {
  return !!error && /must keep at least one owner/i.test(error.message ?? '');
}

const LAST_OWNER = 'An organization must keep at least one owner. Make someone else owner first.';

async function ownerCount(access: OrgAccessOk): Promise<number> {
  const { count, error } = await scopedOrgQuery(access.admin, 'org_members', access, 'user_id', { count: 'exact', head: true })
    .eq('role', 'owner');
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function readMember(access: OrgAccessOk, userId: string): Promise<MemberRow | null> {
  const { data, error } = await memberRowQuery(access.admin, access, userId).select(COLUMNS).maybeSingle();
  if (error) throw new Error(error.message);
  return data as MemberRow | null;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const access = await requireOrgMember(orgId);
  if (!access.ok) return access.res;
  try {
    const { data, error } = await scopedOrgQuery(access.admin, 'org_members', access, COLUMNS).order('joined_at', { ascending: true });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as MemberRow[];
    const withEmail = access.capabilities.has('members.manage');
    const [ids, lists] = await Promise.all([
      memberIdentities(access.admin as unknown as IdentityAdmin, access.orgId, rows.map((r) => r.user_id), { withEmail }),
      scopeLists(access, rows),
    ]);
    return NextResponse.json(
      { members: rows.map((r) => toView(r, access.userId, ids.get(r.user_id), withEmail, lists.get(r.user_id) ?? null)) },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    log.error('list members failed', { orgId: access.orgId, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not list members' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const access = await requireOrgCapability(orgId, 'members.manage');
  if (!access.ok) return access.res;

  const parsed = await readBody(req, OrgMemberPatchBodySchema);
  if (!parsed.ok) return parsed.res;
  const { user_id: userId, ...change } = parsed.data;
  const { admin } = access;

  try {
    const before = await readMember(access, userId);
    if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const plan = planMemberChange(
      access.orgKind,
      { userId: access.userId, role: access.role },
      toState(before),
      change,
      before.role === 'owner' ? await ownerCount(access) : 0,
    );
    if (!plan.ok) return NextResponse.json({ error: plan.error }, { status: plan.status });
    if (plan.noop) return NextResponse.json({ member: toView(before, access.userId) });

    // The change, the cleared artist list (a member now seeing the whole org
    // starts a later limit from none; the function decides that from the row
    // under its lock) and the audit event: one transaction.
    const { data: result, error: rpcErr } = await auditRpc(admin, 'memberUpdate', {
      p_org: access.orgId,
      p_actor: access.userId,
      p_user: userId,
      p_patch: plan.patch,
      p_verb: plan.event!.verb,
      p_payload: plan.event!.payload,
    });
    if (isMissingAuditRpc(rpcErr)) return NextResponse.json({ error: AUDIT_RPC_NOT_READY }, { status: 503 });
    if (isLastOwnerError(rpcErr)) return NextResponse.json({ error: LAST_OWNER }, { status: 409 });
    if (rpcErr) throw new Error(rpcErr.message);
    if (result?.error === 'not_found') return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const after = (result?.member ?? null) as MemberRow | null;
    if (!after) throw new Error('member update returned no row');
    return NextResponse.json({ member: toView(after, access.userId) });
  } catch (err) {
    log.error('change member failed', { orgId: access.orgId, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not change the member' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const access = await requireOrgCapability(orgId, 'members.manage');
  if (!access.ok) return access.res;

  const userId = req.nextUrl.searchParams.get('user_id') ?? '';
  if (!isUUID(userId)) return NextResponse.json({ error: 'user_id must be a uuid' }, { status: 400 });
  const { admin } = access;

  try {
    const before = await readMember(access, userId);
    if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const plan = planMemberRemoval(
      { userId: access.userId, role: access.role },
      toState(before),
      before.role === 'owner' ? await ownerCount(access) : 0,
    );
    if (!plan.ok) return NextResponse.json({ error: plan.error }, { status: plan.status });

    // The membership (its artist list goes with it) and `member.removed`: one transaction.
    const { data: result, error: rpcErr } = await auditRpc(admin, 'memberRemove', {
      p_org: access.orgId,
      p_actor: access.userId,
      p_user: userId,
      p_payload: { role: before.role, functions: before.functions ?? [], scope: before.scope },
    });
    if (isMissingAuditRpc(rpcErr)) return NextResponse.json({ error: AUDIT_RPC_NOT_READY }, { status: 503 });
    if (isLastOwnerError(rpcErr)) return NextResponse.json({ error: LAST_OWNER }, { status: 409 });
    if (rpcErr) throw new Error(rpcErr.message);
    if (result?.error === 'not_found') return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ removed: true });
  } catch (err) {
    log.error('remove member failed', { orgId: access.orgId, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not remove the member' }, { status: 500 });
  }
}
