/**
 * Which tracks need a public preview clip, and can we build one?
 *
 * The store only streams `preview_url` (never a private master), so a listed
 * track with no preview_url is unplayable on /store. The backfill used to pick
 * candidates by `preview_status`, take the oldest N, and only then drop
 * masters that weren't .mp3/.wav. Three ways that stranded tracks forever:
 *   - a row marked 'ready' with no preview_url was never picked again;
 *   - uploads accept flac/aiff/m4a/ogg, which were filtered out after the
 *     limit, so those rows (and peaks-only rows) filled every batch slot;
 *   - the same failing rows were re-picked first on every run.
 */

/** Formats the upload path accepts (see /api/upload/init ALLOWED_EXT). */
const AUDIO_EXT_RE = /\.(mp3|wav|flac|aiff|aif|m4a|ogg)(?:\?|$)/i;
/** Formats byte-truncation can clip without ffmpeg. */
const TRUNCATABLE_RE = /\.(mp3|wav)(?:\?|$)/i;

export interface PreviewCandidateRow {
  id: string;
  audio_url?: string | null;
  preview_url?: string | null;
  preview_status?: string | null;
  peaks_url?: string | null;
  store_listed?: boolean | null;
  created_at?: string | null;
}

export function needsPreview(row: PreviewCandidateRow): boolean {
  return !row.preview_url || row.preview_status !== 'ready';
}

/** A master we can turn into a clip: any uploadable format (ffmpeg transcodes). */
export function isPreviewableMaster(audioUrl: string | null | undefined): boolean {
  return typeof audioUrl === 'string' && AUDIO_EXT_RE.test(audioUrl);
}

/** Byte-truncation is only valid for mp3/wav; other formats need ffmpeg. */
export function canTruncateWithoutFfmpeg(audioUrl: string | null | undefined): boolean {
  return typeof audioUrl === 'string' && TRUNCATABLE_RE.test(audioUrl);
}

/**
 * Order a candidate pool and take a batch: previewable masters only; tracks
 * missing a preview before tracks missing only peaks; store-listed first;
 * then oldest first. Filtering happens BEFORE the batch is cut.
 */
export function pickPreviewBatch<T extends PreviewCandidateRow>(rows: T[], batch: number): T[] {
  const rank = (r: T) => (needsPreview(r) ? 0 : 2) + (r.store_listed ? 0 : 1);
  return rows
    .filter((r) => isPreviewableMaster(r.audio_url) && (needsPreview(r) || !r.peaks_url))
    .sort((a, b) => rank(a) - rank(b) || String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))
    .slice(0, Math.max(0, batch));
}
