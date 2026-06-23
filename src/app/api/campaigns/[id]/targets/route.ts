import { NextRequest, NextResponse } from 'next/server';
import { requireRowOwnership } from '@/lib/auth/ownership';
import { errorMessage } from '@/lib/errors';
import { readBody } from '@/lib/validate';
import { CampaignTargetsAddBodySchema, CampaignTargetsDeleteBodySchema } from '@/lib/contracts';
import { createLogger } from '@/lib/log';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.campaigns.targets');

const ProjectCampaignSendBodySchema = z.object({
  project_send: z.object({
    contact_id: z.string().uuid(),
    project_id: z.string().uuid(),
    share_id: z.string().uuid(),
    share_token: z.string().min(6).max(128),
    message: z.string().max(5000).optional().default(''),
    email_resend_id: z.string().max(255).nullable().optional(),
  }).strict(),
}).strict();

/**
 * POST   /api/campaigns/[id]/targets  → add contacts to a campaign
 * DELETE /api/campaigns/[id]/targets  → remove one contact from a campaign
 *
 * Add is an upsert on (campaign_id, contact_id). If the contact already has
 * sends in this campaign, the target is reconciled to the latest one.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const auth = await requireRowOwnership('campaigns', id);
    if (!auth.ok) return auth.res;

    const body = await req.json().catch(() => null);
    const projectSend = ProjectCampaignSendBodySchema.safeParse(body);
    if (projectSend.success) {
      const tracked = projectSend.data.project_send;

      const [{ data: contact, error: contactErr }, { data: project, error: projectErr }] = await Promise.all([
        auth.admin
          .from('contacts')
          .select('id')
          .eq('id', tracked.contact_id)
          .eq('user_id', auth.userId)
          .maybeSingle(),
        auth.admin
          .from('projects')
          .select('id')
          .eq('id', tracked.project_id)
          .eq('user_id', auth.userId)
          .maybeSingle(),
      ]);
      if (contactErr) throw contactErr;
      if (projectErr) throw projectErr;
      if (!contact || !project) {
        return NextResponse.json({ error: 'Contact or project not found' }, { status: 404 });
      }

      const [{ data: share, error: shareErr }, { data: projectTracks, error: tracksErr }] = await Promise.all([
        auth.admin
          .from('project_shares')
          .select('id, token')
          .eq('id', tracked.share_id)
          .eq('project_id', tracked.project_id)
          .eq('token', tracked.share_token)
          .maybeSingle(),
        auth.admin
          .from('project_tracks')
          .select('track_id')
          .eq('project_id', tracked.project_id)
          .order('position', { ascending: true }),
      ]);
      if (shareErr) throw shareErr;
      if (tracksErr) throw tracksErr;
      if (!share) {
        return NextResponse.json({ error: 'Project share not found' }, { status: 404 });
      }

      const { data: send, error: sendErr } = await auth.admin
        .from('beat_sends')
        .insert({
          contact_id: tracked.contact_id,
          track_ids: (projectTracks ?? []).map((row: { track_id: string }) => row.track_id),
          share_token: tracked.share_token,
          message: tracked.message,
          status: 'sent',
          campaign_id: id,
          email_resend_id: tracked.email_resend_id ?? null,
        })
        .select('id, contact_id, status, sent_at')
        .single();
      if (sendErr) throw sendErr;

      const { data: target, error: targetErr } = await auth.admin
        .from('campaign_targets')
        .upsert(
          {
            campaign_id: id,
            contact_id: tracked.contact_id,
            beat_send_id: send.id,
            status: send.status,
          },
          { onConflict: 'campaign_id,contact_id' },
        )
        .select('id, contact_id, beat_send_id, status, created_at')
        .single();
      if (targetErr) throw targetErr;

      return NextResponse.json({ send, target });
    }

    const parsed = CampaignTargetsAddBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request body' }, { status: 400 });
    }

    // Only attach contacts the caller actually owns — a foreign contact id
    // would otherwise leak into the campaign via the service client.
    const [{ data: ownedContacts, error: cErr }, { data: existingSends, error: sendsErr }] = await Promise.all([
      auth.admin
        .from('contacts')
        .select('id')
        .in('id', parsed.data.contact_ids)
        .eq('user_id', auth.userId),
      auth.admin
        .from('beat_sends')
        .select('id, contact_id, status, sent_at')
        .eq('campaign_id', id)
        .in('contact_id', parsed.data.contact_ids)
        .order('sent_at', { ascending: false }),
    ]);
    if (cErr) throw cErr;
    if (sendsErr) throw sendsErr;

    const ownedIds = (ownedContacts ?? []).map((c: { id: string }) => c.id);
    if (ownedIds.length === 0) {
      return NextResponse.json({ error: 'No valid contacts to add' }, { status: 400 });
    }

    const latestByContact = new Map<string, { id: string; status: string }>();
    for (const send of (existingSends ?? []) as Array<{ id: string; contact_id: string; status: string }>) {
      if (!latestByContact.has(send.contact_id)) latestByContact.set(send.contact_id, send);
    }

    const { data, error } = await auth.admin
      .from('campaign_targets')
      .upsert(
        ownedIds.map((contact_id) => {
          const latest = latestByContact.get(contact_id);
          return {
            campaign_id: id,
            contact_id,
            ...(latest ? { beat_send_id: latest.id, status: latest.status } : {}),
          };
        }),
        { onConflict: 'campaign_id,contact_id' },
      )
      .select('id, contact_id, status, created_at');
    if (error) throw error;

    return NextResponse.json({ added: data ?? [], count: ownedIds.length });
  } catch (error) {
    log.error('POST failed', { id, error: errorMessage(error) });
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const auth = await requireRowOwnership('campaigns', id);
    if (!auth.ok) return auth.res;

    const parsed = await readBody(req, CampaignTargetsDeleteBodySchema);
    if (!parsed.ok) return parsed.res;

    const { error } = await auth.admin
      .from('campaign_targets')
      .delete()
      .eq('campaign_id', id)
      .eq('contact_id', parsed.data.contact_id);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    log.error('DELETE failed', { id, error: errorMessage(error) });
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
