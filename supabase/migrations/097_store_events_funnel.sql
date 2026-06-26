-- 097_store_events_funnel.sql
--
-- Storefront funnel instrumentation. Today only `store_plays` exists, so we
-- can count listens but have no idea where buyers drop off between viewing a
-- track, adding to cart, starting checkout, and paying. /analytics optimizes
-- blind.
--
-- `store_events` is a generic event log: one row per funnel action, tagged
-- with an anonymous client `session_id` so we can compute per-session
-- progression (view → cart → checkout → paid). `event_type` + `metadata`
-- (jsonb) keep it open — new event types never need a migration.
--
-- Mirrors the store_plays posture exactly: public inserts via the
-- service-role `/api/store/event` endpoint (visitors are unauthenticated),
-- producer reads gated by RLS to their own rows, salted IP hash only.
--
-- Idempotent (IF NOT EXISTS on all DDL). Safe to re-run.

CREATE TABLE IF NOT EXISTS public.store_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_user_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Anonymous, client-generated session id (NOT auth) — lets us correlate a
  -- visitor's events into a funnel without storing PII.
  session_id      text,
  -- Funnel action: 'pdp_view' | 'add_to_cart' | 'remove_from_cart'
  --              | 'checkout_start' | 'purchase' (extensible).
  event_type      text NOT NULL,
  -- Optional primary track the event is about (cart/checkout carry the full
  -- set in `metadata`).
  track_id        uuid REFERENCES public.tracks(id) ON DELETE CASCADE,
  -- Optional license tier (custom-license UUID or legacy type string).
  license_id      text,
  -- Free-form payload: cart contents, amount, source surface, etc.
  metadata        jsonb,
  -- Salted IP hash, never the IP itself.
  ip_hash         text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Funnel queries scope by seller + time, then group by session/type.
CREATE INDEX IF NOT EXISTS idx_store_events_seller_created
  ON public.store_events (seller_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_store_events_session
  ON public.store_events (session_id);
CREATE INDEX IF NOT EXISTS idx_store_events_type
  ON public.store_events (event_type);

ALTER TABLE public.store_events ENABLE ROW LEVEL SECURITY;

-- Producer reads only their own events.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'store_events'
      AND policyname = 'Owner reads store events'
  ) THEN
    CREATE POLICY "Owner reads store events"
      ON public.store_events FOR SELECT
      USING (seller_user_id = auth.uid());
  END IF;
END $$;

-- Inserts come from the service-role client (public /api/store/event endpoint
-- runs as service-role since visitors are unauthenticated). No INSERT policy.

NOTIFY pgrst, 'reload schema';
