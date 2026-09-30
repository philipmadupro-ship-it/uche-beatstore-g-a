-- 129_artist_portal_auto_digest.sql
-- Artist Relationship Workspace, phase 2: the optional daily digest.
--
-- Adding material never emails anyone by itself; the producer presses
-- Notify. auto_digest lets the producer hand that press to the daily cron
-- (/api/cron/artist-digest) for one artist: once a day, if anything in the
-- portal is new since the last notify, that artist gets the same single
-- digest Notify would send. Off by default. The cron is idempotent because a
-- digest moves project_contacts.last_notified_at, which is what it counts
-- from — a second run the same day finds nothing to send.

ALTER TABLE public.artist_portals
  ADD COLUMN IF NOT EXISTS auto_digest boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_artist_portals_auto_digest
  ON public.artist_portals (user_id)
  WHERE auto_digest AND revoked_at IS NULL;

NOTIFY pgrst, 'reload schema';
