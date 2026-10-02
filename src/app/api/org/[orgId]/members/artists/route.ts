/**
 * /api/org/[orgId]/members/artists — which roster artists an
 * artists-scoped member sees (LABEL-10, 06 §2.5; the roster picker on the
 * members page).
 *
 *  GET  ?user_id=  the member's list. Anyone may read their own; reading
 *                  someone else's needs `members.manage` (139's RLS: the
 *                  same rule).
 *  PUT  { user_id, contact_ids }  capability `members.manage`. Replaces the
 *       list. Only for a member who is limited to some artists (role
 *       `artist`, or scope `artists` — change the scope with PATCH
 *       /members first); every id must be a contact of THIS org. An empty
 *       list is allowed: the member then sees nothing. Audited as
 *       `member.artists_changed`; if the event cannot be written the list
 *       is put back and the request fails.
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
import { recordEvent } from '@/lib/labelos/activity';
import { toArtistScope } from '@/lib/labelos/artist-scope';
import { missingOrgContacts } from '@/lib/labelos/org-contacts';
import { createLogger } from '@/lib/log';
import { isUUID, readBody } from '@/lib/validate';

const log = createLogger('api.org.members.artists');

type MemberRow = { role: string; scope: string };

async function readMember(access: OrgAccessOk, userId: string): Promise<MemberRow | null> {
  const { data, error } = await memberRowQuery(access.admin, access, userId).select('role, scope').maybeSingle();
  if (error) throw new Error(error.message);
  return data as MemberRow | null;
}

async function readList(access: OrgAccessOk, userId: string): Promise<string[]> {
  const { data, error } = await memberArtistScopeQuery(access.admin, access, userId).select();
  if (error) throw new Error(error.message);
  return ((data ?? []) as { contact_id: string }[]).map((r) => r.contact_id.toLowerCase()).sort();
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
      { user_id: userId, scoped, contact_ids: scoped ? await readList(access, userId) : [] },
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

    const missing = await missingOrgContacts(access.admin, access, wanted);
    if (missing.length > 0) {
      return NextResponse.json({ error: 'Some artists are not in this organization', contact_ids: missing }, { status: 400 });
    }

    const before = await readList(access, userId);
    if (before.length === wanted.length && before.every((id, i) => id === wanted[i])) {
      return NextResponse.json({ user_id: userId, scoped: true, contact_ids: before });
    }

    const scopes = memberArtistScopeQuery(access.admin, access, userId);
    const { error: writeErr } = await scopes.replace(wanted);
    if (writeErr) {
      // replace() fails narrow; put the old list back rather than leave a
      // list nobody chose.
      const { error: revertErr } = await scopes.replace(before);
      if (revertErr) log.error('restoring an artist scope after a failed change failed', { orgId: access.orgId, error: revertErr.message });
      throw new Error(writeErr.message);
    }

    try {
      await recordEvent(
        access.admin,
        { orgId: access.orgId, userId: access.userId },
        'member.artists_changed',
        { type: 'member', id: userId },
        { from: before, to: wanted },
      );
    } catch (err) {
      // A scope change nobody can account for must not stand.
      const { error: revertErr } = await scopes.replace(before);
      if (revertErr) log.error('reverting an unaudited artist scope failed', { orgId: access.orgId, error: revertErr.message });
      throw err;
    }
    return NextResponse.json({ user_id: userId, scoped: true, contact_ids: wanted });
  } catch (err) {
    log.error('change member artists failed', { orgId: access.orgId, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not change the member’s artists' }, { status: 500 });
  }
}
