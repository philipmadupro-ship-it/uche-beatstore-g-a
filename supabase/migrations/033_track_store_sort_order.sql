-- ── 033_track_store_sort_order.sql ───────────────────────────────────────────
-- Adds a store_sort_order column so creators can control the display order of
-- their tracks on the public storefront without relying on created_at.
--
-- Default NULL means "use created_at DESC" (existing behaviour preserved).
-- When a creator sets explicit sort positions the /api/store route orders by
-- store_sort_order ASC NULLS LAST, created_at DESC as tiebreaker.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.tracks
  ADD COLUMN IF NOT EXISTS store_sort_order integer;

-- Sparse index — only a few tracks per seller will have this set
CREATE INDEX IF NOT EXISTS tracks_store_sort_order_idx
  ON public.tracks (user_id, store_sort_order ASC NULLS LAST);

NOTIFY pgrst, 'reload schema';
