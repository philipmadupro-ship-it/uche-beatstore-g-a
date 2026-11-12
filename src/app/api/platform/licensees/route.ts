/**
 * The platform console's licensees (LABEL-47). Platform operators only
 * (`requirePlatformAdmin`): everyone else — every org member, org owners
 * included — gets 404, as if the route did not exist.
 *
 * GET  — every live artist / label org with its licence and seat / artist counts.
 * POST — create a licensee org with a face (independent = kind `artist`,
 *        label = kind `label`) and its licence, in ONE database function that
 *        also writes `org.created` and the audit event `org.entitlements_changed`
 *        in the new org. With `owner_email`, then invite the owner (146's
 *        invitation function, `invitation.created`) and send the ordinary
 *        invitation email. The org has no member until that person accepts.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/auth/platform-access';
import { PlatformLicenseeCreateBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { auditRpc } from '@/lib/labelos/audit-rpc';
import { licensePayload, planLicense } from '@/lib/labelos/platform';
import { PLATFORM_NOT_READY, inviteOwner, isMissingPlatform, listLicensees } from '@/lib/labelos/platform-store';
import { ReadError } from '@/lib/labelos/paged-read';
import { createLogger } from '@/lib/log';
import { rateLimitDurable } from '@/lib/security/rate-limit';
import { readBody } from '@/lib/validate';

const log = createLogger('api.platform.licensees');
const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET() {
  const access = await requirePlatformAdmin();
  if (!access.ok) return access.res;
  try {
    const licensees = await listLicensees(access.admin);
    return NextResponse.json({ licensees }, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof ReadError && isMissingPlatform(err.raw)) return NextResponse.json({ error: PLATFORM_NOT_READY }, { status: 503 });
    log.error('list licensees failed', { error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not list licensees' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const access = await requirePlatformAdmin();
  if (!access.ok) return access.res;
  const parsed = await readBody(req, PlatformLicenseeCreateBodySchema);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;
  const plan = planLicense(body);

  if (!(await rateLimitDurable(`platform-licensee:${access.userId}`, 30, 60 * 60 * 1000))) {
    return NextResponse.json({ error: 'Too many new licensees. Try again later.' }, { status: 429 });
  }

  try {
    const { data, error } = await auditRpc(access.admin, 'platformCreateLicensee', {
      p_actor: access.userId,
      p_name: body.name,
      p_slug: body.slug,
      p_kind: plan.kind,
      p_modules: plan.modules,
      p_max_seats: plan.maxSeats,
      p_max_artists: plan.maxArtists,
      p_payload: licensePayload(plan, null, { created: true, face: body.face }),
    });
    if (isMissingPlatform(error)) return NextResponse.json({ error: PLATFORM_NOT_READY }, { status: 503 });
    if (error) throw new Error(error.message);
    if (data?.error === 'slug_taken') return NextResponse.json({ error: 'That address is taken. Choose another.', field: 'slug' }, { status: 409 });
    // The operator row went away between the gate and the write.
    if (data?.error === 'not_operator') return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const org = data?.org as { id: string; name: string; slug: string; kind: string } | undefined;
    if (!org?.id) throw new Error('create licensee returned nothing');

    let invitation: Awaited<ReturnType<typeof inviteOwner>> | null = null;
    if (body.owner_email) {
      try {
        invitation = await inviteOwner(access.admin, access.userId, org, body.owner_email);
      } catch (err) {
        // The org exists; say the invitation did not go out rather than reporting the whole request as failed.
        log.error('owner invitation failed', { orgId: org.id, error: errorMessage(err) });
        invitation = { ok: false, status: 503, error: 'The organization was created, but the owner invitation could not be sent. Send it again from the list.' };
      }
    }
    return NextResponse.json(
      {
        org: { id: org.id, name: org.name, slug: org.slug, face: body.face },
        invitation: invitation === null ? null : invitation.ok ? { sent: true, emailSent: invitation.emailSent } : { sent: false, error: invitation.error },
      },
      { status: 201, headers: NO_STORE },
    );
  } catch (err) {
    log.error('create licensee failed', { error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not create the licensee' }, { status: 500 });
  }
}
