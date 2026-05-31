-- 075_exclusive_sold.sql
-- Auto-lock exclusives after purchase (Phase 1, Task 3).
--
-- When an exclusive license sells, the storefront should keep the beat
-- VISIBLE with an "Exclusive Sold" badge (rather than silently delisting it
-- via store_listed=false, which is the old behaviour). Lease/exclusive buy
-- options are hidden client-side when exclusive_sold = true. The producer can
-- manually re-list by clearing the flag; a refund clears it automatically
-- (see the charge.refunded branch in /api/stripe/webhook).

ALTER TABLE public.tracks
  ADD COLUMN IF NOT EXISTS exclusive_sold boolean NOT NULL DEFAULT false;

-- Storefront filters on (store_listed = true); the badge check then reads
-- exclusive_sold. Partial index keeps the "sold" lookups cheap without
-- bloating the common listed-and-available path.
CREATE INDEX IF NOT EXISTS idx_tracks_exclusive_sold
  ON public.tracks (exclusive_sold)
  WHERE exclusive_sold = true;

NOTIFY pgrst, 'reload schema';
