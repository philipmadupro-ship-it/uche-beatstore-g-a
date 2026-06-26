/**
 * Truncated-preview generation for beat protection.
 *
 * The cheap, dependency-free way to stop full-beat ripping: serve only the
 * first ~N seconds of the master so a scraped preview is never the complete
 * arrangement. We handle the two formats producers actually upload as masters:
 *
 *   - MP3: a sequence of independent frames, so slicing the first proportion of
 *     bytes (by the track's known duration) yields a valid shorter clip.
 *   - WAV: header-aware — locate the `data` chunk, keep ~N seconds of PCM, and
 *     rewrite the RIFF + data chunk sizes so the clip is a valid WAV.
 *
 * Other formats (flac/aiff/m4a/ogg) can't be safely byte-truncated, so the
 * caller skips them (the store falls back to the master for those rare cases).
 *
 * NOTE: this truncates only. Baking an audible voice tag INTO the clip (the
 * strongest anti-rip for beats) needs an audio re-encoder dependency and is a
 * documented follow-up; the client-side VoiceTagPlayer overlay remains a second
 * layer until then.
 */

export const DEFAULT_PREVIEW_SECONDS = 75;

export interface PreviewResult {
  buffer: Buffer;
  truncated: boolean;
  ext: 'mp3' | 'wav';
  contentType: string;
}

export interface PreviewPlan {
  bytes: number;
  truncated: boolean;
}

/** Duration-proportional byte plan for an MP3 master. Pure, no I/O. */
export function planPreview(
  totalBytes: number,
  durationSeconds: number | null | undefined,
  previewSeconds: number = DEFAULT_PREVIEW_SECONDS,
): PreviewPlan {
  if (!durationSeconds || durationSeconds <= 0 || totalBytes <= 0) {
    return { bytes: totalBytes, truncated: false };
  }
  if (durationSeconds <= previewSeconds) {
    return { bytes: totalBytes, truncated: false };
  }
  const ratio = previewSeconds / durationSeconds;
  const bytes = Math.min(totalBytes, Math.max(1, Math.floor(totalBytes * ratio)));
  return { bytes, truncated: bytes < totalBytes };
}

/** True when the buffer is a RIFF/WAVE file. */
export function isWav(buf: Buffer): boolean {
  return (
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WAVE'
  );
}

/**
 * Truncate a WAV to ~`previewSeconds`, rewriting the RIFF + data chunk sizes.
 * Returns null when it can't (unparseable, or already short enough), so the
 * caller leaves the master untouched.
 */
export function truncateWav(
  buf: Buffer,
  previewSeconds: number = DEFAULT_PREVIEW_SECONDS,
): Buffer | null {
  if (!isWav(buf)) return null;
  let pos = 12;
  let byteRate = 0;
  let blockAlign = 1;
  let dataOffset = -1;
  let dataSize = 0;

  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === 'fmt ') {
      // fmt body: audioFormat(2) channels(2) sampleRate(4) byteRate(4) blockAlign(2)
      byteRate = buf.readUInt32LE(body + 8);
      blockAlign = buf.readUInt16LE(body + 12) || 1;
    } else if (id === 'data') {
      dataOffset = body;
      dataSize = size;
      break;
    }
    pos = body + size + (size % 2); // chunks are word-aligned
  }

  if (dataOffset < 0 || byteRate <= 0) return null;
  const actualDataSize = Math.min(dataSize, buf.length - dataOffset);
  let keep = Math.floor(byteRate * previewSeconds);
  keep -= keep % blockAlign; // align to a whole sample frame
  if (keep <= 0 || keep >= actualDataSize) return null; // nothing to trim

  const out = Buffer.alloc(dataOffset + keep);
  buf.copy(out, 0, 0, dataOffset + keep); // header + the kept PCM in one copy
  out.writeUInt32LE(keep, dataOffset - 4); // data chunk size
  out.writeUInt32LE(out.length - 8, 4); // RIFF chunk size
  return out;
}

/**
 * Produce the preview for a master buffer, detecting MP3 vs WAV. Returns the
 * original buffer (truncated: false) when no truncation applies. Never throws.
 */
export function makeTruncatedPreview(
  master: Buffer,
  durationSeconds: number | null | undefined,
  previewSeconds: number = DEFAULT_PREVIEW_SECONDS,
): PreviewResult {
  if (isWav(master)) {
    const wav = truncateWav(master, previewSeconds);
    return wav
      ? { buffer: wav, truncated: true, ext: 'wav', contentType: 'audio/wav' }
      : { buffer: master, truncated: false, ext: 'wav', contentType: 'audio/wav' };
  }
  // Default: treat as MP3 (byte-sliceable).
  const plan = planPreview(master.length, durationSeconds, previewSeconds);
  return plan.truncated
    ? { buffer: master.subarray(0, plan.bytes), truncated: true, ext: 'mp3', contentType: 'audio/mpeg' }
    : { buffer: master, truncated: false, ext: 'mp3', contentType: 'audio/mpeg' };
}
