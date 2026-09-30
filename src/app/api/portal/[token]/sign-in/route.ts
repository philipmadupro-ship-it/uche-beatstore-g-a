import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { PortalSignInBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { clientIp, rateLimitDurable } from '@/lib/security/rate-limit';
import { gatePortal, portalContactEmail } from '@/lib/artist-portal/gate';
import { portalUrl } from '@/lib/artists/portal-send';
import { escapeHtml } from '@/lib/artist-portal/digest';
import {
  canSendSignIn,
  maskEmail,
  sessionCookieName,
  sessionValue,
  signInCode,
  verifySignInCode,
  SESSION_TTL_MS,
} from '@/lib/artist-portal/sign-in';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.portal.sign-in');

/**
 * POST /api/portal/[token]/sign-in — email sign-in for a portal with
 * `require_sign_in` (mig 131; lib/artist-portal/sign-in).
 *   {}         email a 15-minute sign-in link to the CONTACT's address (at
 *              most one a minute). The visitor never supplies an address.
 *   { code }   redeem the link: sets this portal's 30-day session cookie.
 * The rest of the gate (revoked, password) still applies.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!(await rateLimitDurable(`portalsignin:${clientIp(req)}`, 10, 60_000))) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }
  const parsed = PortalSignInBodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  try {
    const admin = createServiceClient();
    const gate = await gatePortal(admin, token, req, { signIn: false });
    if (!gate.ok) return gate.res;
    const portal = gate.portal;
    if (!portal.require_sign_in) return NextResponse.json({ ok: true, required: false });

    const email = await portalContactEmail(admin, portal);
    if (!email) return NextResponse.json({ error: 'This library has no email to confirm. Ask your producer.' }, { status: 409 });
    const subject = { portalId: portal.id, token: portal.token, email };

    if (parsed.data.code) {
      if (!verifySignInCode(parsed.data.code, subject)) {
        return NextResponse.json({ error: 'That sign-in link has expired. Send a new one.', emailHint: maskEmail(email) }, { status: 401 });
      }
      const res = NextResponse.json({ ok: true });
      res.cookies.set(sessionCookieName(portal.id), sessionValue(subject), {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: Math.floor(SESSION_TTL_MS / 1000),
      });
      return res;
    }

    const hint = maskEmail(email);
    if (!canSendSignIn(portal.sign_in_sent_at)) {
      return NextResponse.json({ error: 'A link was just sent. Check your inbox, or try again in a minute.', emailHint: hint }, { status: 429 });
    }
    if (!process.env.RESEND_API_KEY) return NextResponse.json({ error: 'Email is not configured.' }, { status: 503 });

    // Claim the minute before sending, so two tabs cannot both send: a
    // compare-and-set on the stamp the gate just read. (Not an `or=` filter —
    // PostgREST rejects `or` on a PATCH with "column does not exist".)
    const now = new Date();
    const claim = admin.from('artist_portals').update({ sign_in_sent_at: now.toISOString() }).eq('id', portal.id);
    const { data: claimed, error: claimErr } = await (portal.sign_in_sent_at
      ? claim.eq('sign_in_sent_at', portal.sign_in_sent_at)
      : claim.is('sign_in_sent_at', null)
    ).select('id');
    if (claimErr) throw claimErr;
    if (!claimed || claimed.length === 0) {
      return NextResponse.json({ error: 'A link was just sent. Check your inbox, or try again in a minute.', emailHint: hint }, { status: 429 });
    }

    const { data: profile } = await admin.from('creator_profiles').select('display_name').eq('user_id', portal.user_id).maybeSingle();
    const producer = (profile as { display_name?: string | null } | null)?.display_name?.trim() || 'Your producer';
    const link = `${portalUrl(portal.token)}?signin=${encodeURIComponent(signInCode(subject))}`;
    const safe = escapeHtml(link);
    const { error: sendErr } = await new Resend(process.env.RESEND_API_KEY).emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
      to: email,
      subject: `Your sign-in link for ${producer}’s library`,
      text: `Open your library: ${link}\n\nThe link works for 15 minutes, in the browser you open it in. If you didn't ask for it, ignore this email.`,
      html: `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#090907;color:#fff;padding:40px 24px;">
    <table style="max-width:520px;margin:0 auto;background:#0D0D0A;border:1px solid #222;border-radius:12px;overflow:hidden;">
      <tr><td style="padding:32px;">
        <p style="font-size:11px;color:#9a9a9a;text-transform:uppercase;letter-spacing:0.2em;margin:0 0 12px;">${escapeHtml(producer)}</p>
        <h1 style="font-size:20px;font-weight:600;margin:0 0 18px;color:#fff;">Sign in to your library</h1>
        <a href="${safe}" style="display:inline-block;background:#fff;color:#090907;padding:12px 24px;text-decoration:none;border-radius:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.15em;font-size:12px;">Open your library</a>
        <p style="font-size:11px;color:#8a8a8a;margin:24px 0 0;">The link works for 15 minutes, in the browser you open it in. If you didn’t ask for it, ignore this email.</p>
      </td></tr>
    </table>
  </div>`,
    });
    if (sendErr) {
      log.warn('sign-in email failed', { error: sendErr.message });
      return NextResponse.json({ error: 'Could not send the email. Try again shortly.' }, { status: 502 });
    }
    return NextResponse.json({ sent: true, emailHint: hint });
  } catch (err) {
    log.error('portal sign-in failed', { error: errorMessage(err) });
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
