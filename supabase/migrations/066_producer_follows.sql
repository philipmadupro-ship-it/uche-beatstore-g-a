-- 066_producer_follows.sql
-- Buyers can follow a producer to get notified when new beats drop.
-- Identity is the buyer's email (same model as buyer_favorites, mig 060) —
-- no buyer password; the email is captured at checkout or store sign-in.
--
-- `producer_user_id` is the creator (auth.users.id). When the producer
-- lists a new beat, a fan-out job can read this table to notify followers.
-- Idempotent.

CREATE TABLE IF NOT EXISTS public.producer_follows (
  producer_user_id uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email            text        NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (producer_user_id, email)
);

CREATE INDEX IF NOT EXISTS idx_producer_follows_producer
  ON public.producer_follows (producer_user_id, created_at DESC);

ALTER TABLE public.producer_follows ENABLE ROW LEVEL SECURITY;

-- The producer can read their own followers. Writes happen via the
-- service-role client in the API after validating the buyer's email,
-- so no public insert/delete policy is needed.
DROP POLICY IF EXISTS "producer reads own followers" ON public.producer_follows;
CREATE POLICY "producer reads own followers" ON public.producer_follows
  FOR SELECT USING (producer_user_id = auth.uid());

NOTIFY pgrst, 'reload schema';
