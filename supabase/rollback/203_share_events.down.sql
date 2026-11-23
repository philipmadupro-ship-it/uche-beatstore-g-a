-- Rollback for 203_share_events.sql (SHARE-06). Run by hand only.
-- Drops the log; the share routes then stop recording (best effort) and
-- /api/links/activity answers { schemaReady: false }. The old plays counters
-- are untouched.

DROP TABLE IF EXISTS public.share_events;
DROP FUNCTION IF EXISTS public.share_events_append_only();

NOTIFY pgrst, 'reload schema';
