import { NextRequest, NextResponse } from 'next/server';
import { startJob, pickBackend } from '@/lib/stems/dispatch';
import { isSupabaseConfigured, update, insert, query, requireRowOwnership, createServiceClient } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
const log = createLogger('api.stems');
import { readBody } from '@/lib/validate';
import { StemStartBodySchema } from '@/lib/contracts';

/**
 * GET /api/stems?track_id=xxx
 * Returns the latest stem record for a track (vocals/drums/bass/other URLs).
 */
export async function GET(req: NextRequest) {
  try {
    const trackId = req.nextUrl.searchParams.get('track_id');
    if (!trackId) {
      return NextResponse.json({ error: 'track_id required' }, { status: 400 });
    }

    if (isSupabaseConfigured()) {
      const owner = await requireRowOwnership('tracks', trackId);
      if (!owner.ok) return owner.res;
      const { data, error } = await owner.admin
        .from('stems')
        .select('*')
        .eq('track_id', trackId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return NextResponse.json({ stem: data || null });
    }

    const rows = query('stems', (s: any) => s.track_id === trackId);
    const latest = rows.sort((a: any, b: any) =>
      String(b.created_at || '').localeCompare(String(a.created_at || ''))
    )[0];
    return NextResponse.json({ stem: latest || null });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await readBody(req, StemStartBodySchema);
    if (!parsed.ok) return parsed.res;
    const { trackId, audioUrl, model } = parsed.data;

    // Gate stem-split kickoff on track ownership — the job hits Demucs which
    // is non-trivially expensive (CPU minutes on the GPU host). Without this
    // check any authenticated user could pin random tracks to the queue and
    // burn the budget.
    if (isSupabaseConfigured()) {
      const owner = await requireRowOwnership('tracks', trackId);
      if (!owner.ok) return owner.res;
    }

    // Pick a backend (Demucs local if reachable, else Moises if API key
    // is set). Surface the dispatcher's combined-error message so the
    // user knows what's actually missing.
    const pick = await pickBackend();
    if (!pick.ok) {
      return NextResponse.json({ error: pick.reason }, { status: 503 });
    }

    // Submit to whichever backend was picked. The returned id is prefixed
    // (`demucs:` / `moises:`) so the polling endpoint can route correctly.
    const { jobId, backend } = await startJob(audioUrl, model ?? 'htdemucs');

    // Persist job reference in local store / Supabase
    if (isSupabaseConfigured()) {
      // Centralized service-role client — same admin posture as
      // requireRowOwnership but used here without the gate because the
      // ownership check above already approved this caller for trackId.
      const supabase = createServiceClient();
      await supabase.from('tracks').update({ stems_status: 'pending' }).eq('id', trackId);
      await supabase.from('stems').insert({ track_id: trackId, job_id: jobId, status: 'pending' });
    } else {
      update('tracks', trackId, { stems_status: 'pending' });
      insert('stems', { track_id: trackId, job_id: jobId, status: 'pending' });
    }

    return NextResponse.json({ jobId, backend });
  } catch (error) {
    log.error('Stem split start error:', { error: errorMessage(error) });
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
