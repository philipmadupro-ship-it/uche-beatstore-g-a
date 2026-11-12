import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { selectIn } from '@/lib/db/chunked-in';
import { errorMessage } from '@/lib/errors';
import { publicError } from '@/lib/api-error';
import { createLogger } from '@/lib/log';
import { streamAudioSource } from '@/lib/audio/stream-source';
import { clientIp, rateLimitDurable } from '@/lib/security/rate-limit';
import { zipStream } from '@/lib/tracks/zip-stream';
import { grantableTrackIds, projectShareOwnerId } from '@/lib/share/share-owner';
import { shareZipName, zipEntryNames } from '@/lib/share/zip-names';
import {
  lockableOf,
  resolveShareToken,
  shareAccessFailure,
  shareGateResponse,
  shareLifecycleFailure,
  shareNotFoundResponse,
  sharePasswordFrom,
  type ResolvedShare,
} from '@/lib/share/token-access';

const log = createLogger('api.share.download-all');
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** One archive per IP-minute is plenty; each one streams every master of the share. */
const ZIPS_PER_MINUTE = 6;
export const SHARE_ZIP_MAX_TRACKS = 200;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

/** The track ids a share covers, in the producer's order. */
async function shareTrackIds(admin: Admin, resolved: Exclude<ResolvedShare, { kind: 'paid_access' | 'artist_portal' }>): Promise<{ ids: string[]; ownerId: string | null }> {
  if (resolved.kind === 'share_link') {
    const ids = Array.isArray(resolved.row.track_ids) ? resolved.row.track_ids : [];
    return { ids, ownerId: resolved.row.user_id ?? null };
  }
  const share = resolved.row;
  const ownerId = await projectShareOwnerId(admin, share);
  const kind = share.content_type ?? 'project';
  if (kind === 'track') return { ids: share.track_id ? [share.track_id] : [], ownerId };
  const [table, key, id] = kind === 'playlist' && share.playlist_id
    ? ['playlist_tracks', 'playlist_id', share.playlist_id]
    : ['project_tracks', 'project_id', share.project_id];
  if (!id) return { ids: [], ownerId };
  const { data } = await admin.from(table as string).select('track_id, position').eq(key as string, id).order('position', { ascending: true });
  return { ids: ((data ?? []) as { track_id: string }[]).map((r) => r.track_id), ownerId };
}

/**
 * GET /api/share/[token]/download-all — every track of a share in ONE zip.
 *
 * The same gate as the single-track download, in the same order: a dead link
 * says so (410) first, then the password (401), then whether the producer
 * allowed downloads at all (403). Only a free `allow_downloads` share can ask
 * for this: a per-track purchase grants one track and never the set. Each file
 * is opened through `streamAudioSource` (the storage path, Range-aware), never
 * a public URL, and only tracks the share's owner may grant are included.
 * Entries are STORED, not deflated (lib/tracks/zip-stream).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  }
  if (!(await rateLimitDurable(`dlzip:${clientIp(req)}`, ZIPS_PER_MINUTE, 60_000))) {
    return NextResponse.json({ error: 'Too many requests. Wait a minute and try again.' }, { status: 429, headers: { 'Retry-After': '60' } });
  }

  try {
    const admin = createServiceClient();
    const resolved = await resolveShareToken(admin, token, ['project_share', 'share_link']);
    if (!resolved || (resolved.kind !== 'project_share' && resolved.kind !== 'share_link')) return shareNotFoundResponse();

    const lifecycle = shareLifecycleFailure(lockableOf(resolved));
    if (lifecycle) return shareGateResponse(lifecycle);
    const locked = await shareAccessFailure(lockableOf(resolved), { password: sharePasswordFrom(req) });
    if (locked) return shareGateResponse(locked);
    if (resolved.row.allow_downloads !== true) {
      return NextResponse.json({ error: 'Downloads are off for this link.' }, { status: 403 });
    }

    const { ids, ownerId } = await shareTrackIds(admin, resolved);
    const allowed = await grantableTrackIds(admin, ownerId, ids);
    if (allowed.length === 0) return NextResponse.json({ error: 'Nothing to download.' }, { status: 404 });
    if (allowed.length > SHARE_ZIP_MAX_TRACKS) {
      return NextResponse.json({ error: `Too many tracks for one download (limit ${SHARE_ZIP_MAX_TRACKS}). Download them one by one.` }, { status: 413 });
    }

    const rows = await selectIn<{ id: string; title: string | null; audio_url: string | null }>(
      (chunk) => admin.from('tracks').select('id, title, audio_url').in('id', chunk),
      allowed,
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    const files = allowed.map((id) => byId.get(id)).filter((r): r is NonNullable<typeof r> => !!r?.audio_url);
    if (files.length === 0) return NextResponse.json({ error: 'Nothing to download.' }, { status: 404 });

    const names = zipEntryNames(files);
    const plain = new NextRequest(req.url);
    const entries = files.map((f, i) => ({
      name: names[i],
      open: async () => {
        const res = await streamAudioSource(plain, f.audio_url as string, names[i]);
        return res.ok && res.body ? res.body : null;
      },
    }));
    const body = zipStream(entries, {
      onSkip: (name, reason) => log.warn('zip entry skipped', { token, name, reason }),
    });
    const filename = shareZipName((resolved.row as { label?: string | null }).label);
    return new Response(body, {
      headers: {
        'content-type': 'application/zip',
        'content-disposition': `attachment; filename="${filename.replace(/[\r\n"\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (err) {
    log.error('download-all failed', { token, error: errorMessage(err) });
    return publicError(err);
  }
}
