-- 110_normalize_contact_emails.sql
--
-- Canonicalise every email that links a human to the CRM.
--
-- The app writes and reads buyer emails in different forms. Checkout stored
-- `buyer_email` trimmed but not lowercased, while /api/store/orders and the
-- contact activity timeline both look up `.toLowerCase().trim()`. A buyer who
-- typed `Foo@Bar.com` therefore got a purchase row that no lookup could find:
-- their order was unfindable and the sale never appeared on the contact's
-- timeline. `contacts_user_email_uniq (user_id, email)` (mig 096) is a plain
-- b-tree and so case-SENSITIVE, which forked the same human into two contacts.
--
-- The code now normalises at every write point (see lib/contacts/email.ts).
-- This migration repairs the rows written before that.
--
-- Idempotent: lowercasing is a fixed point, so a re-run updates nothing and
-- the dedupe finds no duplicates.

-- ── contacts ───────────────────────────────────────────────────────────────
-- Lowercasing can collide with an existing row under the unique index, so
-- deduplicate first, following mig 096: repoint children onto the surviving
-- (oldest) row rather than cascade-deleting their history.

CREATE TEMP TABLE _email_dupes ON COMMIT DROP AS
SELECT id AS dup_id,
       first_value(id) OVER (
         PARTITION BY user_id, lower(email) ORDER BY created_at, id
       ) AS canonical_id
FROM public.contacts
WHERE user_id IS NOT NULL AND email IS NOT NULL;

DELETE FROM _email_dupes WHERE dup_id = canonical_id;

-- contact_tags: PK (contact_id, tag) — drop would-be collisions, repoint rest.
DELETE FROM public.contact_tags ct USING _email_dupes d
WHERE ct.contact_id = d.dup_id
  AND EXISTS (
    SELECT 1 FROM public.contact_tags c2
    WHERE c2.contact_id = d.canonical_id AND c2.tag = ct.tag
  );
UPDATE public.contact_tags ct SET contact_id = d.canonical_id
FROM _email_dupes d WHERE ct.contact_id = d.dup_id;

-- campaign_targets: UNIQUE (campaign_id, contact_id) — same treatment.
DELETE FROM public.campaign_targets t USING _email_dupes d
WHERE t.contact_id = d.dup_id
  AND EXISTS (
    SELECT 1 FROM public.campaign_targets t2
    WHERE t2.contact_id = d.canonical_id AND t2.campaign_id = t.campaign_id
  );
UPDATE public.campaign_targets t SET contact_id = d.canonical_id
FROM _email_dupes d WHERE t.contact_id = d.dup_id;

-- Children with no contact-scoped unique constraint — straight repoint.
UPDATE public.beat_sends b SET contact_id = d.canonical_id
FROM _email_dupes d WHERE b.contact_id = d.dup_id;
UPDATE public.contact_activity a SET contact_id = d.canonical_id
FROM _email_dupes d WHERE a.contact_id = d.dup_id;
UPDATE public.contact_tasks tk SET contact_id = d.canonical_id
FROM _email_dupes d WHERE tk.contact_id = d.dup_id;

DELETE FROM public.contacts c USING _email_dupes d WHERE c.id = d.dup_id;

UPDATE public.contacts
   SET email = lower(btrim(email))
 WHERE email IS NOT NULL
   AND email <> lower(btrim(email));

-- ── license_purchases ──────────────────────────────────────────────────────
-- No unique constraint on buyer_email; a straight rewrite is safe. This is
-- what makes past orders findable again via /store/orders and what reconnects
-- them to the contact timeline.
UPDATE public.license_purchases
   SET buyer_email = lower(btrim(buyer_email))
 WHERE buyer_email IS NOT NULL
   AND buyer_email <> lower(btrim(buyer_email));

-- ── project_access_links ───────────────────────────────────────────────────
UPDATE public.project_access_links
   SET buyer_email = lower(btrim(buyer_email))
 WHERE buyer_email IS NOT NULL
   AND buyer_email <> lower(btrim(buyer_email));

-- ── store_free_downloads ───────────────────────────────────────────────────
-- id PK, email only indexed — plain rewrite.
UPDATE public.store_free_downloads
   SET email = lower(btrim(email))
 WHERE email <> lower(btrim(email));

-- ── buyer_favorites ────────────────────────────────────────────────────────
-- PK (email, track_id): lowercasing can collide, so drop the rows that would
-- duplicate an already-canonical favorite before rewriting the rest.
DELETE FROM public.buyer_favorites f
WHERE f.email <> lower(btrim(f.email))
  AND EXISTS (
    SELECT 1 FROM public.buyer_favorites g
    WHERE g.email = lower(btrim(f.email))
      AND g.track_id = f.track_id
  );
UPDATE public.buyer_favorites
   SET email = lower(btrim(email))
 WHERE email <> lower(btrim(email));

-- ── buyer_listening_history / buyer_playlists ──────────────────────────────
-- Both keyed on a uuid id; email is only an index. Plain rewrite.
UPDATE public.buyer_listening_history
   SET email = lower(btrim(email))
 WHERE email <> lower(btrim(email));

UPDATE public.buyer_playlists
   SET email = lower(btrim(email))
 WHERE email <> lower(btrim(email));

NOTIFY pgrst, 'reload schema';
