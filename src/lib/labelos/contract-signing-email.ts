/**
 * The signing link goes to the PARTY'S address on file — never back to the member who issued it (review M1 on #166:
 * a member who can read the token could sign as the party). The token is in this email and nowhere in an API
 * response. Same pattern as the artist portal's sign-in email.
 */
import { Resend } from 'resend';
import { escapeHtml } from '@/lib/artist-portal/digest';
import { getAppUrl } from '@/lib/env';

export function signLinkUrl(path: string): string {
  return `${getAppUrl()}${path}`;
}

/** A plausible single address (the parties form stores whatever was typed). */
export function usableEmail(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim();
  return v.length <= 254 && /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(v) ? v : null;
}

export async function sendSignLinkEmail(input: { to: string; contractTitle: string; orgName: string; link: string; expiresAt: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const safe = escapeHtml(input.link);
  const until = new Date(input.expiresAt).toISOString().slice(0, 10);
  const { error } = await new Resend(process.env.RESEND_API_KEY).emails.send({
    from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
    to: input.to,
    subject: `Please review and sign: ${input.contractTitle}`,
    text: `${input.orgName} asked you to review and sign “${input.contractTitle}”.\n\nOpen it: ${input.link}\n\nThe link is yours alone and works until ${until}. If you weren't expecting this, ignore this email.`,
    html: `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#090907;color:#fff;padding:40px 24px;">
    <table style="max-width:520px;margin:0 auto;background:#0D0D0A;border:1px solid #222;border-radius:12px;overflow:hidden;">
      <tr><td style="padding:32px;">
        <p style="font-size:11px;color:#9a9a9a;text-transform:uppercase;letter-spacing:0.2em;margin:0 0 12px;">${escapeHtml(input.orgName)}</p>
        <h1 style="font-size:20px;font-weight:600;margin:0 0 18px;color:#fff;">Review and sign: ${escapeHtml(input.contractTitle)}</h1>
        <a href="${safe}" style="display:inline-block;background:#fff;color:#090907;padding:12px 24px;text-decoration:none;border-radius:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.15em;font-size:12px;">Open the contract</a>
        <p style="font-size:11px;color:#8a8a8a;margin:24px 0 0;">The link is yours alone and works until ${escapeHtml(until)}. If you weren’t expecting this, ignore this email.</p>
      </td></tr>
    </table>
  </div>`,
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}
