/**
 * POST /api/platform/licensees/[orgId]/invitations — invite a licensee's
 * owner (LABEL-47). Platform operators only; everyone else 404.
 *
 * The ordinary invitation flow: 146's function writes the invitation and its
 * audit event `invitation.created` in the org (the operator as actor), the
 * usual email goes out, and the person accepts at /join/<token>. 170's accept
 * function honours an OWNER invitation only while its sender is still an
 * operator, which is why no org member can send one. 409 while the address
 * already has a pending invitation to this org.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/auth/platform-access';
import { PlatformOwnerInviteBodySchema } from '@/lib/contracts';
import { normalizeEmail } from '@/lib/contacts/email';
import { errorMessage } from '@/lib/errors';
import { ReadError } from '@/lib/labelos/paged-read';
import { PLATFORM_NOT_READY, inviteOwner, isMissingPlatform, readLicenseeOrg } from '@/lib/labelos/platform-store';
import { createLogger } from '@/lib/log';
import { rateLimitDurable } from '@/lib/security/rate-limit';
import { isUUID, readBody } from '@/lib/validate';

const log = createLogger('api.platform.owner-invite');
const NOT_FOUND = () => NextResponse.json({ error: 'Not found' }, { status: 404 });

export async function POST(req: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  const access = await requirePlatformAdmin();
  if (!access.ok) return access.res;
  const { orgId } = await params;
  if (!isUUID(orgId)) return NOT_FOUND();
  const parsed = await readBody(req, PlatformOwnerInviteBodySchema);
  if (!parsed.ok) return parsed.res;

  try {
    const org = await readLicenseeOrg(access.admin, orgId);
    if (!org) return NOT_FOUND();
    const email = normalizeEmail(parsed.data.email);
    if (!(await rateLimitDurable(`platform-owner-invite:${org.id}:${email}`, 5, 24 * 60 * 60 * 1000))) {
      return NextResponse.json({ error: 'Too many invitations to this address. Try again later.' }, { status: 429 });
    }
    // inviteOwner calls auditRpc(admin, 'invitationCreate', …): the invitation and its event commit together.
    const result = await inviteOwner(access.admin, access.userId, org, email);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(
      { invitation: { id: result.invitationId }, emailSent: result.emailSent, ...(result.emailSent ? {} : { emailError: result.emailError }) },
      { status: 201, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    if (err instanceof ReadError && isMissingPlatform(err.raw)) return NextResponse.json({ error: PLATFORM_NOT_READY }, { status: 503 });
    log.error('owner invitation failed', { orgId, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not send the invitation' }, { status: 500 });
  }
}
