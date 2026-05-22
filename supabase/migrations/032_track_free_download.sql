-- ── 032_track_free_download.sql ──────────────────────────────────────────────
-- Adds a free-download flag to tracks so creators can offer beats/songs for
-- free (no checkout required). The download is still gated through the audio
-- proxy so the raw R2 URL is never exposed.
--
-- free_download_enabled  boolean  default false
--   When true, a "Free Download" button appears on the store card and product
--   page. Clicking it hits /api/store/free-download?track_id=xxx which
--   302-redirects to /api/audio with Content-Disposition: attachment.
--   The endpoint records a download_plays event (future analytics).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.tracks
  ADD COLUMN IF NOT EXISTS free_download_enabled boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
