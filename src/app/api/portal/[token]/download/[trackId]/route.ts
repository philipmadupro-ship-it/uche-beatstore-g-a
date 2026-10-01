import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { publicError } from '@/lib/api-error';
import { clientIp, rateLimitDurable } from '@/lib/security/rate-limit';
import { streamAudioSource } from '@/lib/audio/stream-source';
import { shareGrantsTrack } from '@/lib/share/share-owner';
import { gatePortal } from '@/lib/artist-portal/gate';
import { portalProjectsWithTrack } from '@/lib/artist-portal/membership';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.portal.download');

/**
 * GET /api/portal/[token]/download/[trackId]
 *
 * Streams the file after the gate, membership and the per-project permission
 * (`project_contacts.allow_downloads` on at least one portal project holding
 * the track). The storage reference never leaves the server: this route
 * streams, it does not redirect. WAV when there is one, else the upload.
 * Each download is logged on the contact's timeline.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string; trackId: string }> }) {
  const { token, trackId } = await params;
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!(await rateLimitDurable(`portaldl:${clientIp(req)}`, 30, 60_000))) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  try {
    const admin = createServiceClient();
    const gate = await gatePortal(admin, token, req);
    if (!gate.ok) return gate.res;
    const portal = gate.portal;

    const projects = await portalProjectsWithTrack(admin, portal, trackId);
    if (projects.length === 0 || !(await shareGrantsTrack(admin, portal.user_id, trackId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (!projects.some((p) => p.allow_downloads)) {
      return NextResponse.json({ error: 'Downloads are off for this project.' }, { status: 403 });
    }

    const { data: track } = await admin
      .from('tracks')
      .select('title, audio_url, wav_url')
      .eq('id', trackId)
      .eq('user_id', portal.user_id)
      .maybeSingle();
    const source = (track as { wav_url?: string | null } | null)?.wav_url || (track as { audio_url?: string | null } | null)?.audio_url;
    if (!track || !source) return NextResponse.json({ error: 'File unavailable' }, { status: 404 });

    const ext = (source.match(/\.(mp3|wav|flac|aiff|aif|m4a|ogg)(?:\?|$)/i)?.[1] ?? 'wav').toLowerCase();
    const { error: actErr } = await admin.from('contact_activity').insert({
      contact_id: portal.contact_id,
      user_id: portal.user_id,
      kind: 'track_downloaded',
      title: `Downloaded ${track.title ?? 'a beat'}`,
      metadata: { track_id: trackId, source: 'portal' },
    });
    if (actErr) log.warn('download timeline row failed', { error: errorMessage(actErr) });

    return streamAudioSource(req, source, `${track.title || 'track'}.${ext}`);
  } catch (err) {
    log.error('portal download failed', { trackId, error: errorMessage(err) });
    return publicError(err);
  }
}
