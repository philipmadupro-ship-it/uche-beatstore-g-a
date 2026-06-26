import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { initMultipart, DEFAULT_PART_SIZE, MAX_PARTS, MIN_PART_SIZE } from '@/lib/storage/multipart';
import { createSession } from '@/lib/storage/upload-sessions';
import { isSupabaseConfigured } from '@/lib/local-store';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
const log = createLogger('api.upload.init');

export const runtime = 'nodejs';
export const maxDuration = 30;

const MAX_BYTES = 500 * 1024 * 1024; // raised cap for chunked path
const ALLOWED_EXT = ['mp3', 'wav', 'flac', 'aiff', 'aif', 'm4a', 'ogg'];

function detectContentType(ext: string, fallback: string): string {
  switch (ext) {
    case 'mp3':  return 'audio/mpeg';
    case 'wav':  return 'audio/wav';
    case 'flac': return 'audio/flac';
    case 'aif':
    case 'aiff': return 'audio/aiff';
    case 'm4a':  return 'audio/mp4';
    case 'ogg':  return 'audio/ogg';
    default:     return fallback || 'application/octet-stream';
  }
}

function pickPartSize(fileSize: number): number {
  // Stay above the 5 MiB R2 minimum and below the 10k part limit
  const want = Math.max(MIN_PART_SIZE, DEFAULT_PART_SIZE);
  const minNeeded = Math.ceil(fileSize / MAX_PARTS);
  return Math.max(want, minNeeded);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const fileName: string = body.fileName;
    const fileSize: number = body.fileSize;
    const fileType: string = body.fileType || '';
    const trackType: string = body.trackType || 'instrumental';
    const projectId: string | null = body.projectId || null;
    const replaceTrackId: string | null = body.replaceTrackId || null;

    if (!fileName || typeof fileSize !== 'number' || fileSize <= 0) {
      return NextResponse.json({ error: 'fileName and fileSize required' }, { status: 400 });
    }
    if (fileSize > MAX_BYTES) {
      return NextResponse.json(
        { error: `File too large (${Math.round(fileSize / 1024 / 1024)}MB, max ${MAX_BYTES / 1024 / 1024}MB)` },
        { status: 413 }
      );
    }
    const ext = (fileName.split('.').pop() || '').toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) {
      return NextResponse.json(
        { error: `Unsupported extension ".${ext}". Supported: ${ALLOWED_EXT.join(', ')}` },
        { status: 415 }
      );
    }

    let userId: string | null = null;
    if (isSupabaseConfigured()) {
      const supabase = await createServerClient();
      try {
        const { data } = await supabase.auth.getUser();
        userId = data.user?.id || null;
      } catch (err) {
        return NextResponse.json(
          { error: `Could not verify uploader: ${errorMessage(err)}` },
          { status: 401 },
        );
      }
      // Uploads are producer-only. Without an unconditional gate, an anonymous
      // visitor could init a multipart session with no projectId and stream up
      // to MAX_BYTES into R2 (storage + bandwidth abuse) with no account — the
      // previous code only required auth when a projectId was supplied.
      if (!userId) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
      }
      // Fail fast on a replace the caller doesn't own, before we waste a large
      // upload. complete/ re-checks via requireRowOwnership as defense-in-depth.
      if (replaceTrackId) {
        const { data: target } = await supabase
          .from('tracks')
          .select('user_id')
          .eq('id', replaceTrackId)
          .maybeSingle();
        if (!target) {
          return NextResponse.json({ error: 'Track to replace not found' }, { status: 404 });
        }
        if (target.user_id && target.user_id !== userId) {
          return NextResponse.json({ error: 'Forbidden — you do not own that track' }, { status: 403 });
        }
      }
      if (projectId) {
        const destination = await resolveUploadDestination(supabase, projectId, userId);
        if (!destination.ok) return destination.res;
      }
    }

    const contentType = detectContentType(ext, fileType);
    const partSize = pickPartSize(fileSize);
    const totalParts = Math.ceil(fileSize / partSize);

    const { uploadId, key } = await initMultipart(fileName, contentType);
    const sessionId = nanoid(16);

    const session = createSession({
      sessionId,
      uploadId,
      key,
      fileName,
      fileSize,
      contentType,
      partSize,
      totalParts,
      type: trackType,
      projectId,
      replaceTrackId,
      userId,
    });

    return NextResponse.json({
      sessionId: session.sessionId,
      partSize,
      totalParts,
      uploadId,
    });
  } catch (err) {
    log.error('upload/init error:', { error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) || 'Failed to init upload' }, { status: 500 });
  }
}

async function resolveUploadDestination(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  destinationId: string,
  userId: string | null,
) {
  const ownsDestination = (row: { user_id?: string | null } | null) => {
    if (!row) return false;
    return !row.user_id || Boolean(userId && row.user_id === userId);
  };

  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('id,user_id')
    .eq('id', destinationId)
    .maybeSingle();
  if (projectError) {
    return {
      ok: false as const,
      res: NextResponse.json({ error: `Project lookup failed: ${projectError.message}` }, { status: 500 }),
    };
  }
  if (project) {
    if (!ownsDestination(project)) {
      return {
        ok: false as const,
        res: NextResponse.json({ error: 'Forbidden project destination' }, { status: 403 }),
      };
    }
    return { ok: true as const };
  }

  const { data: playlist, error: playlistError } = await supabase
    .from('playlists')
    .select('id,user_id')
    .eq('id', destinationId)
    .maybeSingle();
  if (playlistError) {
    return {
      ok: false as const,
      res: NextResponse.json({ error: `Playlist lookup failed: ${playlistError.message}` }, { status: 500 }),
    };
  }
  if (playlist) {
    if (!ownsDestination(playlist)) {
      return {
        ok: false as const,
        res: NextResponse.json({ error: 'Forbidden playlist destination' }, { status: 403 }),
      };
    }
    return { ok: true as const };
  }

  return {
    ok: false as const,
    res: NextResponse.json({ error: 'Upload destination not found' }, { status: 404 }),
  };
}
