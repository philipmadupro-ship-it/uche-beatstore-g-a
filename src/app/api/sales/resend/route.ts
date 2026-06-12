import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { requireUser } from '@/lib/auth/ownership';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { getAppUrl } from '@/lib/env';

const log = createLogger('api.sales.resend');
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/sales/resend  body: { id: string, kind: 'track' | 'project' }
 *
 * Producer-side "Resend delivery email" trigger. Reuses the same email
 * template the Stripe webhook fires on initial purchase. Buyer-facing
 * download links don't change — we resolve the same {session_id} or
 * {access_token} they got the first time. The Resend send itself is
 * idempotent enough that re-firing is safe.
 *
 * NB: there's some duplication with the email-template logic in
 * /api/stripe/webhook/route.ts. A follow-up should extract both into
 * lib/email/delivery-receipt.ts — see Improvement #X in CLAUDE.md.
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.res;
  const { userId, admin } = auth;

  try {
    const body = await req.json().catch(() => ({}));
    const id = typeof body.id === 'string' ? body.id : '';
    const kind = body.kind === 'project' ? 'project' : 'track';
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json({ error: 'Email service not configured' }, { status: 503 });
    }

    const APP_URL = getAppUrl();
    const resend = new Resend(process.env.RESEND_API_KEY);

    if (kind === 'project') {
      // Verify project_access_links row → project owned by this user
      const { data: access } = await admin
        .from('project_access_links')
        .select('id, project_id, buyer_email, stripe_session_id, token, amount_usd, created_at, projects!inner(user_id, name)')
        .eq('id', id)
        .maybeSingle();
      if (!access) return NextResponse.json({ error: 'Sale not found' }, { status: 404 });
      const proj = (access as any).projects;
      if (!proj || proj.user_id !== userId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      const accessUrl = `${APP_URL}/store/projects/access/${(access as any).token}`;
      await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
        to: (access as any).buyer_email,
        subject: `Your project "${proj.name}" is ready (resend)`,
        html: `
          <div style="font-family: sans-serif; background: #090907; color: #F7EBDD; padding: 40px; border-radius: 20px; max-width: 560px;">
            <h1 style="text-transform: uppercase; letter-spacing: 0.3em; font-size: 13px; color: #E7D7BE; margin: 0 0 20px;">
              Project delivery — resent
            </h1>
            <p style="font-size: 15px; line-height: 1.7; color: #F7EBDD;">
              Here's your access link to <strong>${proj.name}</strong> again. The producer re-sent this from their dashboard.
            </p>
            <div style="margin-top: 36px;">
              <a href="${accessUrl}" style="background: #F7EBDD; color: #090907; padding: 16px 32px; text-decoration: none; border-radius: 12px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.2em; font-size: 12px; display: inline-block;">
                Access your project
              </a>
            </div>
          </div>
        `,
      });
      log.info('project delivery resent', { access_id: id, project_id: (access as any).project_id });
      return NextResponse.json({ ok: true });
    }

    // kind === 'track'
    const { data: purchase } = await admin
      .from('license_purchases')
      .select('id, buyer_email, stripe_session_id, license_type, track_ids')
      .eq('id', id)
      .eq('seller_user_id', userId)
      .maybeSingle();
    if (!purchase) return NextResponse.json({ error: 'Sale not found' }, { status: 404 });

    const downloadUrl = `${APP_URL}/store/download?session_id=${(purchase as any).stripe_session_id}`;
    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
      to: (purchase as any).buyer_email,
      subject: `Your license is ready (resend)`,
      html: `
        <div style="font-family: sans-serif; background: #090907; color: #F7EBDD; padding: 40px; border-radius: 20px; max-width: 560px;">
          <h1 style="text-transform: uppercase; letter-spacing: 0.3em; font-size: 13px; color: #E7D7BE; margin: 0 0 20px;">
            License delivery — resent
          </h1>
          <p style="font-size: 15px; line-height: 1.7; color: #F7EBDD;">
            Here's your download link again. The producer re-sent this from their dashboard.
          </p>
          <div style="margin-top: 36px;">
            <a href="${downloadUrl}" style="background: #F7EBDD; color: #090907; padding: 16px 32px; text-decoration: none; border-radius: 12px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.2em; font-size: 12px; display: inline-block;">
              Download your files
            </a>
          </div>
        </div>
      `,
    });

    // Don't reset fulfillment_email_sent — leave the original idempotency
    // guard for the webhook retry path. This was an explicit user action.
    log.info('track license delivery resent', { purchase_id: id });
    return NextResponse.json({ ok: true });
  } catch (err) {
    log.error('resend failed', { error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
