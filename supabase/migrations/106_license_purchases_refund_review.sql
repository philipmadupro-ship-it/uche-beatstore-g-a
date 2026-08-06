-- 106_license_purchases_refund_review.sql
--
-- Backs the exclusive-sale race guard in src/app/api/stripe/webhook/route.ts
-- ("2. Exclusivity lock"). Checkout-time only checks tracks.exclusive_sold at
-- a point in time; two buyers can both pass that check, both pay on Stripe,
-- and only one can win the atomic `UPDATE ... WHERE exclusive_sold = false`
-- the webhook performs when fulfilling. The webhook already detects the loser
-- and attempts to flag their purchase — this column is what it's flagging,
-- so /sales can surface it instead of the producer finding out from a
-- buyer complaint. Refunding is still a manual, producer-driven action via
-- the Stripe dashboard link already on each sales row; this repo has no
-- automated refund-issuing code and this migration doesn't add any.
--
-- false (default) = nothing special; true = this purchase paid for an
-- exclusive license that was already sold to someone else by the time
-- payment landed. The producer needs to refund the buyer and reach out.
--
-- Idempotent.

ALTER TABLE public.license_purchases
  ADD COLUMN IF NOT EXISTS needs_refund_review boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_license_purchases_needs_refund_review
  ON public.license_purchases (seller_user_id, needs_refund_review)
  WHERE needs_refund_review = true;

NOTIFY pgrst, 'reload schema';
