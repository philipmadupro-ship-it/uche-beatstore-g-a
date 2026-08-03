/**
 * Build and store both audio sidecars in one step.
 *
 * `extractPeaksAndBands` and `uploadBandsSidecar` both existed before this, but
 * nothing connected them — the spectral extractor had zero callers, so every
 * visitor to the public store was still decoding audio in their own browser
 * through `OfflineAudioContext` to derive numbers the server could have
 * computed once at upload. This is the missing wire.
 *
 * Exists as a helper rather than being inlined because there are six write
 * paths (upload complete, legacy upload, analyze, peaks regenerate, backfill,
 * cron). Repeating "extract, upload two sidecars, collect two URLs, decide what
 * counts as failure" six times is how the three duplicated-constant bugs
 * earlier in this project happened.
 *
 * FAILURE POLICY, and why the two sidecars differ:
 *
 *   - Peaks are load-bearing. Without them there is no waveform at all, so a
 *     peaks failure is reported to the caller.
 *   - Bands are an enhancement. Without them the client falls back to its
 *     existing in-browser analysis — slower, but correct. So a bands failure is
 *     logged and swallowed; it must never fail an upload.
 */

import { extractPeaksAndBands } from './peaks';
import { uploadPeaksSidecar, uploadBandsSidecar } from '@/lib/storage/upload';
import { createLogger } from '@/lib/log';

const log = createLogger('audio.sidecars');

export interface SidecarResult {
  /** Null when extraction or upload failed — callers decide how loudly to fail. */
  peaksUrl: string | null;
  /** Null whenever bands are unavailable; always non-fatal. */
  bandsUrl: string | null;
  /** True when the audio could not be decoded at all. */
  undecodable: boolean;
}

export async function buildAndUploadSidecars(
  buffer: Buffer,
  audioUrl: string,
): Promise<SidecarResult> {
  const extracted = await extractPeaksAndBands(buffer);
  if (!extracted?.peaks) {
    return { peaksUrl: null, bandsUrl: null, undecodable: true };
  }

  const peaksUrl = await uploadPeaksSidecar(audioUrl, JSON.stringify(extracted.peaks));

  let bandsUrl: string | null = null;
  if (extracted.bands) {
    try {
      bandsUrl = await uploadBandsSidecar(audioUrl, JSON.stringify(extracted.bands));
    } catch (err) {
      // Deliberately swallowed — see the failure policy above.
      log.warn('bands sidecar upload failed; client will analyse in-browser', {
        audioUrl,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { peaksUrl, bandsUrl, undecodable: false };
}
