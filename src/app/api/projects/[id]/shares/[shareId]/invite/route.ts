import { NextRequest, NextResponse } from 'next/server';
import { getAppUrl } from '@/lib/env';
import { Resend } from 'resend';
import { isSupabaseConfigured, requireRowOwnership } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';

const log = createLogger('api.projects.shares.invite');

export const runtime = 'nodejs';

/**
 * POST /api/projects/[id]/shares/[shareId]/invite
 *
 * Sends a Resend email to the share's `invited_email` (or one passed in
 * the body, overriding) with a personal message and the share URL.
 *
 * Why a separate endpoint instead of folding into share-create:
 *   1. Re-sending an invite later shouldn't require regenerating the link.
 *   2. The owner often wants to tweak the email message after creating
 *      the share (and seeing the role / expiry choices reflected).
 *   3. Email send failures here don't roll back the share row — the link
 *      still exists and can be copied manually.
 *
 * Owner-gated via the parent project, like every other shares route.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; shareId: string }> },
) {
  const { id, shareId } = await params;

  try {
    const body = await req.json().catch(() => ({}));
    const overrideEmail: string | null = typeof body.email === 'string' ? body.email.trim() : null;
    const message: string = typeof body.message === 'string' ? body.message.trim() : '';

    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json(
        { error: 'Email sending is not configured. Set RESEND_API_KEY in your environment.' },
        { status: 503 },
      );
    }

    if (!isSupabaseConfigured()) {
      // In local-store mode the owner can still copy the link manually;
      // we don't simulate email delivery in dev because there's no DB to
      // record sent-history against.
      return NextResponse.json(
        { error: 'Email invites require Supabase configuration.' },
        { status: 501 },
      );
    }

    const owner = await requireRowOwnership('projects', id);
    if (!owner.ok) return owner.res;

    const { data: share, error: shareErr } = await owner.admin
      .from('project_shares')
      .select('id, project_id, token, role, allow_downloads, invited_email, expires_at, revoked_at')
      .eq('id', shareId)
      .maybeSingle();
    if (shareErr) throw shareErr;
    if (!share) return NextResponse.json({ error: 'Share not found' }, { status: 404 });
    if (share.project_id !== id) return NextResponse.json({ error: 'Share/project mismatch' }, { status: 400 });
    if (share.revoked_at) return NextResponse.json({ error: 'Cannot invite to a revoked link' }, { status: 409 });

    const recipient = overrideEmail || share.invited_email;
    if (!recipient) {
      return NextResponse.json(
        { error: 'No recipient email. Set invited_email on the share or pass `email` in the body.' },
        { status: 400 },
      );
    }

    // Pull the project name for a nicer subject line.
    const { data: project } = await owner.admin
      .from('projects')
      .select('name, cover_url')
      .eq('id', id)
      .maybeSingle();

    const appUrl = getAppUrl();
    const shareUrl = `${appUrl}/projects/share/${share.token}`;

    const roleHuman = share.role === 'editor' ? 'edit'
      : share.role === 'commenter' ? 'leave feedback on'
      : 'listen to';

    const resend = new Resend(process.env.RESEND_API_KEY);
    const projectName = project?.name || 'a project';

    const { data: sent, error: sendErr } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
      to: recipient,
      subject: `You've been invited to ${roleHuman} "${projectName}"`,
      html: renderInviteHtml({
        projectName,
        coverUrl: project?.cover_url || null,
        roleLabel: share.role,
        roleHuman,
        allowDownloads: !!share.allow_downloads,
        expiresAt: share.expires_at,
        message,
        shareUrl,
      }),
    });

    if (sendErr) {
      return NextResponse.json({ error: sendErr.message || 'Email send failed' }, { status: 502 });
    }

    // Persist the email on the share row if the override differed, so the
    // owner sees "this is who the link is for" next time.
    if (overrideEmail && overrideEmail !== share.invited_email) {
      await owner.admin
        .from('project_shares')
        .update({ invited_email: overrideEmail })
        .eq('id', shareId);
    }

    return NextResponse.json({
      success: true,
      recipient,
      resendId: sent?.id ?? null,
    });
  } catch (error) {
    log.error('invite failed', { error: errorMessage(error) });
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

// ----------------------------------------------------------------------

function renderInviteHtml(opts: {
  projectName: string;
  coverUrl: string | null;
  roleLabel: 'viewer' | 'commenter' | 'editor';
  roleHuman: string;
  allowDownloads: boolean;
  expiresAt: string | null;
  message: string;
  shareUrl: string;
}): string {
  // We escape user-controlled strings — the inviter could otherwise inject
  // HTML into the recipient's inbox via the `message` field.
  const escape = (s: string) => s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string),
  );
  const safeMessage = escape(opts.message).replace(/\n/g, '<br>');
  const safeProject = escape(opts.projectName);
  const roleBadge = opts.roleLabel.charAt(0).toUpperCase() + opts.roleLabel.slice(1);
  const expiresLine = opts.expiresAt
    ? `<p style="font-size:11px;color:#7a6d54;margin:8px 0 0;">Link expires ${new Date(opts.expiresAt).toLocaleDateString()}</p>`
    : '';
  const downloadsLine = opts.allowDownloads
    ? '<span style="color:#D4BFA0">· Downloads enabled</span>'
    : '<span style="color:#6a5d4a">· Downloads off</span>';

  return `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0a0907;color:#E8DCC8;padding:40px 24px;">
    <table style="max-width:520px;margin:0 auto;background:#14110d;border:1px solid #1f1a13;border-radius:16px;overflow:hidden;">
      <tr><td style="padding:32px;">
        <p style="font-size:11px;color:#D4BFA0;text-transform:uppercase;letter-spacing:0.25em;margin:0 0 12px;">You've been invited</p>
        <h1 style="font-size:22px;font-weight:600;margin:0 0 6px;color:#fff;">${safeProject}</h1>
        <p style="font-size:13px;color:#a08a6a;margin:0 0 18px;">
          Role: <strong style="color:#E8D8B8;">${roleBadge}</strong> ${downloadsLine}
        </p>
        ${safeMessage ? `<div style="font-size:14px;line-height:1.6;color:#ccc;background:#0a0907;border-left:2px solid #8A7A5C;padding:14px 18px;border-radius:6px;margin:0 0 24px;">${safeMessage}</div>` : ''}
        <a href="${opts.shareUrl}" style="display:inline-block;background:#D4BFA0;color:#fff;padding:14px 28px;text-decoration:none;border-radius:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.15em;font-size:12px;">Open project</a>
        ${expiresLine}
        <p style="font-size:11px;color:#4a4338;margin:28px 0 0;">Or paste this link: <a href="${opts.shareUrl}" style="color:#D4BFA0;text-decoration:none;">${opts.shareUrl}</a></p>
      </td></tr>
    </table>
    <p style="text-align:center;font-size:10px;color:#4a4338;text-transform:uppercase;letter-spacing:0.3em;margin-top:24px;">U2C Beatstore</p>
  </div>`;
}
