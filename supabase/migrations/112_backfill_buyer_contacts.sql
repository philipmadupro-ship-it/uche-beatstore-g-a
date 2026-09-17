-- 112_backfill_buyer_contacts.sql
--
-- Reconcile past purchases with the CRM.
--
-- The webhook's CRM step was broken (see the fix shipped alongside migs 110/111):
-- it did SELECT-then-INSERT against contacts_user_email_uniq, so a unique
-- violation was swallowed and the buyer either never got a contact row or never
-- got a pipeline status. The code fix only applies to *future* purchases; this
-- repairs the history, so real customers stop reading as cold leads.
--
-- Two steps:
--   1. Create a contact for any paid buyer email that has none.
--   2. Mark every contact with a paid purchase as a customer.
--
-- Only fills NULLs — a stage the producer set by hand is never overwritten,
-- and an existing 'repeat_buyer' is not downgraded to 'purchased'.
--
-- Idempotent: re-running finds nothing left to create or set.

-- Paid buyer emails per seller, from both purchase kinds. Excludes the
-- 'unknown@invalid' sentinel the webhook writes when Stripe supplied no email
-- at all (that buyer is genuinely unreachable and must not become a contact),
-- and anything not email-shaped.
CREATE TEMP TABLE _paid_buyers ON COMMIT DROP AS
SELECT DISTINCT seller_user_id, lower(btrim(buyer_email)) AS email
FROM public.license_purchases
WHERE status = 'paid'
  AND seller_user_id IS NOT NULL
  AND buyer_email IS NOT NULL
  AND lower(btrim(buyer_email)) <> 'unknown@invalid'
  AND position('@' in buyer_email) > 1
UNION
SELECT DISTINCT seller_user_id, lower(btrim(buyer_email))
FROM public.project_access_links
WHERE seller_user_id IS NOT NULL
  AND buyer_email IS NOT NULL
  AND lower(btrim(buyer_email)) <> 'unknown@invalid'
  AND position('@' in buyer_email) > 1;

-- 1. Contacts the broken webhook never created. Name defaults to the email's
-- local part, matching what the free-download lead path does, so the row reads
-- sensibly until the producer fills it in.
INSERT INTO public.contacts (user_id, email, name, role, label, category, notes, crm_status, buyer_pipeline_status)
SELECT b.seller_user_id,
       b.email,
       split_part(b.email, '@', 1),
       'artist',
       'buyer',
       'buyer',
       'Backfilled from a completed purchase (mig 112)',
       'customer',
       'purchased'
FROM _paid_buyers b
WHERE NOT EXISTS (
  SELECT 1 FROM public.contacts c
  WHERE c.user_id = b.seller_user_id
    AND lower(btrim(c.email)) = b.email
)
ON CONFLICT (user_id, email) DO NOTHING;

-- 2. Existing contacts with a paid purchase, whose stage was never set.
UPDATE public.contacts c
   SET crm_status = 'customer'
  FROM _paid_buyers b
 WHERE c.user_id = b.seller_user_id
   AND lower(btrim(c.email)) = b.email
   AND c.crm_status IS NULL;

UPDATE public.contacts c
   SET buyer_pipeline_status = 'purchased'
  FROM _paid_buyers b
 WHERE c.user_id = b.seller_user_id
   AND lower(btrim(c.email)) = b.email
   AND c.buyer_pipeline_status IS NULL;

NOTIFY pgrst, 'reload schema';
