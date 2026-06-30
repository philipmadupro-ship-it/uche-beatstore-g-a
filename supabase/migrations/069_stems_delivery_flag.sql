-- 069_stems_delivery_flag.sql
-- Idempotency flag for "stems are ready" buyer delivery emails. When an
-- exclusive sells without stems, license_purchases.needs_stems_upload is set
-- (mig 052); once the producer uploads stems they trigger a delivery email.
-- This flag stops a second click (or retry) from emailing the buyer twice.
-- Idempotent.

ALTER TABLE public.license_purchases
  ADD COLUMN IF NOT EXISTS stems_delivery_email_sent boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';