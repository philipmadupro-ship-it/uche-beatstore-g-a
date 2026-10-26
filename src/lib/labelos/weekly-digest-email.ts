/** Sending the weekly digest by Resend (LABEL-38). Best effort: a failure is reported to the caller, which releases its claim. */
import { Resend } from 'resend';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import type { DigestMessage } from './weekly-digest';

const log = createLogger('lib.labelos.weekly-digest-email');

export async function sendDigestEmail(to: string, message: DigestMessage): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  try {
    const { error } = await new Resend(key).emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
      to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
    if (error) {
      log.warn('digest email failed', { error: error.message });
      return false;
    }
    return true;
  } catch (err) {
    log.warn('digest email failed', { error: errorMessage(err) });
    return false;
  }
}
