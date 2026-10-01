/**
 * POST /api/org/join — read or accept an org invitation (LABEL-08, W1).
 *
 * The one Label OS route a signed-in NON-member reaches: src/proxy.ts gives
 * exactly this path gate `session` (lib/security/api-gate.ts), because the
 * invitee is not a member of anything until this request makes them one.
 * Everything else is decided here:
 *
 *  - `{ token, action: 'preview' }` — what the invitation is for (org name and
 *    kind, role, functions, state). No session needed: the join page shows it
 *    before sign-in. Never the invited email; when signed in, only whether
 *    the session's email matches.
 *  - `{ token, action: 'accept' }` — session required (401). The SQL function
 *    `labelos_accept_invitation` (migration 138, service role only) checks
 *    token hash + the account's email + revoked + used + expiry and writes the
 *    membership and the `member.joined` audit event in one transaction.
 *    Accepting twice is idempotent. A mismatch is 403 without the address.
 *
 * The token travels in the body (never an API query string) and this route
 * never logs or echoes it. Attempts are rate-limited per client.
 */
import { NextRequest, NextResponse } from 'next/server';
import { liveMembership, sessionIdentity } from '@/lib/auth/org-access';
import { createServiceClient } from '@/lib/auth/ownership';
import { normalizeEmailOrNull } from '@/lib/contacts/email';
import { OrgJoinBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import {
  ACCEPT_INVITATION_RPC,
  hashInvitationToken,
  interpretAcceptResult,
  invitationState,
  isWellFormedInvitationToken,
} from '@/lib/labelos/invitations';
import { createLogger } from '@/lib/log';
import { clientIp, rateLimitDurable } from '@/lib/security/rate-limit';
import { readBody } from '@/lib/validate';

const log = createLogger('api.org.join');

const NOT_FOUND = () => NextResponse.json({ error: 'This invitation does not exist', code: 'not_found' }, { status: 404 });

type PreviewRow = {
  org_id: string;
  email: string;
  role: string;
  functions: string[] | null;
  project_id: string | null;
  invited_by: string | null;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  organizations: { name: string; slug: string; kind: string; deleted_at: string | null } | { name: string; slug: string; kind: string; deleted_at: string | null }[] | null;
};

export async function POST(req: NextRequest) {
  const parsed = await readBody(req, OrgJoinBodySchema);
  if (!parsed.ok) return parsed.res;
  const { token, action } = parsed.data;

  const session = await sessionIdentity();
  const who = session ? `u:${session.userId}` : `ip:${clientIp(req)}`;
  if (!(await rateLimitDurable(`org-join:${who}`, 20, 60 * 1000))) {
    return NextResponse.json({ error: 'Too many attempts. Try again in a minute.' }, { status: 429 });
  }

  if (action === 'accept' && !session) {
    return NextResponse.json({ error: 'Sign in to accept this invitation' }, { status: 401 });
  }
  if (!isWellFormedInvitationToken(token)) return NOT_FOUND();
  const tokenHash = hashInvitationToken(token);
  const admin = createServiceClient();

  try {
    if (action === 'preview') {
      const { data, error } = await admin
        .from('org_invitations')
        .select('org_id, email, role, functions, project_id, invited_by, expires_at, accepted_at, revoked_at, organizations!inner(name, slug, kind, deleted_at)')
        .eq('token_hash', tokenHash)
        .maybeSingle();
      if (error) throw new Error(error.message);
      const row = data as PreviewRow | null;
      const org = row ? (Array.isArray(row.organizations) ? row.organizations[0] : row.organizations) : null;
      if (!row || !org || org.deleted_at || row.project_id || row.role === 'owner') return NOT_FOUND();

      let emailMatches: boolean | null = null;
      let member = false;
      if (session) {
        emailMatches = normalizeEmailOrNull(session.email) === row.email;
        if (emailMatches) member = (await liveMembership(admin, row.org_id, session.userId)) !== null;
      }

      // Same rule as labelos_accept_invitation: an invitation whose inviter
      // no longer holds members.manage reads as withdrawn.
      let state = invitationState(row);
      if (state === 'pending') {
        const inviter = row.invited_by ? await liveMembership(admin, row.org_id, row.invited_by) : null;
        if (!inviter?.capabilities.has('members.manage')) state = 'revoked';
      }

      return NextResponse.json({
        org: { name: org.name, kind: org.kind, ...(member ? { slug: org.slug } : {}) },
        role: row.role,
        functions: row.functions ?? [],
        state,
        signedIn: !!session,
        emailMatches,
        member,
      });
    }

    const { data, error } = await admin.rpc(ACCEPT_INVITATION_RPC, { p_token_hash: tokenHash, p_user: session!.userId });
    const outcome = interpretAcceptResult(data, error);
    if (!outcome.ok) {
      if (outcome.status >= 500) log.error('accept failed', { code: outcome.code, error: error?.message });
      else log.info('accept refused', { code: outcome.code });
      return NextResponse.json({ error: outcome.message, code: outcome.code }, { status: outcome.status });
    }

    const { data: org } = await admin.from('organizations').select('name, slug, kind').eq('id', outcome.orgId).maybeSingle();
    const o = org as { name: string; slug: string; kind: string } | null;
    return NextResponse.json({
      joined: true,
      alreadyMember: outcome.alreadyMember,
      org: { id: outcome.orgId, name: o?.name ?? null, slug: o?.slug ?? null, kind: o?.kind ?? null },
    });
  } catch (err) {
    log.error('join failed', { action, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not read the invitation' }, { status: 500 });
  }
}
