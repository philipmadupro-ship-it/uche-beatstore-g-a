-- 079_track_instrumental.sql
-- Instrumental flag for the track workspace (Lyrics Studio).
--
-- A dedicated "Instrumental" control distinct from `type` — a song can be a
-- 'song' type but delivered as an instrumental (no vocals), which matters for
-- the lyrics workflow and for storefront/discovery filtering. NULL/false =
-- has vocals; true = instrumental.

ALTER TABLE public.tracks
  ADD COLUMN IF NOT EXISTS instrumental boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
