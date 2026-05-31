-- 077_bundle_discount.sql
-- Automatic cart-level bundle / quantity discount (Phase 1, Task 7).
--
-- No promo code required: when a buyer's cart reaches the producer's
-- configured item threshold, a percentage comes off the whole cart
-- automatically (e.g. 3+ items = 15% off). Configured once per producer in
-- /store-editor; applied server-side in /api/store/checkout and previewed
-- as a banner in the cart drawer.

ALTER TABLE public.creator_profiles
  ADD COLUMN IF NOT EXISTS bundle_discount_threshold integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bundle_discount_percent numeric NOT NULL DEFAULT 0;

-- Sanity bounds: percent 0–90, threshold >= 0. 0 threshold OR 0 percent = off.
ALTER TABLE public.creator_profiles
  DROP CONSTRAINT IF EXISTS creator_profiles_bundle_percent_chk;
ALTER TABLE public.creator_profiles
  ADD CONSTRAINT creator_profiles_bundle_percent_chk
  CHECK (bundle_discount_percent >= 0 AND bundle_discount_percent <= 90);

NOTIFY pgrst, 'reload schema';
