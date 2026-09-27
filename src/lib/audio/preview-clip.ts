import { DEFAULT_PREVIEW_SECONDS, makeTruncatedPreview } from './preview';
import { canTruncateWithoutFfmpeg } from './preview-candidates';

/**
 * Build the public preview clip for a master — ONE rule for every path that
 * makes one (upload processing, the nightly backfill, "Analyze N").
 *
 * Upload processing used to call `uploadPublicPreview`, which (a) transcoded
 * the WHOLE track, so with ffmpeg present the public "preview" was the full
 * beat at 96 kbps, and (b) returned null without ffmpeg, with no fallback. The
 * ffmpeg binary was never traced into the upload routes on Vercel, so (b) is
 * what production hit: every new upload got `preview_url = NULL` and 404'd on
 * /store until something else backfilled it.
 *
 * Order: a 75 s 96 kbps MP3 via ffmpeg; otherwise byte-truncate mp3/wav
 * (playable, just larger); otherwise null — flac/aiff/m4a/ogg cannot be
 * byte-sliced into anything a browser will play.
 */
export interface PreviewClip {
  buffer: Buffer;
  ext: 'mp3' | 'wav';
  contentType: string;
}

export type Mp3ClipMaker = (master: Buffer, seconds: number) => Promise<Buffer | null>;

const defaultMp3Maker: Mp3ClipMaker = async (master, seconds) => {
  // Dynamic import keeps the child_process-spawning module out of the graph
  // until a clip is actually needed.
  const { makePreviewMp3Buffer } = await import('./convert');
  return makePreviewMp3Buffer(master, seconds);
};

export async function buildPreviewClip(
  master: Buffer,
  audioUrl: string | null | undefined,
  durationSeconds: number | null | undefined,
  makeMp3: Mp3ClipMaker = defaultMp3Maker,
): Promise<PreviewClip | null> {
  let mp3: Buffer | null = null;
  try {
    mp3 = await makeMp3(master, DEFAULT_PREVIEW_SECONDS);
  } catch {
    mp3 = null;
  }
  if (mp3 && mp3.length > 0) return { buffer: mp3, ext: 'mp3', contentType: 'audio/mpeg' };
  if (!canTruncateWithoutFfmpeg(audioUrl)) return null;
  const { buffer, ext, contentType } = makeTruncatedPreview(master, durationSeconds ?? null);
  return { buffer, ext, contentType };
}
