import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/db';
import { defaultStemStore } from '@/lib/stems/store';
import { authorizeStemJob, isValidJobId } from '@/lib/stems/authorize';
import { toStemJobView } from '@/lib/stems/view';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
const log = createLogger('api.stems.jobId');

/**
 * GET /api/stems/[jobId] — read-only status of one job (AUDIO-05).
 *
 * This used to poll the backend and, on completion, download and re-upload
 * every stem inside the request. That work is the pipeline driver's now
 * (`lib/stems/pipeline.ts`); a poll only reads the row, so a closed tab no
 * longer strands a job and two polls cannot both ingest.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  if (!isValidJobId(jobId)) return NextResponse.json({ error: 'Invalid job id' }, { status: 400 });
  const denied = await authorizeStemJob(jobId);
  if (denied) return denied;

  try {
    const store = defaultStemStore(isSupabaseConfigured());
    const candidates = jobId.includes(':') ? [jobId] : [jobId, `demucs:${jobId}`, `moises:${jobId}`];
    let row = null;
    for (const id of candidates) {
      row = await store.findByJobId(id);
      if (row) break;
    }
    if (!row) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

    const view = toStemJobView(row);
    return NextResponse.json({
      job: {
        job_id: jobId,
        // 'completed' / 'failed' keep the wire words older clients branch on.
        status: view.status === 'ready' ? 'completed' : view.status === 'queued' ? 'pending' : view.status,
        progress: view.status === 'ready' ? 100 : null,
        stems: view.stems ?? {},
        error: view.error,
      },
    });
  } catch (error: unknown) {
    log.error('Stem status error:', { error: errorMessage(error) });
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function HEAD() {
  return new NextResponse(null, { status: 200 });
}
