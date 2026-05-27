import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { estimateBpm } from '@/lib/audio/bpm';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/local-store';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';

const log = createLogger('api.store.beat-match');
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/store/beat-match
 *
 * Two payload shapes — same response:
 *
 *   1. multipart/form-data with a `clip` File (≤10 MB, ≤45 seconds)
 *      → server estimates BPM and returns matches.
 *   2. JSON { bpm: number, key?: string }
 *      → server skips the decode and goes straight to matching
 *        (lets the client pre-extract on the audio context).
 *
 * Optional ?genre=trap to bias matches toward a specific genre tag.
 *
 * Response:
 *   { bpm, duration?, matches: Array<{ track, score, reasons[] }> }
 *
 * Scoring:
 *   • BPM proximity: 100 - min(20, |Δ|) * 5 (so ±5 BPM = perfect)
 *   • Genre tag match: +20 if the optional ?genre matches
 *   • Half-time / double-time recognition: tracks within ±5 BPM
 *     of (clip * 2) or (clip / 2) get the same score as in-tempo
 *     (rappers swap between half-time + regular all the time).
 */

const jsonSchema = z.object({
  bpm: z.number().min(40).max(300),
  key: z.string().optional(),
});

const MAX_FILE_BYTES = 10 * 1024 * 1024;

function bpmScore(targetBpm: number, candidateBpm: number | null): number {
  if (candidateBpm == null) return 0;
  // Score the best of: same tempo, half-time, double-time.
  const candidates = [candidateBpm, candidateBpm * 2, candidateBpm / 2];
  const best = candidates.reduce((acc, b) => Math.min(acc, Math.abs(b - targetBpm)), Infinity);
  return Math.max(0, 100 - Math.min(20, best) * 5);
}

interface MatchTrack {
  id: string;
  title: string;
  cover_url: string | null;
  bpm: number | null;
  key: string | null;
  scale: string | null;
  type: string | null;
  lease_price_usd: number | null;
  exclusive_price_usd: number | null;
  free_download_enabled: boolean | null;
  tags?: Array<{ tag: string; category: string | null }>;
}

export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Beat-match unavailable in offline mode' }, { status: 503 });
  }

  try {
    const contentType = req.headers.get('content-type') ?? '';
    const url = new URL(req.url);
    const genreBias = url.searchParams.get('genre')?.toLowerCase() ?? null;

    let bpm: number | null = null;
    let duration: number | undefined;

    if (contentType.startsWith('multipart/form-data')) {
      const formData = await req.formData();
      const clip = formData.get('clip');
      if (!(clip instanceof File)) {
        return NextResponse.json({ error: 'Provide a clip File' }, { status: 400 });
      }
      if (clip.size === 0 || clip.size > MAX_FILE_BYTES) {
        return NextResponse.json({ error: 'Clip must be 0 < size ≤ 10MB' }, { status: 400 });
      }
      const ab = await clip.arrayBuffer();
      const result = await estimateBpm(Buffer.from(ab));
      if (!result) {
        return NextResponse.json({ error: "Couldn't decode that clip — try MP3/WAV/M4A" }, { status: 400 });
      }
      bpm = result.bpm;
      duration = result.duration;
    } else {
      const raw = await req.json().catch(() => ({}));
      const parsed = jsonSchema.safeParse(raw);
      if (!parsed.success) {
        return NextResponse.json({ error: 'Provide bpm or a multipart clip' }, { status: 400 });
      }
      bpm = parsed.data.bpm;
    }
    if (bpm == null) return NextResponse.json({ error: 'No BPM resolved' }, { status: 400 });

    const admin = createServiceClient();
    const { data: tracks, error } = await admin
      .from('tracks')
      .select('id, title, cover_url, bpm, key, scale, type, lease_price_usd, exclusive_price_usd, free_download_enabled')
      .eq('store_listed', true)
      .limit(200);
    if (error) throw error;

    const trackRows = (tracks ?? []) as MatchTrack[];
    if (trackRows.length === 0) {
      return NextResponse.json({ bpm, duration, matches: [] });
    }

    // Optional tag lookup for genre bias
    let genreTrackIds = new Set<string>();
    if (genreBias) {
      const { data: tagRows } = await admin
        .from('track_tags')
        .select('track_id, tag, category')
        .ilike('tag', genreBias)
        .eq('category', 'genre');
      genreTrackIds = new Set(((tagRows ?? []) as any[]).map((r) => r.track_id as string));
    }

    const scored = trackRows
      .map((t) => {
        const s = bpmScore(bpm!, t.bpm);
        const reasons: string[] = [];
        if (t.bpm != null) {
          const delta = Math.min(
            Math.abs(t.bpm - bpm!),
            Math.abs(t.bpm * 2 - bpm!),
            Math.abs(t.bpm / 2 - bpm!),
          );
          if (delta <= 2) reasons.push(`spot-on BPM (${t.bpm})`);
          else if (delta <= 5) reasons.push(`${t.bpm} BPM (close)`);
          else if (delta <= 10) reasons.push(`${t.bpm} BPM`);
        }
        let score = s;
        if (genreTrackIds.has(t.id)) {
          score += 20;
          reasons.push(`genre · ${genreBias}`);
        }
        return { track: t, score, reasons };
      })
      .filter((m) => m.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);

    log.info('beat-match served', { bpm, candidates: trackRows.length, returned: scored.length });
    return NextResponse.json({ bpm, duration, matches: scored });
  } catch (err) {
    log.warn('beat-match failed', { error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
