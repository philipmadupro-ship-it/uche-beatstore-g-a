import { NextResponse } from 'next/server';
import { createServiceClient, requireUser } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface AudioDiagnosticsTrackRow {
  id: string;
  title: string;
  audio_url: string | null;
}

interface AudioDiagnosticsTrackEntry extends AudioDiagnosticsTrackRow {
  audio_url_host: string | null;
  host_matches_r2: boolean;
  head_status: number | null;
  head_content_type: string | null;
  head_content_length: string | null;
  head_error: string | null;
}

interface AudioDiagnosticsResponse {
  env: {
    app_url: string | null;
    r2_public_url: string | null;
    r2_account: boolean;
    r2_access_key: boolean;
    r2_secret_key: boolean;
    r2_bucket: boolean;
  };
  proxy: {
    r2_public_host: string | null;
    r2_public_host_parse_error: string | null;
  };
  tracks: AudioDiagnosticsTrackEntry[];
  hints: string[];
}

/**
 * GET /api/audio/diagnostics
 *
 * Sniffs out the most common "waveform unavailable" causes WITHOUT
 * the user needing to read network tabs or Vercel logs. The audio
 * pipeline is short — three things have to be true for playback to
 * work:
 *
 *   1. tracks.audio_url stores a real URL pointing at a real file.
 *   2. NEXT_PUBLIC_R2_PUBLIC_URL points at a host that matches
 *      tracks.audio_url's host (otherwise /api/audio's allowlist
 *      check returns 403 "Host not allowed").
 *   3. The R2 bucket actually serves the bytes for that URL when
 *      the server fetches it (CORS doesn't apply server-to-server,
 *      but bucket permission can still 403).
 *
 * For each of the caller's tracks (capped at 5 to keep this cheap):
 *   - HEAD the audio_url server-side
 *   - report status + content-type + content-length
 *   - flag host-mismatch against R2_PUBLIC_URL
 *
 * Owner-gated so a random visitor can't enumerate R2 keys.
 */
