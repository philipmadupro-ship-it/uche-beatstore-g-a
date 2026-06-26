-- 096_contacts_unique_owner_email.sql
--
-- The Stripe webhook's CRM step (runFulfillment / runProjectFulfillment)
-- did SELECT-then-INSERT on contacts(user_id, email). Two concurrent
-- webhook deliveries for the same buyer could both miss the SELECT and
-- both INSERT, leaving duplicate contact rows. We switch the webhook to
-- an atomic upsert; that needs a unique index to arbitrate ON CONFLICT.
--
-- Before creating the index we deduplicate any rows the old race already
-- produced. Children of contacts cascade-delete, so we repoint them to
-- the surviving (oldest) row first rather than losing beat_sends /
-- activity / tasks history.
--
-- Scope: only user_id IS NOT NULL rows. Legacy null-owner demo contacts
-- are left alone — NULLs are distinct in a unique index, so they never
-- conflict and the webhook never touches them (it always has a seller).
--
-- Idempotent: the dedupe statements no-op on re-run (no dupes remain),
-- and the index uses IF NOT EXISTS.

-- Map every duplicate to its canonical (oldest) sibling.
CREATE TEMP TABLE _contact_dupes ON COMMIT DROP AS
SELECT id AS dup_id,
       first_value(id) OVER (
         PARTITION BY user_id, email ORDER BY created_at, id
       ) AS canonical_id
FROM public.contacts
WHERE user_id IS NOT NULL;

DELETE FROM _contact_dupes WHERE dup_id = canonical_id;

-- contact_tags: PK (contact_id, tag) — drop rows that would collide on the
-- canonical, then repoint the rest.
DELETE FROM public.contact_tags ct USING _contact_dupes d
WHERE ct.contact_id = d.dup_id
  AND EXISTS (
    SELECT 1 FROM public.contact_tags c2
    WHERE c2.contact_id = d.canonical_id AND c2.tag = ct.tag
  );
UPDATE public.contact_tags ct SET contact_id = d.canonical_id
FROM _contact_dupes d WHERE ct.contact_id = d.dup_id;

-- campaign_targets: UNIQUE (campaign_id, contact_id) — same treatment.
DELETE FROM public.campaign_targets t USING _contact_dupes d
WHERE t.contact_id = d.dup_id
  AND EXISTS (
    SELECT 1 FROM public.campaign_targets t2
    WHERE t2.contact_id = d.canonical_id AND t2.campaign_id = t.campaign_id
  );
UPDATE public.campaign_targets t SET contact_id = d.canonical_id
FROM _contact_dupes d WHERE t.contact_id = d.dup_id;

-- Children with no contact-scoped unique constraint — straight repoint.
UPDATE public.beat_sends b SET contact_id = d.canonical_id
FROM _contact_dupes d WHERE b.contact_id = d.dup_id;
UPDATE public.contact_activity a SET contact_id = d.canonical_id
FROM _contact_dupes d WHERE a.contact_id = d.dup_id;
UPDATE public.contact_tasks tk SET contact_id = d.canonical_id
FROM _contact_dupes d WHERE tk.contact_id = d.dup_id;

-- Drop the now-orphaned duplicate contacts.
DELETE FROM public.contacts c USING _contact_dupes d WHERE c.id = d.dup_id;

-- The constraint the webhook upsert arbitrates on.
CREATE UNIQUE INDEX IF NOT EXISTS contacts_user_email_uniq
  ON public.contacts (user_id, email);

NOTIFY pgrst, 'reload schema';
