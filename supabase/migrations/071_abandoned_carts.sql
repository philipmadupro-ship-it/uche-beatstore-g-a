-- 071_abandoned_carts.sql
-- Abandoned-cart recovery. A row is written when a buyer creates a checkout
-- session (we have their email + items at that point). The webhook marks it
-- `recovered` on checkout.session.completed; a cron emails a reminder for rows
-- still unrecovered + unreminded after ~1h. Idempotent.

CREATE TABLE IF NOT EXISTS public.abandoned_carts (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_session_id  text        UNIQUE,
  seller_user_id     uuid,
  buyer_email        text        NOT NULL,
  items              jsonb       NOT NULL DEFAULT '[]'::jsonb,
  item_count         integer     NOT NULL DEFAULT 0,
  total_usd          numeric     NOT NULL DEFAULT 0,
  recovered          boolean     NOT NULL DEFAULT false,
  reminded_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- Cron scan predicate: unrecovered + not yet reminded, oldest first.
CREATE INDEX IF NOT EXISTS idx_abandoned_carts_scan
  ON public.abandoned_carts (recovered, reminded_at, created_at);

ALTER TABLE public.abandoned_carts ENABLE ROW LEVEL SECURITY;
-- No public policy — all access is via the service-role client (checkout
-- capture, webhook recovery, cron reminder).

NOTIFY pgrst, 'reload schema';
