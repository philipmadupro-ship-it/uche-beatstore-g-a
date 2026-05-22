-- ── 035_store_editor.sql ───────────────────────────────────────────────────
-- Adds the columns needed by the dashboard Store Editor.
--
-- creator_profiles:
--   store_enabled  boolean  default true
--     Global kill-switch. When false the /store page renders an
--     "Under construction" state so the creator can work in draft.
--
-- playlists:
--   store_featured  boolean  default false
--     Marks a playlist for display in the Featured Playlists section
--     of the public /store hero strip.
--
--   store_order  integer  (nullable)
--     Explicit display order for featured playlists. Lower = first.
--     NULL = unordered (falls to the bottom after all ordered rows).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.creator_profiles
  ADD COLUMN IF NOT EXISTS store_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE public.playlists
  ADD COLUMN IF NOT EXISTS store_featured boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS store_order    integer;

CREATE INDEX IF NOT EXISTS playlists_store_featured_idx
  ON public.playlists (user_id, store_featured, store_order ASC NULLS LAST);

NOTIFY pgrst, 'reload schema';
