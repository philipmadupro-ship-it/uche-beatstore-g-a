import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { createServiceClient } from '@/lib/auth/ownership';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';

const log = createLogger('resend.webhook');
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ResendWebhookEvent {
  type?: string;
  data?: {
    email_id?: string;
    id?: string;
  };
}

interface OpenTrackedSend {
  id: string;
  campaign_id: string | null;
  contact_id: string | null;
  status: string | null;
  opened_at: string | null;
}

interface ClickTrackedSend {
  id: string;
  link_clicked_at: string | null;
}

/**
 * POST /api/resend/webhook
 *
 * Receives Resend email events and writes open/click tracking back onto
 * beat_sends (mig 089). Correlation is by beat_sends.email_resend_id, which
 * /api/email stores as the Resend message id at send time.
 *
 * ── Signature verification ─────────────────────────────────────────────────
 * Resend signs webhooks with the Svix scheme. We verify with Node crypto so
 * no `svix` dependency is needed. The signed payload is
 *   `${svix-id}.${svix-timestamp}.${rawBody}`
 * HMAC-SHA256'd with the secret (base64 after the `whsec_` prefix), base64
 * encoded, compared (constant-time) against any `v1,<sig>` in svix-signature.
 * If RESEND_WEBHOOK_SECRET is unset we skip verification (dev) and log a warn.
 *
 * ── Events handled ─────────────────────────────────────────────────────────
 *   email.opened        → set opened_at (first open wins) + bump 'sent'→'opened'
 *   email.clicked       → set link_clicked_at (first click wins)
 *   email.delivered/bounced/etc. → acknowledged (200) but no-op for now
 */

function verifySvix(secret: string, headers: Headers, rawBody: string): boolean {
  const id = headers.get('svix-id');
  const timestamp = headers.get('svix-timestamp');
  const sigHeader = headers.get('svix-signature');
  if (!id || !timestamp || !sigHeader) return false;

  // Reject stale timestamps (>5 min skew) to blunt replay attacks.
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;

  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const signed = `${id}.${timestamp}.${rawBody}`;
  const expected = createHmac('sha256', secretBytes).update(signed).digest('base64');

  // svix-signature is space-separated "v1,<sig>" pairs.
  return sigHeader.split(' ').some((part) => {
    const [, sig] = part.split(',');
    if (!sig) return false;
    try {
      const a = Buffer.from(sig);
      const b = Buffer.from(expected);
      return a.length === b.length && timingSafeEqual(a, b);
    } catch { return false; }
  });
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const secret = process.env.RESEND_WEBHOOK_SECRET;

  if (secret) {
    if (!verifySvix(secret, req.headers, rawBody)) {
      log.warn('Rejected webhook — bad signature');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }
  } else {
    log.warn('RESEND_WEBHOOK_SECRET unset — skipping signature verification');
  }

  let event: ResendWebhookEvent;
  try {
    event = JSON.parse(rawBody) as ResendWebhookEvent;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const type: string = event?.type ?? '';
  // Resend nests the message id under data.email_id.
  const emailId: string | undefined = event?.data?.email_id ?? event?.data?.id;

  // Acknowledge events we don't track so Resend stops retrying.
  if (!emailId || (type !== 'email.opened' && type !== 'email.clicked')) {
    return NextResponse.json({ received: true });
  }

  try {
    const admin = createServiceClient();
    const nowIso = new Date().toISOString();

    if (type === 'email.opened') {
      // First open wins — only set opened_at if still null, and lift a
      // still-'sent' row to 'opened' so the pipeline reflects reality.
      const { data: rows, error: rowsError } = await admin
        .from('beat_sends')
        .select('id, campaign_id, contact_id, status, opened_at')
        .eq('email_resend_id', emailId);
      if (rowsError) throw rowsError;
      for (const row of (rows ?? []) as OpenTrackedSend[]) {
        const patch: Record<string, unknown> = {};
        if (!row.opened_at) patch.opened_at = nowIso;
        if (row.status === 'sent') patch.status = 'opened';
        if (Object.keys(patch).length) {
          const { error } = await admin.from('beat_sends').update(patch).eq('id', row.id);
          if (error) throw error;
        }

        // campaign_targets is a cache of the currently linked send's status.
        // Scope by beat_send_id so a delayed open from an older email cannot
        // overwrite a newer send (or a later interested/placed transition).
        if (
          row.campaign_id
          && row.contact_id
          && (row.status === 'sent' || row.status === 'opened')
        ) {
          const { error } = await admin
            .from('campaign_targets')
            .update({ status: 'opened' })
            .eq('campaign_id', row.campaign_id)
            .eq('contact_id', row.contact_id)
            .eq('beat_send_id', row.id);
          if (error) throw error;
        }
      }
    } else if (type === 'email.clicked') {
      const { data: rows, error: rowsError } = await admin
        .from('beat_sends')
        .select('id, link_clicked_at')
        .eq('email_resend_id', emailId);
      if (rowsError) throw rowsError;
      for (const row of (rows ?? []) as ClickTrackedSend[]) {
        if (!row.link_clicked_at) {
          const { error } = await admin.from('beat_sends').update({ link_clicked_at: nowIso }).eq('id', row.id);
          if (error) throw error;
        }
      }
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    log.error('Webhook processing failed', { error: errorMessage(err) });
    // 500 so Resend retries — the handler is idempotent (first-event-wins).
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
