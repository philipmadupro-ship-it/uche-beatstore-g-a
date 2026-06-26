-- 099_track_preview_assets.sql
--
-- Beat/preview protection. Today the public storefront streams `audio_url` —
-- the full clean master MP3 — directly from public R2, so anyone can scrape
-- the catalogue and download every beat for free. We add a separate, protected
-- PREVIEW asset (a truncated clip) and serve THAT publicly, keeping the master
-- private (delivered only post-purchase via the gated, presigned download path).
--
--   preview_url     — public URL of the truncated preview clip.
--   preview_status  — 'none' | 'ready' | 'pending'. The store serves the master
--                     as a fallback only while a track's preview isn't ready,
--                     so rollout/backfill never breaks playback.
--
-- Idempotent. Ends with NOTIFY pgrst.

ALTER TABLE public.tracks
  ADD COLUMN IF NOT EXISTS preview_url    text,
  ADD COLUMN IF NOT EXISTS preview_status text NOT NULL DEFAULT 'none';

-- Find tracks still needing a preview (the backfill job filters on this).
CREATE INDEX IF NOT EXISTS idx_tracks_preview_status
  ON public.tracks (preview_status)
  WHERE store_listed = true;

NOTIFY pgrst, 'reload schema';
