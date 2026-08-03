/**
 * Derive the spectral sidecar URL from the peaks sidecar URL.
 *
 * Deliberately dependency-free. It lives apart from `sidecars.ts` because that
 * module pulls in the R2 client, and this needs to be importable from client
 * components and from tests without dragging the AWS SDK along.
 *
 * WHY DERIVE RATHER THAN STORE. Both sidecars are written by
 * `uploadJsonSidecar` to the SAME object key with a different suffix, so either
 * can be computed from the other. Selecting `tracks.bands_url` on the read path
 * made every store and library query fail with "column does not exist" wherever
 * migration 105 had not been applied yet — and a failed select is an empty
 * catalogue, not a missing feature. Deriving removes that schema coupling
 * entirely: if the file is absent the fetch 404s and the client falls back to
 * analysing locally, which is the intended degradation.
 *
 * The column still exists and is still written; the backfill needs it to know
 * which tracks are done.
 */

const PEAKS_SUFFIX = '.peaks.json';
const BANDS_SUFFIX = '.bands.json';

export function bandsUrlFromPeaksUrl(peaksUrl: string | null | undefined): string | null {
  if (!peaksUrl || typeof peaksUrl !== 'string') return null;
  if (!peaksUrl.endsWith(PEAKS_SUFFIX)) return null;
  return `${peaksUrl.slice(0, -PEAKS_SUFFIX.length)}${BANDS_SUFFIX}`;
}
