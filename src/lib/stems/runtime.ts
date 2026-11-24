/** Production wiring of the stem pipeline's dependencies (AUDIO-05). */
import { createServiceClient, isSupabaseConfigured } from '@/lib/db';
import { uploadAudio } from '@/lib/storage/upload';
import { downloadStem, pollJob, startJobFromSource } from './dispatch';
import { autoDeliverStems } from './auto-deliver';
import { defaultStemStore } from './store';
import { realStemCache } from './cache.server';
import type { PipelineDeps } from './pipeline';

export function defaultPipelineDeps(): PipelineDeps {
  const supabase = isSupabaseConfigured();
  return {
    store: defaultStemStore(supabase),
    backend: {
      start: async (sourceRef) => (await startJobFromSource(sourceRef)).jobId,
      poll: async (jobId) => {
        const job = await pollJob(jobId);
        return { status: job.status, error: job.error, stems: job.stems };
      },
      download: (jobId, stem, ref) => downloadStem(jobId, stem, ref),
    },
    // uploadAudio is the PRIVATE-bucket writer (fails closed without it).
    putStem: (buffer, filename) => uploadAudio(buffer, filename, 'audio/wav'),
    cache: realStemCache,
    onDone: async (trackId) => {
      if (supabase) await autoDeliverStems(createServiceClient(), trackId);
    },
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    pollIntervalMs: 5000,
  };
}
