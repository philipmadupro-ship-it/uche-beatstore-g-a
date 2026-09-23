-- 111_adopt_orphan_contacts.sql
--
-- Give legacy null-owner contacts an owner, so owner-only scoping is lossless.
--
-- Mig 097 made contacts RLS strictly owner-only and said outright that legacy
-- NULL-owner rows "must be migrated explicitly". That migration never happened,
-- and the API routes kept papering over it: they run on the service-role client
-- (which bypasses RLS) and filtered `user_id.eq.X OR user_id IS NULL`. The two
-- halves then drifted — /api/contacts and /api/contacts/scores included orphan
-- rows while /api/beat_sends used a strict owner match — so a legacy contact
-- appeared in the CRM with a lead score but no send history, and its own
-- timeline could not be opened.
--
-- This adopts the orphans onto the single producer, after which the routes can
-- scope strictly (as 097 intended) without hiding anything.
--
-- Guarded: adoption only runs when exactly one creator profile identifies the
-- owner. With zero or several, the rows are left alone — they stay unreadable,
-- exactly as 097 specified, rather than being handed to a guessed account.
--
-- Idempotent: a re-run finds no null-owner rows and does nothing.

DO $$
DECLARE
  owner_id uuid;
  owner_count int;
BEGIN
  SELECT count(DISTINCT user_id) INTO owner_count
  FROM public.creator_profiles
  WHERE user_id IS NOT NULL;

  IF owner_count <> 1 THEN
    RAISE NOTICE 'Skipping orphan contact adoption: % candidate owners (need exactly 1)', owner_count;
    RETURN;
  END IF;

  SELECT DISTINCT user_id INTO owner_id
  FROM public.creator_profiles
  WHERE user_id IS NOT NULL;

  -- Orphans whose email already belongs to one of the owner's contacts would
  -- violate contacts_user_email_uniq (mig 096) on adoption. Merge those into
  -- the existing row instead: repoint the children, then drop the orphan.
  -- Follows the dedupe shape of migs 096 and 110 so history is never lost.
  CREATE TEMP TABLE _orphan_merges ON COMMIT DROP AS
  SELECT o.id AS orphan_id, k.id AS keeper_id
  FROM public.contacts o
  JOIN public.contacts k
    ON k.user_id = owner_id
   AND k.email IS NOT NULL
   AND lower(btrim(k.email)) = lower(btrim(o.email))
  WHERE o.user_id IS NULL
    AND o.email IS NOT NULL;

  DELETE FROM public.contact_tags ct USING _orphan_merges m
  WHERE ct.contact_id = m.orphan_id
    AND EXISTS (
      SELECT 1 FROM public.contact_tags c2
      WHERE c2.contact_id = m.keeper_id AND c2.tag = ct.tag
    );
  UPDATE public.contact_tags ct SET contact_id = m.keeper_id
  FROM _orphan_merges m WHERE ct.contact_id = m.orphan_id;

  DELETE FROM public.campaign_targets t USING _orphan_merges m
  WHERE t.contact_id = m.orphan_id
    AND EXISTS (
      SELECT 1 FROM public.campaign_targets t2
      WHERE t2.contact_id = m.keeper_id AND t2.campaign_id = t.campaign_id
    );
  UPDATE public.campaign_targets t SET contact_id = m.keeper_id
  FROM _orphan_merges m WHERE t.contact_id = m.orphan_id;

  UPDATE public.beat_sends b SET contact_id = m.keeper_id
  FROM _orphan_merges m WHERE b.contact_id = m.orphan_id;
  UPDATE public.contact_activity a SET contact_id = m.keeper_id
  FROM _orphan_merges m WHERE a.contact_id = m.orphan_id;
  UPDATE public.contact_tasks tk SET contact_id = m.keeper_id
  FROM _orphan_merges m WHERE tk.contact_id = m.orphan_id;

  DELETE FROM public.contacts c USING _orphan_merges m WHERE c.id = m.orphan_id;

  -- Orphans that shared an email with each other would collide on adoption
  -- too. Keep the oldest of each group; the rest are duplicates of it.
  DELETE FROM public.contacts c
  USING (
    SELECT id,
           row_number() OVER (PARTITION BY lower(btrim(email)) ORDER BY created_at, id) AS rn
    FROM public.contacts
    WHERE user_id IS NULL AND email IS NOT NULL
  ) d
  WHERE c.id = d.id AND d.rn > 1;

  -- Everything left can be adopted without tripping the unique index.
  UPDATE public.contacts
     SET user_id = owner_id
   WHERE user_id IS NULL;

  -- contact_activity / contact_tasks carry their own user_id for RLS; any row
  -- hanging off a just-adopted contact needs the same owner.
  UPDATE public.contact_activity a
     SET user_id = owner_id
    FROM public.contacts c
   WHERE a.contact_id = c.id
     AND c.user_id = owner_id
     AND a.user_id IS NULL;

  UPDATE public.contact_tasks tk
     SET user_id = owner_id
    FROM public.contacts c
   WHERE tk.contact_id = c.id
     AND c.user_id = owner_id
     AND tk.user_id IS NULL;
END $$;

NOTIFY pgrst, 'reload schema';
