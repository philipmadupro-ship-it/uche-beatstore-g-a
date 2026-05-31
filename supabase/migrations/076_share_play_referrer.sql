-- 076_share_play_referrer.sql
-- Share-link analytics (Phase 1, Task 6).
--
-- Capture where a share-link play came from so /analytics can show a
-- "platform source" column (Instagram, Twitter/X, direct, etc.). The play
-- endpoint parses the Referer header and stores the raw value; the analytics
-- aggregation buckets it into a friendly platform label.

ALTER TABLE public.share_plays
  ADD COLUMN IF NOT EXISTS referrer text;

NOTIFY pgrst, 'reload schema';
