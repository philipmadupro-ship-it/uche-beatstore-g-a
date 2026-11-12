/**
 * /api/org/[orgId]/members/artists — which roster artists an
 * artists-scoped member sees (LABEL-10, 06 §2.5; the roster picker on the
 * members page).
 *
 *  GET  ?user_id=  the member's list. Anyone may read their own; reading
 *                  someone else's needs `members.manage` (139's RLS: the
 *                  same rule).
 *  PUT  { user_id, contact_ids }  capability `members.manage`. Replaces the
 *       list (at most 150). Only for a member who is limited to some artists
 *       (role `artist`, or scope `artists` — change the scope with PATCH
 *       /members first); every id must be on THIS org's roster. An empty
 *       list is allowed: the member then sees nothing. Audited as
 *       `member.artists_changed`; if the event cannot be written the list
 *       is not changed and the request fails: the list and the event are
 *       one transaction (LABEL-19, migration 146).
 *
 * Rows are addressed by (org, user) through `memberArtistScopeQuery` and
 * `memberRowQuery`, never a `user_id` filter in this file.
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  memberArtistScopeQuery,
  memberRowQuery,
  requireOrgCapability,
  requireOrgMember,
  type OrgAccessOk,
} from '@/lib/auth/org-access';
import { OrgMemberArtistsBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { AUDIT_RPC_NOT_READY, auditRpc, isMissingAuditRpc } from '@/lib/labelos/audit-rpc';
import { toArtistScope } from '@/lib/labelos/artist-scope';
import { missingRosterContacts } from '@/lib/labelos/org-contacts';
import { createLogger } from '@/lib/log';
import { isUUID, readBody } from '@/lib/validate';

const log = createLogger('api.org.members.artists');

type MemberRow = { role: string; scope: string };

async function readMember(access: OrgAccessOk, userId: string): Promise<MemberRow | null> {
  const { data, error } = await memberRowQuery(access.admin, access, userId).select('role, scope').maybeSingle();
  if (error) throw new Error(error.message);
  return data as MemberRow | null;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const access = await requireOrgMember(orgId);
  if (!access.ok) return access.res;
  const userId = (req.nextUrl.searchParams.get('user_id') ?? '').toLowerCase();
  if (!isUUID(userId)) return NextResponse.json({ error: 'user_id must be a uuid' }, { status: 400 });
  if (userId !== access.userId.toLowerCase() && !access.capabilities.has('members.manage')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  try {
    const member = await readMember(access, userId);
    if (!member) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const scoped = toArtistScope(member.role, member.scope, []) !== null;
    return NextResponse.json(
      { user_id: userId, scoped, contact_ids: scoped ? await memberArtistScopeQuery(access.admin, access, userId).list() : [] },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    log.error('read member artists failed', { orgId: access.orgId, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not load the member’s artists' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const access = await requireOrgCapability(orgId, 'members.manage');
  if (!access.ok) return access.res;

  const parsed = await readBody(req, OrgMemberArtistsBodySchema);
  if (!parsed.ok) return parsed.res;
  const userId = parsed.data.user_id.toLowerCase();
  const wanted = [...new Set(parsed.data.contact_ids.map((c) => c.toLowerCase()))].sort();

  try {
    const member = await readMember(access, userId);
    if (!member) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (toArtistScope(member.role, member.scope, []) === null) {
      return NextResponse.json(
        { error: 'This member sees the whole organization. Limit them to some artists first.' },
        { status: 400 },
      );
    }

    const missing = await missingRosterContacts(access.admin, access, wanted);
    if (missing.length > 0) {
      return NextResponse.json({ error: 'Some of these are not artists in this organization', contact_ids: missing }, { status: 400 });
    }

    const scopes = memberArtistScopeQuery(access.admin, access, userId);
    const before = await scopes.list();
    if (before.length === wanted.length && before.every((id, i) => id === wanted[i])) {
      return NextResponse.json({ user_id: userId, scoped: true, contact_ids: before });
    }

    // The list and `member.artists_changed` are one transaction. The payload
    // is the change, not both whole lists: it stays small however long the
    // list is (events are capped at 16 KB).
    const { data: result, error: rpcErr } = await auditRpc(access.admin, 'memberArtistsSet', {
      p_org: access.orgId,
      p_actor: access.userId,
      p_user: userId,
      p_contact_ids: wanted,
      p_payload: {
        added: wanted.filter((id) => !before.includes(id)),
        removed: before.filter((id) => !wanted.includes(id)),
        count: wanted.length,
      },
    });
    if (isMissingAuditRpc(rpcErr)) return NextResponse.json({ error: AUDIT_RPC_NOT_READY }, { status: 503 });
    if (rpcErr) throw new Error(rpcErr.message);
    if (result?.error === 'not_found') return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (result?.error === 'not_scoped') {
      // Widened by someone else after this request read the member.
      return NextResponse.json(
        { error: 'This member sees the whole organization. Limit them to some artists first.' },
        { status: 400 },
      );
    }
    return NextResponse.json({ user_id: userId, scoped: true, contact_ids: wanted });
  } catch (err) {
    log.error('change member artists failed', { orgId: access.orgId, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not change the member’s artists' }, { status: 500 });
  }
}
