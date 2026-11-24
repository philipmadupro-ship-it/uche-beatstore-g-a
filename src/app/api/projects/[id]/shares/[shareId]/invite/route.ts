import { NextRequest, NextResponse } from 'next/server';
import { getAppUrl } from '@/lib/env';
import { Resend } from 'resend';
import { isSupabaseConfigured, requireRowOwnership } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { buildProjectSendRow } from '@/lib/crm/project-send';
import { buildBeatSendEmail } from '@/lib/email/beat-send-template';
import { beatSendEmailInput, sharePathFor, type BeatSendRole } from '@/lib/email/beat-send-input';
import { loadProducerName, loadProjectPack } from '@/lib/email/beat-send-context';
import { isFullPlayback } from '@/lib/share/playback';
import { z } from 'zod';

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
 *
 * Optional `contact_id`: when the invite goes to a CRM contact outside a
 * campaign, the send is recorded in `beat_sends` here (campaign sends are
 * recorded by `/api/campaigns/[id]/targets` instead, so callers pass
 * `contact_id` only for non-campaign sends). Without this a project send left
 * no trace on the contact's timeline and its opens/clicks were never tracked.
 * Recording is best-effort: the email has already gone out, so a failure is
 * reported as `sendRecorded: false` rather than failing the invite.
 */
const ContactIdSchema = z.string().uuid();

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; shareId: string }> },
) {
  const { id, shareId } = await params;

  try {
    const body = await req.json().catch(() => ({}));
    const overrideEmail: string | null = typeof body.email === 'string' ? body.email.trim() : null;
    const message: string = typeof body.message === 'string' ? body.message.trim() : '';
    const customSubject: string | null = typeof body.subject === 'string' ? body.subject : null;
    const recipientNameBody: string = typeof body.recipient_name === 'string' ? body.recipient_name.trim() : '';
    let contactId: string | null = null;
    if (body.contact_id != null) {
      const parsedContact = ContactIdSchema.safeParse(body.contact_id);
      if (!parsedContact.success) {
        return NextResponse.json({ error: 'Invalid contact_id' }, { status: 400 });
      }
      contactId = parsedContact.data;
    }

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
      .select('*')
      .eq('id', shareId)
      .maybeSingle();
    if (shareErr) throw shareErr;
    if (!share) return NextResponse.json({ error: 'Share not found' }, { status: 404 });
    if (share.project_id !== id) return NextResponse.json({ error: 'Share/project mismatch' }, { status: 400 });
    if (share.revoked_at) return NextResponse.json({ error: 'Cannot invite to a revoked link' }, { status: 409 });

    // Check the contact before sending anything, so a bad id fails cleanly
    // instead of after the email is already in the recipient's inbox.
    if (contactId) {
      const { data: contact, error: contactErr } = await owner.admin
        .from('contacts')
        .select('id')
        .eq('id', contactId)
        .eq('user_id', owner.userId)
        .maybeSingle();
      if (contactErr) throw contactErr;
      if (!contact) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    const recipient = overrideEmail || share.invited_email;
    if (!recipient) {
      return NextResponse.json(
        { error: 'No recipient email. Set invited_email on the share or pass `email` in the body.' },
        { status: 400 },
      );
    }

    // The email is built by the same pure input builder the SendBeatModal
    // preview uses (lib/email/beat-send-input.ts), so what the producer
    // previewed is what goes out.
    const [pack, producerName] = await Promise.all([
      loadProjectPack(owner.admin, owner.userId, id),
      loadProducerName(owner.admin, owner.userId),
    ]);

    const shareUrl = `${getAppUrl()}${sharePathFor('project', share.token)}`;
    const role: BeatSendRole = share.role === 'editor' || share.role === 'commenter' ? share.role : 'viewer';
    const input = beatSendEmailInput({
      kind: 'project',
      shareUrl,
      recipientName: recipientNameBody || recipient.split('@')[0],
      packTitle: pack.name || 'a project',
      trackCount: pack.trackCount,
      coverUrl: pack.coverUrl,
      message,
      allowDownloads: !!share.allow_downloads,
      expiresAt: share.expires_at ?? null,
      fullPlayback: isFullPlayback(share),
      role,
      producerName,
      subject: customSubject,
      fromAddress: process.env.RESEND_FROM_EMAIL,
    });

    const resend = new Resend(process.env.RESEND_API_KEY);

    const { data: sent, error: sendErr } = await resend.emails.send({
      from: input.from,
      to: recipient,
      subject: input.subject,
      html: buildBeatSendEmail(input.template),
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

    let sendId: string | null = null;
    if (contactId) {
      try {
        const { data: projectTracks, error: tracksErr } = await owner.admin
          .from('project_tracks')
          .select('track_id')
          .eq('project_id', id)
          .order('position', { ascending: true });
        if (tracksErr) throw tracksErr;
        const { data: send, error: sendRowErr } = await owner.admin
          .from('beat_sends')
          .insert(buildProjectSendRow({
            contactId,
            trackIds: (projectTracks ?? []).map((row: { track_id: string }) => row.track_id),
            shareToken: share.token,
            message,
            emailResendId: sent?.id ?? null,
          }))
          .select('id')
          .single();
        if (sendRowErr) throw sendRowErr;
        sendId = send?.id ?? null;
      } catch (recordErr) {
        log.warn('invite sent but beat_sends row not recorded', { error: errorMessage(recordErr), shareId });
      }
    }

    return NextResponse.json({
      success: true,
      recipient,
      resendId: sent?.id ?? null,
      sendId,
      sendRecorded: contactId ? sendId !== null : undefined,
    });
  } catch (error) {
    log.error('invite failed', { error: errorMessage(error) });
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
