/**
 * Sending an org invitation (LABEL-08). The message itself is
 * `buildInvitationEmail` (pure, tested in invitations.test.ts); this module
 * only resolves the inviter's name and hands the message to Resend.
 *
 * Sending is best effort from the route's point of view: the invitation row
 * and its audit event already exist, so a Resend failure is reported to the
 * inviter (`emailSent: false`, revoke and invite again) rather than failing
 * the request. Nothing here ever logs the URL — it carries the token.
 */
import { Resend } from 'resend';
import type { SupabaseClient } from '@supabase/supabase-js';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { buildInvitationEmail, buildProjectInvitationEmail } from './invitations';
import type { OrgFunction, Role } from './capabilities';

const log = createLogger('lib.labelos.invitation-email');

/**
 * How the invitation names who sent it: their Label OS profile name, else
 * their storefront name, else nothing (the email then names the org only).
 * The inviter's own rows — this is identity, not tenancy.
 */
export async function inviterDisplayName(admin: Pick<SupabaseClient, 'from'>, userId: string): Promise<string | null> {
  for (const table of ['user_profiles', 'creator_profiles'] as const) {
    try {
      const { data } = await admin.from(table).select('display_name').eq('user_id', userId).maybeSingle();
      const name = (data as { display_name?: unknown } | null)?.display_name;
      if (typeof name === 'string' && name.trim()) return name.trim();
    } catch {
      // A missing profile is not a reason to fail an invitation.
    }
  }
  return null;
}

export async function sendInvitationEmail(opts: {
  to: string;
  orgName: string;
  inviterName: string | null;
  role: Role;
  functions: readonly OrgFunction[];
  url: string;
}): Promise<{ sent: true; id: string | null } | { sent: false; reason: 'not_configured' | 'failed' }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { sent: false, reason: 'not_configured' };
  const message = buildInvitationEmail({
    orgName: opts.orgName,
    inviterName: opts.inviterName,
    role: opts.role,
    functions: opts.functions,
    url: opts.url,
  });
  try {
    const { data, error } = await new Resend(key).emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
      to: opts.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
    if (error) {
      log.warn('invitation email failed', { error: error.message });
      return { sent: false, reason: 'failed' };
    }
    return { sent: true, id: data?.id ?? null };
  } catch (err) {
    log.warn('invitation email failed', { error: errorMessage(err) });
    return { sent: false, reason: 'failed' };
  }
}

/** The project invitation (LABEL-21): the same sending rules, a message that names the project. */
export async function sendProjectInvitationEmail(opts: {
  to: string;
  orgName: string;
  projectName: string;
  inviterName: string | null;
  roleLabel: string;
  url: string;
}): Promise<{ sent: true; id: string | null } | { sent: false; reason: 'not_configured' | 'failed' }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { sent: false, reason: 'not_configured' };
  const message = buildProjectInvitationEmail(opts);
  try {
    const { data, error } = await new Resend(key).emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
      to: opts.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
    if (error) {
      log.warn('project invitation email failed', { error: error.message });
      return { sent: false, reason: 'failed' };
    }
    return { sent: true, id: data?.id ?? null };
  } catch (err) {
    log.warn('project invitation email failed', { error: errorMessage(err) });
    return { sent: false, reason: 'failed' };
  }
}
