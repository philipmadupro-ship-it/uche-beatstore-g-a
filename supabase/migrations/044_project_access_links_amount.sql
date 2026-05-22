-- 044_project_access_links_amount.sql
-- Freezes the bundle price on project_access_links at purchase time.
--
-- Before: the producer sales view pulled amount from the current
-- projects.price_usd, so changing the price retroactively rewrote the
-- sales history. Now the webhook writes session.amount_total/100 into
-- the access link row and /api/sales prefers that frozen value.
--
-- amount_usd stays nullable for legacy rows written before this migration.

ALTER TABLE public.project_access_links
  ADD COLUMN IF NOT EXISTS amount_usd numeric(10,2);

NOTIFY pgrst, 'reload schema';
