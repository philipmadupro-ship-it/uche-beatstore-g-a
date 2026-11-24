import { NextRequest, NextResponse, after } from 'next/server';
import { pickBackend } from '@/lib/stems/dispatch';
import { isSupabaseConfigured, requireRowOwnership } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { readBody } from '@/lib/validate';
import { StemStartBodySchema } from '@/lib/contracts';
import { enqueueStemJob, processStemBatch } from '@/lib/stems/pipeline';
import { defaultPipelineDeps } from '@/lib/stems/runtime';
import { toStemJobView } from '@/lib/stems/view';

const log = createLogger('api.stems');
export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * GET /api/stems?track_id=xxx
 * `job` is the server's truth about the split (queued / processing / ready /
 * failed, with the error), read from the stems row, so the drawer can resume
 * after a reload. `stem` is the raw row, kept for the Studio and library page.
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
    }
    const { store } = defaultPipelineDeps();
    const row = await store.findByTrack(trackId);
    return NextResponse.json({ stem: row, job: toStemJobView(row) });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

/**
 * POST /api/stems — enqueue a split and return. Nothing here waits on the
 * backend: the row is written `pending`, a driver runs after the response
 * (`after()`), and the process-stems cron retries and reclaims. Doubles as
 * the retry for a failed job. The audio is the owned track's own, never a
 * URL from the client.
 */
export async function POST(req: NextRequest) {
  try {
    const parsed = await readBody(req, StemStartBodySchema);
    if (!parsed.ok) return parsed.res;
    const { trackId } = parsed.data;

    // The job is CPU minutes on the GPU host: only the track's owner may queue one.
    if (isSupabaseConfigured()) {
      const owner = await requireRowOwnership('tracks', trackId);
      if (!owner.ok) return owner.res;
    }

    // Fail fast with the dispatcher's own message when no backend exists at
    // all, rather than queueing a job that cannot start.
    const pick = await pickBackend();
    if (!pick.ok) {
      return NextResponse.json({ error: pick.reason }, { status: 503 });
    }

    const deps = defaultPipelineDeps();
    const queued = await enqueueStemJob(deps, trackId);
    if (!queued.ok) {
      if (queued.reason === 'active') {
        return NextResponse.json({ trackId, alreadyRunning: true, job: toStemJobView(queued.row) });
      }
      if (queued.reason === 'no_audio') {
        return NextResponse.json({ error: 'This track has no audio file to split.' }, { status: 409 });
      }
      return NextResponse.json({ error: 'Track not found' }, { status: 404 });
    }

    after(async () => {
      try {
        await processStemBatch(deps, { onlyTrackId: trackId, limit: 20 });
      } catch (err) {
        log.warn('stem kick failed; the cron will pick it up', { trackId, error: errorMessage(err) });
      }
    });

    return NextResponse.json({ trackId, job: toStemJobView(queued.row) }, { status: 202 });
  } catch (error) {
    log.error('Stem split enqueue error:', { error: errorMessage(error) });
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
