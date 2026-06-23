import { NextRequest, NextResponse } from 'next/server';
import { requireRowOwnership } from '@/lib/auth/ownership';
import { errorMessage } from '@/lib/errors';
import { readBody } from '@/lib/validate';
import { CampaignPatchBodySchema } from '@/lib/contracts';
import { createLogger } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.campaigns.detail');

/**
 * GET    /api/campaigns/[id]  → campaign + targets (with contact info + send rollup)
 * PATCH  /api/campaigns/[id]  → edit name / description / nudge cadence
 * DELETE /api/campaigns/[id]  → delete campaign (targets cascade; beat_sends keep
 *                               their rows, campaign_id nulls via FK)
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const auth = await requireRowOwnership('campaigns', id);
    if (!auth.ok) return auth.res;

    const [
      { data: campaign, error: cErr },
      { data: targets, error: tErr },
      { data: sends, error: sErr },
    ] = await Promise.all([
      auth.admin
        .from('campaigns')
        .select('id, name, description, nudge_after_days, started_at, ended_at, created_at, updated_at')
        .eq('id', id)
        .single(),
      auth.admin
        .from('campaign_targets')
        .select('id, contact_id, beat_send_id, status, last_nudge_at, nudge_count, created_at, contacts(id, name, email, role)')
        .eq('campaign_id', id)
        .order('created_at', { ascending: false }),
      auth.admin
        .from('beat_sends')
        .select('id, contact_id, status, sent_at, track_ids')
        .eq('campaign_id', id),
    ]);
    if (cErr) throw cErr;
    if (tErr) throw tErr;
    if (sErr) throw sErr;

    // beat_sends is authoritative. campaign_targets.status is only a cache
    // for list-level funnel queries, so reconcile it to each contact's latest
    // send whenever the campaign is opened.
    type CampaignSend = {
      id: string;
      contact_id: string | null;
      status: string | null;
      sent_at: string | null;
    };
    const sendsByContact = new Map<string, {
      count: number;
      last_sent_at: string | null;
      latest: CampaignSend | null;
    }>();
    for (const s of (sends ?? []) as CampaignSend[]) {
      if (!s.contact_id) continue;
      const cur = sendsByContact.get(s.contact_id) ?? { count: 0, last_sent_at: null, latest: null };
      cur.count += 1;
      if (!cur.latest || (s.sent_at ?? '') > (cur.latest.sent_at ?? '')) {
        cur.latest = s;
        cur.last_sent_at = s.sent_at;
      }
      sendsByContact.set(s.contact_id, cur);
    }

    const syncs: PromiseLike<unknown>[] = [];
    const enrichedTargets = ((targets ?? []) as Array<Record<string, unknown>>).map((t) => {
      const contact = (t.contacts ?? null) as { id: string; name: string; email: string | null; role: string | null } | null;
      const rollup = sendsByContact.get(t.contact_id as string) ?? { count: 0, last_sent_at: null, latest: null };
      const status = rollup.latest?.status ?? t.status;

      if (
        rollup.latest
        && (t.beat_send_id !== rollup.latest.id || t.status !== status)
      ) {
        syncs.push(
          auth.admin
            .from('campaign_targets')
            .update({ beat_send_id: rollup.latest.id, status })
            .eq('id', t.id as string)
            .then(({ error }) => {
              if (error) throw error;
            }),
        );
      }

      return {
        id: t.id,
        contact_id: t.contact_id,
        status,
        last_nudge_at: t.last_nudge_at,
        nudge_count: t.nudge_count,
        created_at: t.created_at,
        contact,
        sends_count: rollup.count,
        last_sent_at: rollup.last_sent_at,
      };
    });

    await Promise.all(syncs);

    return NextResponse.json({ campaign, targets: enrichedTargets });
  } catch (error) {
    log.error('GET failed', { id, error: errorMessage(error) });
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const auth = await requireRowOwnership('campaigns', id);
    if (!auth.ok) return auth.res;

    const parsed = await readBody(req, CampaignPatchBodySchema);
    if (!parsed.ok) return parsed.res;

    const { data, error } = await auth.admin
      .from('campaigns')
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id, name, description, nudge_after_days, started_at, ended_at, created_at, updated_at')
      .single();
    if (error) throw error;
    return NextResponse.json({ campaign: data });
  } catch (error) {
    log.error('PATCH failed', { id, error: errorMessage(error) });
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const auth = await requireRowOwnership('campaigns', id);
    if (!auth.ok) return auth.res;

    const { error } = await auth.admin.from('campaigns').delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    log.error('DELETE failed', { id, error: errorMessage(error) });
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
