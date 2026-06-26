import { NextRequest, NextResponse } from 'next/server';
import { pollJob, downloadStem } from '@/lib/stems/dispatch';
import { isSupabaseConfigured, getAll, update, getById, createServiceClient } from '@/lib/db';
import { uploadAudio } from '@/lib/storage/upload';
import { stemName } from '@/lib/naming';
import { autoDeliverStems } from '@/lib/stems/auto-deliver';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
const log = createLogger('api.stems.jobId');

const CORE_STEMS = ['vocals', 'drums', 'bass', 'other'] as const;

interface StemRow {
  id: string;
  track_id?: string | null;
  job_id: string;
  status?: string | null;
  vocals_url?: string | null;
  drums_url?: string | null;
  bass_url?: string | null;
  other_url?: string | null;
  created_at?: string | null;
}

/**
 * GET /api/stems/[jobId]
 *
 * Polls the Demucs service. When the job completes, downloads each stem
 * from the service and re-uploads to R2 with semantic filenames
 * (`{Track Title} — {Stem}.wav`), so final stem URLs are durable and meaningful.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;

  try {
    // pollJob() parses the prefix and routes to demucs/moises. Bare ids
    // (pre-dispatcher rows) are treated as demucs for back-compat.
    const job = await pollJob(jobId).catch(() => null);

    if (!job) {
      const allStems = getAll('stems');
      const localJob = allStems.find((s: StemRow) => s.job_id === jobId);
      if (!localJob) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
      return NextResponse.json({ job: localJob });
    }

    const appStatus =
      job.status === 'done'
        ? 'completed'
        : job.status === 'error'
          ? 'failed'
          : job.status;

    // If already persisted, short-circuit and return the stored URLs
    if (job.status === 'done') {
      const existing = await loadStemRow(jobId);
      if (existing && existing.vocals_url && !existing.vocals_url.startsWith('/api/stems/')) {
        return NextResponse.json({
          job: {
            job_id: jobId,
            status: 'completed',
            progress: 100,
            model: job.model,
            stems: {
              vocals: existing.vocals_url,
              drums: existing.drums_url,
              bass: existing.bass_url,
              other: existing.other_url,
            },
            error: null,
          },
        });
      }
    }

    const stemUrls: Record<string, string> = {};
    if (job.status === 'done') {
      // Resolve track title for semantic naming
      const trackTitle = await resolveTrackTitle(jobId);

      // Download each stem from whichever backend produced it and re-upload
      // to R2 so the final URLs are durable (Moises CDN links may rotate;
      // local Demucs paths only work while the service is running).
      for (const [name, cdnUrl] of Object.entries(job.stems)) {
        try {
          const buffer = await downloadStem(jobId, name, cdnUrl);
          const semantic = stemName(trackTitle, name);
          const filename = `${semantic.replace(/[^\w\-— ]+/g, '').trim() || `stem-${name}`}.wav`;
          const url = await uploadAudio(buffer, filename, 'audio/wav');
          stemUrls[name] = url;
        } catch (err) {
          log.warn(`Stem upload failed for ${name}:`, { error: errorMessage(err) });
        }
      }
    }

    const uploadedAllCoreStems = CORE_STEMS.every((name) => !!stemUrls[name]);

    if (job.status === 'done') {
      const dbUpdate = {
        status: uploadedAllCoreStems ? 'done' : 'failed',
        vocals_url: stemUrls['vocals'] ?? null,
        drums_url: stemUrls['drums'] ?? null,
        bass_url: stemUrls['bass'] ?? null,
        other_url: stemUrls['other'] ?? null,
      };
      let trackId: string | null = null;

      if (isSupabaseConfigured()) {
        const supabase = createServiceClient();
        const { data: stemRow } = await supabase
          .from('stems')
          .select('track_id')
          .eq('job_id', jobId)
          .maybeSingle();
        trackId = stemRow?.track_id ?? null;
        await supabase.from('stems').update(dbUpdate).eq('job_id', jobId);
        if (trackId) {
          await supabase
            .from('tracks')
            .update({ stems_status: uploadedAllCoreStems ? 'done' : 'failed' })
            .eq('id', trackId);
        }
        if (uploadedAllCoreStems && trackId) {
          void autoDeliverStems(supabase, trackId);
        }
      } else {
        const allStems = getAll('stems');
        const localJob = allStems.find((s: StemRow) => s.job_id === jobId);
        if (localJob) {
          trackId = localJob.track_id ?? null;
          update('stems', localJob.id, dbUpdate);
          if (trackId) update('tracks', trackId, { stems_status: uploadedAllCoreStems ? 'done' : 'failed' });
        }
      }

      if (!uploadedAllCoreStems) {
        return NextResponse.json({
          job: {
            job_id: jobId,
            status: 'failed',
            progress: 100,
            model: job.model,
            stems: stemUrls,
            error: 'Stem extraction finished, but one or more stems could not be stored. Retry the split or upload stems manually.',
          },
        });
      }
    }

    return NextResponse.json({
      job: {
        job_id: jobId,
        status: appStatus,
        progress: job.progress,
        model: job.model,
        stems: stemUrls,
        error: job.error ?? null,
      },
    });
  } catch (error: unknown) {
    log.error('Stem poll error:', { error: errorMessage(error) });
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

async function loadStemRow(jobId: string): Promise<StemRow | null> {
  if (isSupabaseConfigured()) {
    const supabase = createServiceClient();
    const { data } = await supabase.from('stems').select('*').eq('job_id', jobId).maybeSingle();
    return data ?? null;
  }
  const all = getAll('stems');
  return all.find((s: StemRow) => s.job_id === jobId) ?? null;
}

async function resolveTrackTitle(jobId: string): Promise<string> {
  try {
    if (isSupabaseConfigured()) {
      const supabase = createServiceClient();
      const { data: stemRow } = await supabase.from('stems').select('track_id').eq('job_id', jobId).maybeSingle();
      if (stemRow?.track_id) {
        const { data: track } = await supabase.from('tracks').select('title').eq('id', stemRow.track_id).maybeSingle();
        if (track?.title) return track.title;
      }
    } else {
      const stemRow = getAll('stems').find((s: StemRow) => s.job_id === jobId);
      if (stemRow?.track_id) {
        const track = getById('tracks', stemRow.track_id);
        if (track?.title) return track.title;
      }
    }
  } catch (err) {
    log.warn('Resolve track title failed:', { error: errorMessage(err) });
  }
  return 'Track';
}

export async function HEAD() {
  return new NextResponse(null, { status: 200 });
}
