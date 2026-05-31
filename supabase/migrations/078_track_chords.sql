-- 078_track_chords.sql
-- Chord timeline (Phase 1, Task 8).
--
-- Stores the detected chord progression as an ordered JSON array of
-- { time, chord } segments, e.g. [{"time":0,"chord":"Am"},{"time":3.2,"chord":"F"}].
-- Detection runs client-side via Essentia HPCP (no recurring cost) and is
-- persisted through the existing /api/tracks/[id]/analyze handler. The
-- TrackDetailsDrawer renders the timeline as chips that highlight in sync
-- with audio playback.

ALTER TABLE public.tracks
  ADD COLUMN IF NOT EXISTS chords jsonb;

NOTIFY pgrst, 'reload schema';