export async function GET() {
  const out: AudioDiagnosticsResponse = {
    env: {
      app_url: process.env.NEXT_PUBLIC_APP_URL ?? null,
      r2_public_url: process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? null,
      r2_account: !!process.env.R2_ACCOUNT_ID,
      r2_access_key: !!process.env.R2_ACCESS_KEY_ID,
      r2_secret_key: !!process.env.R2_SECRET_ACCESS_KEY,
      r2_bucket: !!process.env.R2_BUCKET_NAME,
    },
    proxy: {
      // The /api/audio proxy compares target.host vs r2_public_url's host.
      // Mismatch → 403 "Host not allowed" → "waveform unavailable" in the
      // UI without a clear server log on the client side.
      r2_public_host: null as string | null,
      r2_public_host_parse_error: null as string | null,
    },
    tracks: [] as Array<{
      id: string;
      title: string;
      audio_url: string | null;
      audio_url_host: string | null;
      host_matches_r2: boolean;
      head_status: number | null;
      head_content_type: string | null;
      head_content_length: string | null;
      head_error: string | null;
    }>,
    hints: [] as string[],
  };

  if (!out.env.r2_public_url) {
    out.hints.push('NEXT_PUBLIC_R2_PUBLIC_URL not set — the /api/audio proxy will reject every request with 500 "Missing R2 base URL".');
  } else {
    try {
      out.proxy.r2_public_host = new URL(out.env.r2_public_url).host;
    } catch (err) {
      out.proxy.r2_public_host_parse_error = errorMessage(err);
      out.hints.push('NEXT_PUBLIC_R2_PUBLIC_URL is malformed — must be a full URL like https://pub-xxx.r2.dev.');
    }
  }

  if (!out.env.app_url || out.env.app_url.includes('localhost')) {
    out.hints.push('NEXT_PUBLIC_APP_URL is missing or set to localhost — fix in Vercel env so server-side fetches work.');
  }

  if (!isSupabaseConfigured()) {
    out.hints.push('Supabase not configured — cannot sample tracks.');
    return NextResponse.json(out);
  }

  const auth = await requireUser();
  if (!auth.ok) {
    out.hints.push('Sign in to see per-track diagnostics.');
    return NextResponse.json(out, { status: 401 });
  }

  const admin = createServiceClient();
  const { data: tracks } = await admin
    .from('tracks')
    .select('id, title, audio_url')
    .eq('user_id', auth.userId)
    .order('created_at', { ascending: false })
    .limit(5);

  for (const t of (tracks ?? []) as AudioDiagnosticsTrackRow[]) {
    const entry: AudioDiagnosticsTrackEntry = {
      id: t.id,
      title: t.title,
      audio_url: t.audio_url,
      audio_url_host: null,
      host_matches_r2: false,
      head_status: null,
      head_content_type: null,
      head_content_length: null,
      head_error: null,
    };
    if (!t.audio_url) {
      entry.head_error = 'audio_url is null on this track';
      out.tracks.push(entry);
      continue;
    }
    if (t.audio_url.startsWith('/')) {
      entry.audio_url_host = '(relative path)';
      entry.host_matches_r2 = true; // local /uploads — proxy passes through
    } else {
      try {
        const u = new URL(t.audio_url);
        entry.audio_url_host = u.host;
        entry.host_matches_r2 = out.proxy.r2_public_host
          ? u.host === out.proxy.r2_public_host
          : false;
      } catch (err) {
        entry.head_error = `Bad URL: ${errorMessage(err)}`;
        out.tracks.push(entry);
        continue;
      }

      // Server-side HEAD. Same-origin to R2; CORS doesn't apply here.
      try {
        const res = await fetch(t.audio_url, { method: 'HEAD', cache: 'no-store' });
        entry.head_status = res.status;
        entry.head_content_type = res.headers.get('content-type');
        entry.head_content_length = res.headers.get('content-length');
        if (res.status >= 400) {
          entry.head_error = `R2 returned ${res.status}`;
        }
      } catch (err) {
        entry.head_error = `HEAD failed: ${errorMessage(err)}`;
      }
    }
    out.tracks.push(entry);
  }

  // Surface hints based on the per-track results.
  const sampled = out.tracks;
  if (sampled.length === 0) {
    out.hints.push('No tracks found for this user — upload one to test playback.');
  } else {
    const hostMismatch = sampled.filter((t) => t.audio_url && !t.host_matches_r2 && !t.audio_url.startsWith('/'));
    if (hostMismatch.length) {
      out.hints.push(
        `${hostMismatch.length}/${sampled.length} tracks have an audio_url host that doesn't match NEXT_PUBLIC_R2_PUBLIC_URL. The /api/audio proxy will 403 these. Either update NEXT_PUBLIC_R2_PUBLIC_URL or re-upload the affected tracks.`,
      );
    }
    const dead = sampled.filter((t) => t.head_status && t.head_status >= 400);
    if (dead.length) {
      out.hints.push(
        `${dead.length}/${sampled.length} tracks return ${dead.map((t) => t.head_status).join(',')} from R2 when fetched server-side. Bucket access policy may have changed, or the object key is wrong.`,
      );
    }
    const unreachable = sampled.filter((t) => t.head_error && !t.head_status);
    if (unreachable.length) {
      out.hints.push(
        `${unreachable.length}/${sampled.length} tracks couldn't be reached at all from this server (network / DNS). First error: ${unreachable[0].head_error}`,
      );
    }
    if (
      hostMismatch.length === 0 &&
      dead.length === 0 &&
      unreachable.length === 0
    ) {
      out.hints.push('All sampled tracks are reachable from the server. If the browser still shows "waveform unavailable", it\'s a client-side fetch issue — open DevTools → Network → look at the /api/audio request.');
    }
  }

  return NextResponse.json(out);
}
