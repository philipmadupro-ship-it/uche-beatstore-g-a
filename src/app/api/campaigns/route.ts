import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/ownership';
import { isSupabaseConfigured, getAll, insert } from '@/lib/local-store';
import { errorMessage } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET  /api/campaigns           → list the caller's campaigns + per-row stats
 * POST /api/campaigns           → create a new campaign
 *
 * Stats are computed on the fly by joining campaign_targets and
 * beat_sends. They're cheap at the volumes a single producer's
 * outbox produces — we'll memo the aggregate if it ever shows up
 * in slow logs.
 */

export async function GET() {
  try {
    if (!isSupabaseConfigured()) {
      const campaigns = getAll('campaigns') ?? [];
      return NextResponse.json({ campaigns });
    }
    const auth = await requireUser();
    if (!auth.ok) return auth.res;

    const { data: campaigns, error } = await auth.admin
      .from('campaigns')
      .select('id, name, description, nudge_after_days, started_at, ended_at, created_at, updated_at')
      .eq('user_id', auth.userId)
      .order('created_at', { ascending: false });
    if (error) throw error;

    // Pull target counts and a coarse funnel breakdown in one query
    // per campaign — fine for tens of campaigns. Anything larger and
    // we'd push this into a SQL view.
    const campaignIds = (campaigns ?? []).map((c) => c.id);
    const targetsByCampaign = new Map<string, { total: number; placed: number; pass: number; pending: number }>();
    if (campaignIds.length) {
      const { data: targets } = await auth.admin
        .from('campaign_targets')
        .select('campaign_id, status')
        .in('campaign_id', campaignIds);
      for (const t of targets ?? []) {
        const cur = targetsByCampaign.get(t.campaign_id) ?? { total: 0, placed: 0, pass: 0, pending: 0 };
        cur.total += 1;
        if (t.status === 'placed') cur.placed += 1;
        else if (t.status === 'pass') cur.pass += 1;
        else cur.pending += 1;
        targetsByCampaign.set(t.campaign_id, cur);
      }
    }

    const enriched = (campaigns ?? []).map((c) => ({
      ...c,
      stats: targetsByCampaign.get(c.id) ?? { total: 0, placed: 0, pass: 0, pending: 0 },
    }));
    return NextResponse.json({ campaigns: enriched });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) {
      return NextResponse.json({ error: 'Campaign name is required' }, { status: 400 });
    }
    if (name.length > 200) {
      return NextResponse.json({ error: 'Name too long (200 char max)' }, { status: 400 });
    }
    const description = typeof body.description === 'string' ? body.description.trim().slice(0, 5000) : null;
    const nudgeAfterDays = Number.isFinite(Number(body.nudge_after_days))
      ? Math.max(1, Math.min(60, Number(body.nudge_after_days)))
      : null;

    if (!isSupabaseConfigured()) {
      const campaign = insert('campaigns', {
        user_id: null,
        name,
        description,
        nudge_after_days: nudgeAfterDays,
        started_at: null,
        ended_at: null,
      });
      return NextResponse.json({ campaign });
    }

    const auth = await requireUser();
    if (!auth.ok) return auth.res;

    const { data, error } = await auth.admin
      .from('campaigns')
      .insert({
        user_id: auth.userId,
        name,
        description,
        nudge_after_days: nudgeAfterDays,
      })
      .select('id, name, description, nudge_after_days, started_at, ended_at, created_at, updated_at')
      .single();
    if (error) throw error;
    return NextResponse.json({ campaign: data });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
