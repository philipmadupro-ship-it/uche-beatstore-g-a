-- 073_cart_recovery_discount.sql
-- Upgrades abandoned-cart recovery: track how many reminders were sent (so we
-- can send a 1h nudge then a 24h follow-up) and store the one-time recovery
-- discount code generated for the cart so the second reminder reuses it.
-- Idempotent.

ALTER TABLE public.abandoned_carts
  ADD COLUMN IF NOT EXISTS reminder_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS recovery_code text;

NOTIFY pgrst, 'reload schema';
