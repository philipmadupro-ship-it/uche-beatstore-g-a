/**
 * POST /api/org/setup — a new account creates its own organization
 * (LABEL-48, first slice; src/lib/labelos/setup.ts).
 *
 * Like /api/org/join, a route a signed-in NON-member reaches: src/proxy.ts
 * gives exactly this path gate `session` (lib/security/api-gate.ts), because
 * the caller is not a member of anything until this request makes them one.
 *
 *  - `{ face: 'independent' | 'label', name }`, session required (401).
 *  - `labelos_setup_org` (migration 189, service role only) writes the org
 *    and the caller as owner in one transaction; for an independent artist,
 *    139's trigger adds the org's one roster artist in the same insert.
 *    One self-served org per account: a second call answers the first org
 *    with 200, not a new one.
 *  - The answer is `{ org: { id, slug, kind }, home, created }`; `home` is
 *    where the page sends the caller next.
 *  - Before 189 is applied: 503 naming the migration.
 *
 * The org id comes from the function, never from the body, and the user id
 * from the session, never from the body. Rate-limited per account.
 */
import { NextRequest, NextResponse } from 'next/server';
import { sessionIdentity } from '@/lib/auth/org-access';
import { createServiceClient } from '@/lib/auth/ownership';
import { OrgSetupBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { recordEvent } from '@/lib/labelos/activity';
import {
  SETUP_NOT_READY,
  SETUP_ORG_RPC,
  cleanOrgName,
  interpretSetupResult,
  kindForFace,
} from '@/lib/labelos/setup';
import { MANAGED_ACCOUNT_STAYS } from '@/lib/labelos/team-accounts';
import { ownManagedAccount } from '@/lib/labelos/team-accounts-store';
import { createLogger } from '@/lib/log';
import { rateLimitDurable } from '@/lib/security/rate-limit';
import { readBody } from '@/lib/validate';

const log = createLogger('api.org.setup');

export async function POST(req: NextRequest) {
  const session = await sessionIdentity();
  if (!session) return NextResponse.json({ error: 'Sign in to set up your organization' }, { status: 401 });

  const admin = createServiceClient();
  // Doc 25: a team account stays in the organization that made it. Its own
  // org would put it out of that org's reach (190's `shared`), so a
  // switched-off employee could keep a way in.
  try {
    const own = await ownManagedAccount(admin, session.userId);
    if (own.status === 'managed') {
      return NextResponse.json({ error: MANAGED_ACCOUNT_STAYS, code: 'team_account' }, { status: 409 });
    }
  } catch (err) {
    log.error('team account check failed', { userId: session.userId, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not set up the organization' }, { status: 500 });
  }

  const parsed = await readBody(req, OrgSetupBodySchema);
  if (!parsed.ok) return parsed.res;
  const name = cleanOrgName(parsed.data.name);
  if (!name) return NextResponse.json({ error: 'Give it a name of 1 to 80 characters' }, { status: 400 });
  const kind = kindForFace(parsed.data.face);

  if (!(await rateLimitDurable(`org-setup:u:${session.userId}`, 10, 60 * 1000))) {
    return NextResponse.json({ error: 'Too many attempts. Try again in a minute.' }, { status: 429 });
  }

  try {
    const { data, error } = await admin.rpc(SETUP_ORG_RPC, {
      p_user: session.userId,
      p_kind: kind,
      p_name: name,
    });
    const result = interpretSetupResult(data, error as { code?: string; message?: string } | null);
    if (result.status === 'schema_missing') return NextResponse.json({ error: SETUP_NOT_READY }, { status: 503 });
    if (result.status === 'failed') throw new Error(result.error);

    if (result.status === 'created') {
      // Everyday event, best effort: the org exists either way.
      try {
        await recordEvent(
          admin,
          { orgId: result.orgId, userId: session.userId },
          'org.created',
          { type: 'org', id: result.orgId },
          { kind: result.kind, source: 'setup' },
        );
      } catch (err) {
        log.warn('org.created event not recorded', { orgId: result.orgId, error: errorMessage(err) });
      }
    }

    return NextResponse.json(
      {
        org: { id: result.orgId, slug: result.slug, kind: result.kind },
        home: `/o/${result.slug}`,
        created: result.status === 'created',
      },
      { status: result.status === 'created' ? 201 : 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    log.error('org setup failed', { userId: session.userId, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not set up the organization' }, { status: 500 });
  }
}
