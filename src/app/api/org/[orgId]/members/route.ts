/**
 * /api/org/[orgId]/members (LABEL-09, 07 §2.6, 06 §2):
 *
 *  GET     every member of the org. Any member may read the list (136's RLS
 *          lets members read co-members); emails only for callers who manage
 *          members.
 *  PATCH   { user_id, role?, functions?, scope?, cap_grants?, cap_revokes? }
 *          — capability `members.manage`. What may change, and by whom, is
 *          `planMemberChange` (lib/labelos/members): kind-offered roles and
 *          functions only, never `owner`, never a NEVER_GRANTABLE switch, an
 *          owner row only by an owner, nobody raises themselves.
 *  DELETE  ?user_id= — capability `members.manage`; an owner only by an owner.
 *
 * The last owner is never demoted or removed: 409, checked here and held by
 * 136's deferred trigger, whose error is answered as the same 409 rather
 * than a raw database error. Each change is an audit event (member.*); if it
 * cannot be written the change is undone and the request fails.
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
import { recordEvent } from '@/lib/labelos/activity';
import { memberIdentities, type IdentityAdmin } from '@/lib/labelos/member-identity';
import { planMemberChange, planMemberRemoval, type MemberState } from '@/lib/labelos/members';
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

function toView(row: MemberRow, viewer: string, identity?: { name: string | null; email: string | null }, withEmail = false) {
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
  };
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
    const ids = await memberIdentities(access.admin as unknown as IdentityAdmin, access.orgId, rows.map((r) => r.user_id), { withEmail });
    return NextResponse.json(
      { members: rows.map((r) => toView(r, access.userId, ids.get(r.user_id), withEmail)) },
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

    const { data: updated, error: updateErr } = await memberRowQuery(admin, access, userId).update(plan.patch).select(COLUMNS);
    if (isLastOwnerError(updateErr)) return NextResponse.json({ error: LAST_OWNER }, { status: 409 });
    if (updateErr) throw new Error(updateErr.message);
    const after = (Array.isArray(updated) ? updated[0] : null) as MemberRow | null;
    if (!after) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    try {
      if (plan.event) {
        await recordEvent(
          admin,
          { orgId: access.orgId, userId: access.userId },
          plan.event.verb,
          { type: 'member', id: userId },
          plan.event.payload,
        );
      }
    } catch (err) {
      // A change nobody can account for must not stand: put back exactly the
      // fields this request changed. (One event per request, so nothing of
      // it was recorded.) supabase-js resolves with { error }, so check it.
      const revert: Record<string, unknown> = {};
      for (const key of Object.keys(plan.patch) as (keyof MemberRow)[]) revert[key] = before[key];
      const { error: revertErr } = await memberRowQuery(admin, access, userId).update(revert);
      if (revertErr) log.error('reverting an unaudited member change failed', { orgId: access.orgId, error: revertErr.message });
      throw err;
    }
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

    const { data: removed, error: deleteErr } = await memberRowQuery(admin, access, userId).delete().select('user_id');
    if (isLastOwnerError(deleteErr)) return NextResponse.json({ error: LAST_OWNER }, { status: 409 });
    if (deleteErr) throw new Error(deleteErr.message);
    if (!Array.isArray(removed) || removed.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    try {
      await recordEvent(
        admin,
        { orgId: access.orgId, userId: access.userId },
        'member.removed',
        { type: 'member', id: userId },
        { role: before.role, functions: before.functions ?? [], scope: before.scope },
      );
    } catch (err) {
      // Removal with no audit row must not stand: restore the membership.
      // A full row in this org, written by the service role (136 has no
      // insert policy; this is the same path invitation-accept uses).
      const { error: restoreErr } = await admin.from('org_members').insert({ org_id: access.orgId, ...before });
      if (restoreErr) log.error('restoring a removed member failed', { orgId: access.orgId, error: restoreErr.message });
      throw err;
    }
    return NextResponse.json({ removed: true });
  } catch (err) {
    log.error('remove member failed', { orgId: access.orgId, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not remove the member' }, { status: 500 });
  }
}
