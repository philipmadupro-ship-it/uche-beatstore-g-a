import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/local-store';
import { publicError } from '@/lib/api-error';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/store/drops   — public list of upcoming drops, soonest first.
 * POST /api/store/drops  — subscribe an email to a specific drop.
 *
 * "Drop" = a track whose scheduled_publish_at is in the future and
 * store_listed=false. When the time hits, the existing cron at
 * /api/cron/publish-scheduled flips it live + emails subscribers
 * (extended in the same commit).
 */

export async function GET() {
  if (!isSupabaseConfigured()) return NextResponse.json({ drops: [] });

  try {
    const admin = createServiceClient();
    const nowIso = new Date().toISOString();
    const { data, error } = await admin
      .from('tracks')
      .select('id, title, cover_url, type, bpm, key, scale, scheduled_publish_at')
      .not('scheduled_publish_at', 'is', null)
      .eq('store_listed', false)
      .gt('scheduled_publish_at', nowIso)
      .order('scheduled_publish_at', { ascending: true })
      .limit(12);
    if (error) throw error;
    return NextResponse.json({ drops: data ?? [] });
  } catch (err) {
    return publicError(err);
  }
}

const postSchema = z.object({
  track_id: z.string().uuid(),
  email: z.string().email(),
});

export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Subscriptions unavailable' }, { status: 503 });
  }
  try {
    const raw = await req.json().catch(() => ({}));
    const parsed = postSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Valid email + track_id required' }, { status: 400 });
    }
    const admin = createServiceClient();

    // Guard: the track must still be scheduled (not already-live, not
    // unscheduled). Don't accept subscriptions for already-live tracks —
    // there's nothing to notify about.
    const { data: track } = await admin
      .from('tracks')
      .select('id, store_listed, scheduled_publish_at')
      .eq('id', parsed.data.track_id)
      .maybeSingle();
    if (!track) return NextResponse.json({ error: 'Track not found' }, { status: 404 });
    if ((track as any).store_listed) {
      return NextResponse.json({ error: 'Track is already live' }, { status: 400 });
    }
    if (!(track as any).scheduled_publish_at) {
      return NextResponse.json({ error: 'Track has no scheduled drop' }, { status: 400 });
    }

    const { error } = await admin
      .from('drop_subscribers')
      .upsert(
        {
          track_id: parsed.data.track_id,
          email: parsed.data.email.toLowerCase(),
        },
        { onConflict: 'track_id,email' },
      );
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    return publicError(err);
  }
}
