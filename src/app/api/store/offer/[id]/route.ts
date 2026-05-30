import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Resend } from 'resend';
import { requireUser } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/local-store';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.store.offer.respond');

/**
 * PATCH /api/store/offer/[id] — producer responds to a buyer's offer.
 *
 * Body: { action: 'accept' | 'decline' | 'counter', counter_price_usd? }
 *
 * Updates the offer status and best-effort emails the buyer so the
 * negotiation continues (replyTo = the producer's email). Ownership is
 * enforced by matching seller_user_id to the authed user (RLS also gates
 * via the owner policy in mig 068).
 */
const bodySchema = z.object({
  action: z.enum(['accept', 'decline', 'counter']),
  counter_price_usd: z.number().positive().max(1_000_000).optional(),
});

const STATUS_FOR: Record<string, string> = {
  accept: 'accepted',
  decline: 'declined',
  counter: 'countered',
};

function money(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const result = await requireUser();
    if (!result.ok) return result.res;
    const { userId, admin } = result;

    const { id } = await params;
    const raw = await req.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    if (parsed.data.action === 'counter' && parsed.data.counter_price_usd == null) {
      return NextResponse.json({ error: 'Counter price required' }, { status: 400 });
    }

    if (!isSupabaseConfigured()) return NextResponse.json({ ok: true, persisted: false });

    // Load + ownership check.
    const { data: offer } = await admin
      .from('buyer_offers')
      .select('id, seller_user_id, track_title, buyer_email, offered_price_usd, status')
      .eq('id', id)
      .maybeSingle();
    if (!offer || (offer as any).seller_user_id !== userId) {
      return NextResponse.json({ error: 'Offer not found' }, { status: 404 });
    }

    const status = STATUS_FOR[parsed.data.action];
    const { error: updErr } = await admin.from('buyer_offers').update({ status }).eq('id', id);
    if (updErr) throw updErr;

    // Best-effort buyer email.
    try {
      const resendKey = process.env.RESEND_API_KEY;
      if (resendKey) {
        // Producer email for replyTo.
        const { data: prof } = await admin
          .from('creator_profiles')
          .select('contact_email')
          .eq('user_id', userId)
          .maybeSingle();
        let producerEmail = (prof as any)?.contact_email as string | null;
        if (!producerEmail) {
          const { data: authUser } = await admin.auth.admin.getUserById(userId);
          producerEmail = authUser?.user?.email ?? null;
        }

        const title = (offer as any).track_title as string;
        const offered = Number((offer as any).offered_price_usd);
        const buyerEmail = (offer as any).buyer_email as string;

        let subject: string;
        let body: string;
        if (parsed.data.action === 'accept') {
          subject = `Your offer on "${title}" was accepted`;
          body = `<h1 style="color:#6DC6A4;font-size:22px;margin:0 0 8px">Offer accepted — ${money(offered)}</h1>
            <p style="color:#a08a6a;font-size:13px;margin:0 0 16px">The producer accepted your offer on <strong style="color:#E8DCC8">${title}</strong>. Reply to this email to arrange payment + delivery.</p>`;
        } else if (parsed.data.action === 'counter') {
          const counter = parsed.data.counter_price_usd!;
          subject = `Counter-offer on "${title}" — ${money(counter)}`;
          body = `<h1 style="color:#D4BFA0;font-size:22px;margin:0 0 8px">Counter-offer: ${money(counter)}</h1>
            <p style="color:#a08a6a;font-size:13px;margin:0 0 16px">You offered ${money(offered)} for <strong style="color:#E8DCC8">${title}</strong>. The producer countered at <strong style="color:#E8DCC8">${money(counter)}</strong>. Reply to accept or keep negotiating.</p>`;
        } else {
          subject = `Update on your offer for "${title}"`;
          body = `<h1 style="color:#a08a6a;font-size:20px;margin:0 0 8px">Offer declined</h1>
            <p style="color:#a08a6a;font-size:13px;margin:0 0 16px">The producer passed on your ${money(offered)} offer for <strong style="color:#E8DCC8">${title}</strong> for now. Feel free to browse other beats or send a new offer.</p>`;
        }

        const resend = new Resend(resendKey);
        await resend.emails.send({
          from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
          to: buyerEmail,
          ...(producerEmail ? { replyTo: producerEmail } : {}),
          subject,
          html: `<div style="background:#0a0907;color:#E8DCC8;padding:32px;font-family:sans-serif;border-radius:12px">
              <p style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#a08a6a;margin:0 0 8px">U2C Beatstore</p>
              ${body}
            </div>`,
        });
      }
    } catch (mailErr) {
      log.warn('offer-response email failed', { error: errorMessage(mailErr) });
    }

    return NextResponse.json({ ok: true, status });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
