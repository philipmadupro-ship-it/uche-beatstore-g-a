-- 056_track_scheduled_publish.sql
--
-- Scheduled publish for drafts: producer sets a future timestamp on a
-- not-yet-listed track, and the /api/cron/publish-scheduled route
-- (called from vercel.json's schedule) flips store_listed = true when
-- the clock catches up. Decoupled from store_listed itself so the
-- producer can still toggle a draft live early or move the schedule.
--
-- Idempotent.

ALTER TABLE public.tracks
  ADD COLUMN IF NOT EXISTS scheduled_publish_at timestamptz;

-- Partial index — fast scan for "drafts due any second now" without
-- touching the rest of the table. The cron route uses this every
-- minute.
CREATE INDEX IF NOT EXISTS idx_tracks_scheduled_publish
  ON public.tracks (scheduled_publish_at)
  WHERE scheduled_publish_at IS NOT NULL AND store_listed = false;

NOTIFY pgrst, 'reload schema';
