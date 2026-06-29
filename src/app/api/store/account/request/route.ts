import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Resend } from 'resend';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/local-store';
import { signBuyerToken } from '@/lib/buyer-tokens';
import { getAppUrl } from '@/lib/env';
import { errorMessage } from '@/lib/errors';
import { publicError } from '@/lib/api-error';
import { createLogger } from '@/lib/log';
import { rateLimitDurable, clientIp } from '@/lib/security/rate-limit';
const log = createLogger('api.store.account.request');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  email: z.string().email(),
});

/**
 * POST /api/store/account/request
 *
 * Body: { email: string }
 *
 * Always returns 200 { ok: true } regardless of whether the email has
 * any purchases — telling the caller "no such buyer" would be an
 * enumeration oracle. The link only does something if the receiver
 * actually has license_purchases or project_access_links.
 *
 * Sends a magic-link email with a 24h signed token via Resend. If
 * Resend isn't configured, the route falls back to logging the link so
 * dev environments still work.
 */
export async function POST(req: NextRequest) {
  try {
    // Magic-link email sender — rate-limit per IP so it can't be used to
    // spam a victim's inbox (or burn Resend quota).
    if (!await rateLimitDurable(`acctreq:${clientIp(req)}`, 5, 60_000)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }
    const raw = await req.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Valid email required' }, { status: 400 });
    }
    const email = parsed.data.email.trim().toLowerCase();

    // Issue the token unconditionally. Even if the buyer has no
    // purchases the link is harmless — the account page just shows
    // an empty state.
    const token = signBuyerToken(email);
    const url = `${getAppUrl()}/store/account/${token}`;

    // Best-effort: check whether the buyer actually has anything, so we
    // can tailor the email copy. This is a UX nicety, not a gate.
    let hasPurchases = false;
    if (isSupabaseConfigured()) {
      try {
        const admin = createServiceClient();
        const { data: lp } = await admin
          .from('license_purchases')
          .select('id')
          .eq('buyer_email', email)
          .limit(1);
        if (lp && lp.length > 0) hasPurchases = true;
        if (!hasPurchases) {
          const { data: pa } = await admin
            .from('project_access_links')
            .select('id')
            .eq('buyer_email', email)
            .limit(1);
          if (pa && pa.length > 0) hasPurchases = true;
        }
      } catch {
        // Don't leak DB errors to the client — proceed with neutral copy.
      }
    }

    const subject = hasPurchases
      ? 'Your U2C Beatstore account'
      : 'Your U2C Beatstore account link';

    if (process.env.RESEND_API_KEY) {
      try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({
          from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
          to: email,
          subject,
          html: `
            <div style="font-family: sans-serif; background: #090907; color: #F7EBDD; padding: 40px; border-radius: 20px; max-width: 560px;">
              <h1 style="text-transform: uppercase; letter-spacing: 0.3em; font-size: 13px; color: #E7D7BE; margin: 0 0 20px;">
                Sign in
              </h1>
              <p style="font-size: 15px; line-height: 1.7;">
                ${hasPurchases
                  ? "Here's your secure link to view all your purchases and re-download your files."
                  : "Tap the button below to access your buyer area. If you've never purchased here this page will be empty — that's expected."}
              </p>
              <div style="margin-top: 32px;">
                <a href="${url}"
                   style="background: #E7D7BE; color: #090907; padding: 16px 32px; text-decoration: none; border-radius: 12px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.2em; font-size: 12px; display: inline-block;">
                  Open my account
                </a>
              </div>
              <p style="margin-top: 32px; font-size: 11px; color: #B4AA99;">
                This link expires in 24 hours. Don't share it — anyone with the link can see your purchases.
              </p>
            </div>
          `,
        });
      } catch (err) {
        // Email send failures shouldn't surface to the caller; log and continue.
        log.error('buyer-account email send failed', { error: errorMessage(errorMessage(err)) });
      }
    } else {
      // Dev fallback — print the link to the server log so it's recoverable.
      log.info('[buyer-account] no RESEND_API_KEY set; link =', { error: errorMessage(url) });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return publicError(err);
  }
}
