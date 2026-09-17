-- 114_share_price_overrides.sql
--
-- Per-share price overrides read by /api/share/[token]/checkout and the share
-- pages: lease_price_usd, exclusive_price_usd, discount_percent on both share
-- tables.
--
-- Production already has these columns (verified 2026-09-17), but no
-- migration ever created them, so a database rebuilt from this folder would
-- lack them. This records them. Every statement is a no-op where the column
-- already exists, so it is safe on production as-is.

ALTER TABLE public.project_shares
  ADD COLUMN IF NOT EXISTS lease_price_usd     numeric,
  ADD COLUMN IF NOT EXISTS exclusive_price_usd numeric,
  ADD COLUMN IF NOT EXISTS discount_percent    numeric;

ALTER TABLE public.share_links
  ADD COLUMN IF NOT EXISTS lease_price_usd     numeric,
  ADD COLUMN IF NOT EXISTS exclusive_price_usd numeric,
  ADD COLUMN IF NOT EXISTS discount_percent    numeric;

NOTIFY pgrst, 'reload schema';
