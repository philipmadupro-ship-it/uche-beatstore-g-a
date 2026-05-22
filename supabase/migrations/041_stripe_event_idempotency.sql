-- supabase/migrations/041_stripe_event_idempotency.sql
-- Introduce processed_stripe_events table to log event IDs processed by Stripe
-- Add fulfillment_email_sent to license_purchases to avoid duplicate emails during webhook retries

CREATE TABLE IF NOT EXISTS public.processed_stripe_events (
  event_id              text PRIMARY KEY,
  created_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.license_purchases
  ADD COLUMN IF NOT EXISTS fulfillment_email_sent boolean NOT NULL DEFAULT false;

-- Enable Row Level Security (RLS)
ALTER TABLE public.processed_stripe_events ENABLE ROW LEVEL SECURITY;

-- Note: no select/insert policies needed for public since only the service-role client accesses this table.

NOTIFY pgrst, 'reload schema';
