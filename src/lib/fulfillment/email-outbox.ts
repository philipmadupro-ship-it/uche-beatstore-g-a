import { Resend } from 'resend';
import { createServiceClient } from '@/lib/auth/ownership';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';

const log = createLogger('fulfillment.email-outbox');
type AdminClient = ReturnType<typeof createServiceClient>;

type EmailJob = {
  id: string;
  kind: 'track' | 'project';
  reference_id: string;
  buyer_email: string;
  subject: string;
  html: string;
  attempts: number;
};

type Attachment = { filename: string; content: string };

async function sendEmail(input: {
  to: string;
  subject: string;
  html: string;
  attachments?: Attachment[];
}) {
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY not configured');
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
    ...input,
  });
  if (error) throw error;
}

export async function deliverFulfillmentEmail(input: {
  admin: AdminClient;
  kind: 'track' | 'project';
  referenceId: string;
  sellerUserId?: string | null;
  stripeSessionId: string;
  to: string;
  subject: string;
  html: string;
  attachments?: Attachment[];
}) {
  const { admin } = input;
  let jobId: string | null = null;

  try {
    const { data: existing, error: selectError } = await admin
      .from('fulfillment_email_jobs')
      .select('id, status')
      .eq('kind', input.kind)
      .eq('reference_id', input.referenceId)
      .maybeSingle();
    if (selectError) throw selectError;
    if (existing?.status === 'sent') return { sent: false, alreadySent: true };
    jobId = existing?.id ?? null;

    if (!jobId) {
      const { data: inserted, error: insertError } = await admin
        .from('fulfillment_email_jobs')
        .insert({
          kind: input.kind,
          reference_id: input.referenceId,
          seller_user_id: input.sellerUserId ?? null,
          stripe_session_id: input.stripeSessionId,
          buyer_email: input.to,
          subject: input.subject,
          html: input.html,
        })
        .select('id')
        .single();
      if (insertError) throw insertError;
      jobId = inserted.id;
    }
  } catch (err) {
    // Zero-downtime rollout: direct delivery still works before migration 103.
    log.warn('outbox unavailable; using direct delivery', { error: errorMessage(err) });
  }

  try {
    await sendEmail({
      to: input.to,
      subject: input.subject,
      html: input.html,
      attachments: input.attachments,
    });
    if (jobId) {
      await admin.from('fulfillment_email_jobs').update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        locked_at: null,
        last_error: null,
        updated_at: new Date().toISOString(),
      }).eq('id', jobId);
    }
    return { sent: true, alreadySent: false };
  } catch (err) {
    if (jobId) {
      await admin.from('fulfillment_email_jobs').update({
        status: 'failed',
        attempts: 1,
        next_attempt_at: new Date(Date.now() + 5 * 60_000).toISOString(),
        locked_at: null,
        last_error: errorMessage(err).slice(0, 1000),
        updated_at: new Date().toISOString(),
      }).eq('id', jobId);
    }
    throw err;
  }
}

export async function processFulfillmentEmailBatch(limit = 10) {
  const admin = createServiceClient();
  const { data, error } = await admin.rpc('claim_fulfillment_email_jobs', {
    p_limit: Math.min(Math.max(limit, 1), 50),
  });
  if (error) throw error;

  const jobs = (data ?? []) as EmailJob[];
  let sent = 0;
  let failed = 0;
  let dead = 0;

  for (const job of jobs) {
    try {
      await sendEmail({ to: job.buyer_email, subject: job.subject, html: job.html });
      await admin.from('fulfillment_email_jobs').update({
        status: 'sent', sent_at: new Date().toISOString(), locked_at: null,
        last_error: null, updated_at: new Date().toISOString(),
      }).eq('id', job.id);
      sent += 1;
    } catch (err) {
      const isDead = job.attempts >= 10;
      const backoffMinutes = Math.min(5 * (2 ** Math.max(job.attempts - 1, 0)), 24 * 60);
      await admin.from('fulfillment_email_jobs').update({
        status: isDead ? 'dead' : 'failed',
        next_attempt_at: new Date(Date.now() + backoffMinutes * 60_000).toISOString(),
        locked_at: null,
        last_error: errorMessage(err).slice(0, 1000),
        updated_at: new Date().toISOString(),
      }).eq('id', job.id);
      if (isDead) dead += 1;
      else failed += 1;
      log.warn('delivery retry failed', {
        jobId: job.id, kind: job.kind, referenceId: job.reference_id,
        attempt: job.attempts, dead: isDead, error: errorMessage(err),
      });
    }
  }

  return { claimed: jobs.length, sent, failed, dead };
}

