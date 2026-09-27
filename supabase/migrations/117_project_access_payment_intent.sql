-- Let a refund or dispute revoke a project bundle's access.
--
-- `charge.refunded` / `charge.dispute.created` carry only the payment intent.
-- license_purchases stores it (stripe_payment_intent) and the webhook flips
-- download_unlocked=false; project_access_links never stored it, so a refunded
-- bundle buyer kept every master and stem indefinitely.
--
-- The webhook now records the intent on insert and, on refund/dispute, sets
-- expires_at = now(). Every reader of project_access_links already treats a
-- past expires_at as "no access", so no new revocation column is needed.
--
-- Rows created before this migration have no intent and cannot be matched
-- automatically; revoke those by hand (UPDATE ... SET expires_at = now()).
--
-- Numbered 117: 115 and 116 already exist on disk.

ALTER TABLE public.project_access_links
  ADD COLUMN IF NOT EXISTS stripe_payment_intent text;

CREATE INDEX IF NOT EXISTS project_access_links_payment_intent_idx
  ON public.project_access_links (stripe_payment_intent)
  WHERE stripe_payment_intent IS NOT NULL;

NOTIFY pgrst, 'reload schema';
