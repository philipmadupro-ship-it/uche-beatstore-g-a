import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, createServiceClient } from '@/lib/db';
import { requireRowOwnership } from '@/lib/auth/ownership';
import { getAll, insert } from '@/lib/local-store';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
const log = createLogger('api.tracks.id.heatmap');

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: trackId } = await params;

  try {
    if (isSupabaseConfigured()) {
      // Scoped ownership check: only the track owner can read the heatmap analytics
      const owner = await requireRowOwnership('tracks', trackId);
      if (!owner.ok) return owner.res;

      const { data: pings, error } = await owner.admin
        .from('play_head_pings')
        .select('position_seconds, created_at')
        .eq('track_id', trackId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return NextResponse.json({ pings: pings || [] });
    }

    // Local-store fallback
    const all = getAll('play_head_pings' as any) || [];
    const pings = all.filter((p: any) => p.track_id === trackId);
    return NextResponse.json({ pings });
  } catch (error: any) {
    log.error('Heatmap GET error:', { error: errorMessage(error) });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: trackId } = await params;

  try {
    const body = await req.json();
    const { position_seconds, share_token } = body;

    if (position_seconds == null || Number.isNaN(Number(position_seconds))) {
      return NextResponse.json({ error: 'Invalid position_seconds' }, { status: 400 });
    }

    const pos = Number(position_seconds);

    if (isSupabaseConfigured()) {
      const admin = createServiceClient();
      const { data: ping, error } = await admin
        .from('play_head_pings')
        .insert({
          track_id: trackId,
          share_token: share_token || null,
          position_seconds: pos,
        })
        .select()
        .single();

      if (error) throw error;
      return NextResponse.json({ ping });
    }

    // Local-store fallback
    const ping = insert('play_head_pings' as any, {
      track_id: trackId,
      share_token: share_token || null,
      position_seconds: pos,
      created_at: new Date().toISOString(),
    });

    return NextResponse.json({ ping });
  } catch (error: any) {
    log.error('Heatmap POST error:', { error: errorMessage(error) });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
