import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, insert, createServiceClient } from '@/lib/db';
import { createHash } from 'crypto';
import { errorMessage } from '@/lib/errors';

function hashIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for') || '';
  const ip = fwd.split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown';
  return createHash('sha256').update(`${ip}:${process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'antigravity'}`).digest('hex').slice(0, 32);
}

/**
 * POST /api/share/[token]/play
 * Body: { track_id: string }
 *
 * Logs a per-track play event from a public share page.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    const body = await req.json().catch(() => ({}));
    const track_id = typeof body.track_id === 'string' ? body.track_id : null;

    // Referer header → platform-source analytics (mig 076). Capped + best
    // effort; absent on direct opens. Stored raw, bucketed at read time.
    const referrer = (req.headers.get('referer') || '').slice(0, 500) || null;

    const row = {
      link_token: token,
      track_id,
      ip_hash: hashIp(req),
      referrer,
      played_at: new Date().toISOString(),
    };

    if (isSupabaseConfigured()) {
      const supabase = createServiceClient();
      // referrer column is mig 076 — retry without it if the migration
      // hasn't been applied yet so play logging never hard-fails.
      let { error } = await supabase.from('share_plays').insert(row);
      if (error && /referrer/i.test(error.message)) {
        const { referrer: _drop, ...legacy } = row;
        ({ error } = await supabase.from('share_plays').insert(legacy));
      }
      if (error) throw error;
    } else {
      insert('share_plays', row);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Share play log error:', error);
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
