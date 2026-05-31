import { NextRequest, NextResponse } from 'next/server';
import { getAppUrl } from '@/lib/env';
import { isSupabaseConfigured, getById, update, requireRowOwnership } from '@/lib/db';
import { analyzeAudio } from '@/lib/audio/analyze.server';
import { getAuddFeatures } from '@/lib/audio/audd';
import { mergeFeatures } from '@/lib/audio/merge';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';

const log = createLogger('api.tracks.analyze');

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Re-analyze a track's audio using server-side analysis.
 * Re-fetches the audio_url, runs music-tempo / music-metadata, and persists
 * any new BPM / duration / loudness fields.
 *
 * Optional body { features: {...} } lets the client push values it computed
 * with Essentia.js (browser) — those override server values when present,
 * since Essentia is more accurate.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    let track: any;
    let admin: any = null;
    if (isSupabaseConfigured()) {
      const owner = await requireRowOwnership('tracks', id);
      if (!owner.ok) return owner.res;
      admin = owner.admin;
      const { data, error } = await admin.from('tracks').select('*').eq('id', id).single();
      if (error) throw error;
      track = data;
    } else {
      track = getById('tracks', id);
    }
    if (!track) return NextResponse.json({ error: 'Track not found' }, { status: 404 });
    if (!track.audio_url) return NextResponse.json({ error: 'No audio_url on track' }, { status: 400 });

    // Body is optional — POST with no body falls through to server-side
    // analysis. But a *malformed* body (caller sent garbage JSON) should
    // 400 rather than silently skip Essentia, which would land the user
    // back on the slow server path with no explanation.
    let clientFeatures: any = null;
    let clientChords: Array<{ time: number; chord: string }> | null = null;
    const rawText = await req.text();
    if (rawText.trim().length > 0) {
      try {
        const body = JSON.parse(rawText);
        clientFeatures = body?.features || null;
        // Chord timeline (Task 8) — client-detected via Essentia HPCP. Validate
        // shape + cap length so a bad payload can't bloat the row.
        if (Array.isArray(body?.chords)) {
          clientChords = body.chords
            .filter((c: any) => c && typeof c.chord === 'string' && Number.isFinite(c.time))
            .slice(0, 2000)
            .map((c: any) => ({ time: Math.max(0, Number(c.time)), chord: String(c.chord).slice(0, 8) }));
        }
      } catch {
        return NextResponse.json(
          { error: 'Malformed JSON body. Send `{}` or `{features: {...}}`.' },
          { status: 400 },
        );
      }
    }

    // Chord-only update: when the client sends just a chord timeline (the
    // "Detect chords" button), persist it directly without re-running the full
    // audio analysis pipeline.
    if (clientChords && !clientFeatures) {
      if (isSupabaseConfigured()) {
        const { data, error } = await admin!.from('tracks').update({ chords: clientChords }).eq('id', id).select().single();
        if (error) throw error;
        return NextResponse.json({ track: data, source: 'client', chords_saved: clientChords.length });
      }
      const updated = update('tracks', id, { chords: clientChords });
      return NextResponse.json({ track: updated, source: 'client', chords_saved: clientChords.length });
    }

    // Client features are only worth keeping if they actually contain
    // BPM or key — otherwise Essentia failed silently in the browser
    // and we'd skip the server's own decode for no reason, landing on
    // double-null and a misleading 200 OK. Fall through to server when
    // the client payload is insufficient.
    const clientUsable = Boolean(
      clientFeatures &&
      (clientFeatures.bpm != null || clientFeatures.key != null),
    );

    // Re-analyze runs through the same precedence as upload:
    //   client (Essentia) > AudD vibe-fields > server heuristics.
    let serverFeatures: any = null;
    let auddFeatures: any = null;
    let buf: Buffer | null = null;

    if (!clientUsable) {
      const rawUrl: string = track.audio_url;
      // Three resolution paths, in order of robustness:
      //
      //   1. Local /uploads/... — read straight from disk. Sidesteps the
      //      NEXT_PUBLIC_APP_URL config requirement entirely. This was
      //      the root cause of "Asset Intelligence doesn't work" for
      //      most users running local dev — the fetch round-trip back
      //      to the same Next.js server timed out or 404'd when env was
      //      slightly off.
      //
      //   2. Absolute URL → HTTP fetch (R2 public URLs etc.).
      //
      //   3. Path-relative (rare; legacy) → resolve via NEXT_PUBLIC_APP_URL
      //      or the request origin.
      if (rawUrl.startsWith('/uploads/')) {
        try {
          const fs = await import('fs');
          const path = await import('path');
          const filePath = path.join(process.cwd(), 'public', rawUrl);
          buf = fs.readFileSync(filePath);
          log.info('read local file', { trackId: id, bytes: buf.length });
        } catch (err) {
          return NextResponse.json(
            { error: `Local audio file not found at ${rawUrl}. ${errorMessage(err)}` },
            { status: 404 },
          );
        }
      } else {
        let absUrl = rawUrl;
        if (rawUrl.startsWith('/')) {
          const base = getAppUrl() || req.nextUrl.origin || 'http://localhost:3000';
          absUrl = `${base}${rawUrl}`;
        }
        let upstream: Response;
        try {
          upstream = await fetch(absUrl);
        } catch (err) {
          log.error('audio fetch failed', { trackId: id, url: absUrl, error: errorMessage(err) });
          return NextResponse.json(
            { error: `Could not fetch audio from ${absUrl}: ${errorMessage(err)}` },
            { status: 502 },
          );
        }
        if (!upstream.ok) {
          log.error('audio fetch non-2xx', { trackId: id, url: absUrl, status: upstream.status });
          return NextResponse.json(
            { error: `Could not fetch audio (HTTP ${upstream.status} from ${absUrl})` },
            { status: 502 },
          );
        }
        const ab = await upstream.arrayBuffer();
        buf = Buffer.from(ab);
      }
      try {
        serverFeatures = await analyzeAudio(buf);
      } catch (err) {
        return NextResponse.json({ error: `Analysis failed: ${errorMessage(err)}` }, { status: 500 });
      }
    }

    // AudD enrichment. Two paths:
    //   1. Server-side analysis already happened → we have `buf` in
    //      memory, so AudD is a free piggyback.
    //   2. Client-side Essentia succeeded → we skipped the audio fetch.
    //      But if the track is missing the vibe-fields AudD provides
    //      (energy / danceability / valence / acousticness) AND AudD is
    //      configured, fetch the audio just for AudD so the user's
    //      "Re-analyze" actually refreshes everything they expect.
    const wantsAuddEnrichment =
      !!process.env.NEXT_PUBLIC_AUDD_API_TOKEN &&
      (track.energy == null ||
       track.danceability == null ||
       track.valence == null ||
       track.acousticness == null);

    if (!buf && clientUsable && wantsAuddEnrichment) {
      try {
        const rawUrl: string = track.audio_url;
        if (rawUrl.startsWith('/uploads/')) {
          const fs = await import('fs');
          const path = await import('path');
          buf = fs.readFileSync(path.join(process.cwd(), 'public', rawUrl));
        } else {
          let absUrl = rawUrl;
          if (rawUrl.startsWith('/')) {
            const base = getAppUrl() || req.nextUrl.origin || 'http://localhost:3000';
            absUrl = `${base}${rawUrl}`;
          }
          const upstream = await fetch(absUrl);
          if (upstream.ok) buf = Buffer.from(await upstream.arrayBuffer());
        }
      } catch (err) {
        // Non-fatal — we already have client features. Just skip AudD.
        console.warn('AudD audio fetch failed; skipping enrichment:', err);
      }
    }

    if (buf) {
      try {
        auddFeatures = await getAuddFeatures(buf, `${id}.audio`);
      } catch (err) {
        console.warn('AudD lookup failed during re-analyze:', err);
      }
    }

    const merged = mergeFeatures({
      // Only feed Essentia client features into the merge when they
      // actually have BPM or key — `clientUsable` decided that above.
      client: clientUsable ? clientFeatures : null,
      server: serverFeatures,
      audd: auddFeatures,
    });
    // Pluck server-only diagnostics out before persisting — these
    // aren't columns. The UI uses them to give an accurate failure
    // toast instead of the old "install ffmpeg" line, AND lets the
    // user see the actual decode error in the toast detail.
    const decoded = serverFeatures?._decoded ?? null;
    const ffmpegUsed = serverFeatures?._ffmpegUsed ?? false;
    const ffmpegAvailable = serverFeatures?._ffmpegAvailable ?? null;
    const bytes = serverFeatures?._bytes ?? null;
    const reason = serverFeatures?._reason ?? null;
    // Strip nulls + underscore-prefixed diagnostics so we never blow
    // away an existing value with a null or try to write to columns
    // that don't exist.
    const patch: Record<string, any> = {};
    for (const [k, v] of Object.entries(merged)) {
      if (v != null && !k.startsWith('_')) patch[k] = v;
    }
    // Persist a chord timeline alongside features when the client sent one.
    if (clientChords) patch.chords = clientChords;

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'Analysis returned no usable features' }, { status: 422 });
    }

    if (isSupabaseConfigured()) {
      // admin is non-null here because we passed the ownership check above.
      const { data, error } = await admin!.from('tracks').update(patch).eq('id', id).select().single();
      if (error) throw error;
      return NextResponse.json({ track: data, source: clientUsable ? 'client' : 'server', decoded, ffmpegUsed, ffmpegAvailable, bytes, reason });
    }

    const updated = update('tracks', id, patch);
    return NextResponse.json({ track: updated, source: clientUsable ? 'client' : 'server', decoded, ffmpegUsed, ffmpegAvailable, bytes, reason });
  } catch (error) {
    log.error('analyze failed', { trackId: id, error: errorMessage(error) });
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
