-- 112_backfill_buyer_contacts.sql — SQL-editor form.
--
-- Same effect as supabase/migrations/112_backfill_buyer_contacts.sql, for the
-- bundle pasted into the Supabase SQL editor. The migration builds a
-- `CREATE TEMP TABLE … ON COMMIT DROP` and reads it in three later
-- statements; the SQL editor does not keep one session/transaction across a
-- pasted script, so the table is gone by the next statement
-- ("relation _paid_buyers does not exist"). Here each statement computes the
-- same buyer set itself. The purchase tables are not changed by any
-- statement, so all three see the same set, exactly as with the temp table.
-- Idempotent: re-running finds nothing left to create or set.

-- 1. Contacts the broken webhook never created.
WITH paid_buyers AS (
  SELECT DISTINCT seller_user_id, lower(btrim(buyer_email)) AS email
  FROM public.license_purchases
  WHERE status = 'paid' AND seller_user_id IS NOT NULL AND buyer_email IS NOT NULL
    AND lower(btrim(buyer_email)) <> 'unknown@invalid' AND position('@' in buyer_email) > 1
  UNION
  SELECT DISTINCT seller_user_id, lower(btrim(buyer_email))
  FROM public.project_access_links
  WHERE seller_user_id IS NOT NULL AND buyer_email IS NOT NULL
    AND lower(btrim(buyer_email)) <> 'unknown@invalid' AND position('@' in buyer_email) > 1
)
INSERT INTO public.contacts (user_id, email, name, role, label, category, notes, crm_status, buyer_pipeline_status)
SELECT b.seller_user_id, b.email, split_part(b.email, '@', 1), 'artist', 'buyer', 'buyer',
       'Backfilled from a completed purchase (mig 112)', 'customer', 'purchased'
FROM paid_buyers b
WHERE NOT EXISTS (
  SELECT 1 FROM public.contacts c WHERE c.user_id = b.seller_user_id AND lower(btrim(c.email)) = b.email
)
ON CONFLICT (user_id, email) DO NOTHING;

-- 2. Existing contacts with a paid purchase, whose stage was never set.
WITH paid_buyers AS (
  SELECT DISTINCT seller_user_id, lower(btrim(buyer_email)) AS email
  FROM public.license_purchases
  WHERE status = 'paid' AND seller_user_id IS NOT NULL AND buyer_email IS NOT NULL
    AND lower(btrim(buyer_email)) <> 'unknown@invalid' AND position('@' in buyer_email) > 1
  UNION
  SELECT DISTINCT seller_user_id, lower(btrim(buyer_email))
  FROM public.project_access_links
  WHERE seller_user_id IS NOT NULL AND buyer_email IS NOT NULL
    AND lower(btrim(buyer_email)) <> 'unknown@invalid' AND position('@' in buyer_email) > 1
)
UPDATE public.contacts c
   SET crm_status = 'customer'
  FROM paid_buyers b
 WHERE c.user_id = b.seller_user_id AND lower(btrim(c.email)) = b.email AND c.crm_status IS NULL;

WITH paid_buyers AS (
  SELECT DISTINCT seller_user_id, lower(btrim(buyer_email)) AS email
  FROM public.license_purchases
  WHERE status = 'paid' AND seller_user_id IS NOT NULL AND buyer_email IS NOT NULL
    AND lower(btrim(buyer_email)) <> 'unknown@invalid' AND position('@' in buyer_email) > 1
  UNION
  SELECT DISTINCT seller_user_id, lower(btrim(buyer_email))
  FROM public.project_access_links
  WHERE seller_user_id IS NOT NULL AND buyer_email IS NOT NULL
    AND lower(btrim(buyer_email)) <> 'unknown@invalid' AND position('@' in buyer_email) > 1
)
UPDATE public.contacts c
   SET buyer_pipeline_status = 'purchased'
  FROM paid_buyers b
 WHERE c.user_id = b.seller_user_id AND lower(btrim(c.email)) = b.email AND c.buyer_pipeline_status IS NULL;

NOTIFY pgrst, 'reload schema';
