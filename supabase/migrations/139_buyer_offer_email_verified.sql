-- 139_buyer_offer_email_verified.sql
-- Which offers were made by someone who proved they own the email on them.
--
-- POST /api/store/offer is public (offers must work without an account) and
-- used to trust `buyer_email` from the request body. "My beats" lists every
-- offer stored under a signed-in buyer's address, so anyone could plant an
-- offer — a price, a status, a track title — in another person's account by
-- typing their address. The route now takes the email from the Supabase
-- session when there is one and records it here as verified; an offer from an
-- anonymous caller is stored as before (the producer still gets it and can
-- reply) but unverified, and "My beats" shows verified offers only.
--
-- DEFAULT false on purpose: every offer already stored was made on an
-- unproven address, so none of them is claimed as verified. They stay visible
-- to the producer on /sales and simply stop appearing in a buyer's My beats.
-- Idempotent. Numbered 139 because 136-138 are claimed by the label-os
-- branches (origin/label-os/*), not yet on main.

ALTER TABLE public.buyer_offers
  ADD COLUMN IF NOT EXISTS buyer_email_verified boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
