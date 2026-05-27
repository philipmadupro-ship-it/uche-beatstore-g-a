-- 059_drop_subscribers.sql
--
-- "Notify me" subscriptions for scheduled drops. A fan provides their
-- email; when the drop's scheduled_publish_at hits, our existing
-- /api/cron/publish-scheduled fans out an email blast to everyone
-- subscribed to that track.
--
-- One subscriber per (email, track). Unique constraint enforces.
-- notified_at is stamped when the email goes out — preventing the
-- cron from blasting twice if it re-runs.
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS public.drop_subscribers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  track_id     uuid NOT NULL REFERENCES public.tracks(id) ON DELETE CASCADE,
  email        text NOT NULL,
  notified_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (track_id, email)
);

CREATE INDEX IF NOT EXISTS idx_drop_subscribers_track
  ON public.drop_subscribers (track_id)
  WHERE notified_at IS NULL;

ALTER TABLE public.drop_subscribers ENABLE ROW LEVEL SECURITY;

-- INSERT is gated at the API layer (anti-spam). Nothing is
-- readable from the public PostgREST surface.

NOTIFY pgrst, 'reload schema';
