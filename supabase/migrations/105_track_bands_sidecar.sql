-- 105_track_bands_sidecar.sql
--
-- Adds `tracks.bands_url`: a pointer to a precomputed spectral analysis
-- sidecar (per-slice low/mid/high band energy, dBFS and dominant pitch).
--
-- WHY A SECOND SIDECAR RATHER THAN EXTENDING peaks.json
--
-- Peaks sidecars are uploaded with `Cache-Control: immutable, max-age=31536000`.
-- Editing them in place would leave CDN copies stale for up to a year, so a new
-- key is the only safe way to add data. It also keeps amplitude-only consumers
-- (MiniWaveform, /embed) off a payload roughly 3x larger than they need.
--
-- WHAT IT REPLACES
--
-- Today every visitor to the public store decodes the audio in their own
-- browser through OfflineAudioContext to derive these bands — per visitor, per
-- track, on the one page that has to be fast. Precomputing at upload turns that
-- into a single cached JSON fetch.

ALTER TABLE tracks
  ADD COLUMN IF NOT EXISTS bands_url TEXT;

COMMENT ON COLUMN tracks.bands_url IS
  'Public URL of the .bands.json spectral sidecar (v2: slices, low/mid/high, db, hz). Null until analysed.';

-- Backfill jobs need to find tracks that have audio but no analysis yet. The
-- partial index keeps that scan cheap as the catalogue grows, and stays small
-- because rows drop out of it once analysed.
CREATE INDEX IF NOT EXISTS idx_tracks_bands_pending
  ON tracks (created_at DESC)
  WHERE bands_url IS NULL AND audio_url IS NOT NULL;

NOTIFY pgrst, 'reload schema';
