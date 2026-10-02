-- Behaviour checks for 139_labelos_org_contacts.sql, run by
-- scripts/local-db/check.sh (npm run db:local:check) in its own copy of the
-- throwaway database. Every check RAISEs on failure; psql stops at the first.
--
-- Cast (seed: producer P with a creator_profiles row, buyer B):
--   label L : owner O, A&R member AR (scope org), member SC (scope artists,
--             sees C1), roster artist ART (scope artists, no rows), member
--             FIN (finance: no catalog.read)
--   label L2: owner X; P is an A&R member of L2 (a producer who also works
--             at a label)
--   contacts: P's own CRM rows PC1, PC2 (org_id NULL); L's C1, C2; L2's D1

\set P   '''0b0e1a57-0000-4000-8000-000000000001'''
\set B   '''0b0e1a57-0000-4000-8000-0000000000b1'''
\set O   '''a1000000-0000-4000-8000-000000000001'''
\set AR  '''a1000000-0000-4000-8000-000000000002'''
\set SC  '''a1000000-0000-4000-8000-000000000003'''
\set ART '''a1000000-0000-4000-8000-000000000004'''
\set FIN '''a1000000-0000-4000-8000-000000000005'''
\set X   '''a1000000-0000-4000-8000-000000000006'''
\set L   '''b1000000-0000-4000-8000-000000000001'''
\set L2  '''b1000000-0000-4000-8000-000000000002'''
\set PC1 '''c1000000-0000-4000-8000-0000000000a1'''
\set PC2 '''c1000000-0000-4000-8000-0000000000a2'''
\set C1  '''c1000000-0000-4000-8000-0000000000c1'''
\set C2  '''c1000000-0000-4000-8000-0000000000c2'''
\set D1  '''c1000000-0000-4000-8000-0000000000d1'''

INSERT INTO auth.users (id, email) VALUES
  (:O, 'owner@local.test'), (:AR, 'ar@local.test'), (:SC, 'scoped@local.test'),
  (:ART, 'artist@local.test'), (:FIN, 'fin@local.test'), (:X, 'x@local.test');
INSERT INTO public.organizations (id, name, slug, kind, created_by) VALUES
  (:L, 'Label L', 'label-l', 'label', :O),
  (:L2, 'Label L2', 'label-l2', 'label', :X);
INSERT INTO public.org_members (org_id, user_id, role, functions, scope) VALUES
  (:L, :O, 'owner', '{}', 'org'),
  (:L, :AR, 'member', '{a_and_r}', 'org'),
  (:L, :SC, 'member', '{a_and_r}', 'artists'),
  (:L, :ART, 'artist', '{}', 'artists'),
  (:L, :FIN, 'member', '{finance}', 'org'),
  (:L2, :X, 'owner', '{}', 'org'),
  (:L2, :P, 'member', '{a_and_r}', 'org');

INSERT INTO public.contacts (id, user_id, org_id, name, email, category) VALUES
  (:PC1, :P, NULL, 'Producer contact 1', 'pc1@local.test', 'artist'),
  (:PC2, :P, NULL, 'Producer buyer', 'pc2@local.test', 'buyer'),
  (:C1, NULL, :L, 'Nova', 'nova@local.test', 'artist'),
  (:C2, NULL, :L, 'Kilo', 'kilo@local.test', 'artist'),
  (:D1, NULL, :L2, 'Other label artist', 'd1@local.test', 'artist');
INSERT INTO public.member_artist_scopes (org_id, user_id, contact_id) VALUES (:L, :SC, :C1);

CREATE FUNCTION public.check_eq(label text, got anyelement, want anyelement) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'CHECK FAILED: % — got %, want %', label, got, want;
  END IF;
END $$;
CREATE FUNCTION public.check_raises(label text, stmt text, pattern text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM ~* pattern THEN RETURN; END IF;
    RAISE EXCEPTION 'CHECK FAILED: % — raised "%", wanted /%/', label, SQLERRM, pattern;
  END;
  RAISE EXCEPTION 'CHECK FAILED: % — statement succeeded, wanted /%/', label, pattern;
END $$;
CREATE FUNCTION public.rows_changed(stmt text) RETURNS int
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  EXECUTE stmt;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
-- Which contacts the current role/claims can read, as a sorted id list.
CREATE FUNCTION public.visible_contacts() RETURNS text
LANGUAGE sql AS $$
  SELECT coalesce(string_agg(name, ',' ORDER BY name), '') FROM public.contacts
$$;
GRANT EXECUTE ON FUNCTION public.check_eq(text, anyelement, anyelement), public.check_raises(text, text, text),
  public.rows_changed(text), public.visible_contacts() TO anon, authenticated, service_role;

-- ── R-04: the additive policy widens nothing ─────────────────────────────

SELECT public.check_eq('contacts keeps exactly its two policies',
  (SELECT string_agg(policyname, ',' ORDER BY policyname) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'contacts'),
  'org_member_read,owner_only');
SELECT public.check_eq('owner_only is unchanged (097): FOR ALL, keyed on user_id = auth.uid()',
  (SELECT cmd || '|' || qual || '|' || with_check FROM pg_policies WHERE tablename = 'contacts' AND policyname = 'owner_only'),
  'ALL|(( SELECT auth.uid() AS uid) = user_id)|(( SELECT auth.uid() AS uid) = user_id)');
SELECT public.check_eq('org_member_read is SELECT-only, for authenticated, and requires org_id IS NOT NULL',
  (SELECT cmd || '|' || array_to_string(roles, ',') || '|' || (qual ~ 'org_id IS NOT NULL')::text
   FROM pg_policies WHERE tablename = 'contacts' AND policyname = 'org_member_read'),
  'SELECT|authenticated|true');

SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
SELECT public.check_eq('anon sees no contact at all', public.visible_contacts(), '');
SELECT public.check_eq('anon: can_see_artist is false', public.can_see_artist(:L, :C1), false);
RESET ROLE;

SET ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"0b0e1a57-0000-4000-8000-0000000000b1"}', false);
SELECT public.check_eq('a buyer (no membership) sees no contact', public.visible_contacts(), '');
RESET ROLE;

-- The producer is a member of L2 (by design they then see L2's directory),
-- and of nothing else: L's contacts stay hidden, and their own CRM is
-- exactly what owner_only already gave them.
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"0b0e1a57-0000-4000-8000-000000000001"}', false);
SELECT public.check_eq('producer: own CRM rows + the directory of the org they are in, nothing of L',
  public.visible_contacts(), 'Other label artist,Producer buyer,Producer contact 1');
SELECT public.check_eq('producer: own rows (org_id IS NULL) are exactly owner_only''s',
  (SELECT count(*) FROM public.contacts WHERE org_id IS NULL), 2::bigint);
SELECT public.check_eq('producer cannot write an org contact (no org write policy)',
  public.rows_changed($$UPDATE public.contacts SET notes = 'x' WHERE id = 'c1000000-0000-4000-8000-0000000000d1'$$), 0);
SELECT public.check_raises('producer cannot move their own contact into an org (contacts_org_or_owner)',
  $$UPDATE public.contacts SET org_id = 'b1000000-0000-4000-8000-000000000002' WHERE id = 'c1000000-0000-4000-8000-0000000000a1'$$,
  'contacts_org_or_owner|row-level security');
SELECT public.check_raises('producer cannot insert an ownerless org contact',
  $$INSERT INTO public.contacts (org_id, name) VALUES ('b1000000-0000-4000-8000-000000000002', 'sneaky')$$,
  'row-level security');
RESET ROLE;

-- ── Org members: producer rows never, other orgs never, scope narrows ───

SET ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-000000000001"}', false);
SELECT public.check_eq('L owner sees every L contact and nothing else', public.visible_contacts(), 'Kilo,Nova');
SELECT public.check_eq('L owner: no producer row (org_id IS NULL)',
  (SELECT count(*) FROM public.contacts WHERE org_id IS NULL), 0::bigint);
SELECT public.check_eq('L owner: no L2 row', (SELECT count(*) FROM public.contacts WHERE org_id = :L2), 0::bigint);
SELECT public.check_eq('L owner: can_see_artist on another org''s contact is false', public.can_see_artist(:L2, :D1), false);
SELECT public.check_eq('L owner: can_see_artist with a mismatched org is false', public.can_see_artist(:L, :D1), false);
SELECT public.check_eq('L owner: can_see_artist on a producer contact is false', public.can_see_artist(:L, :PC1), false);
SELECT public.check_eq('L owner cannot write a contact through RLS',
  public.rows_changed($$UPDATE public.contacts SET notes = 'x' WHERE org_id = 'b1000000-0000-4000-8000-000000000001'$$), 0);
SELECT public.check_eq('L owner reads every scope row of L', (SELECT count(*) FROM public.member_artist_scopes), 1::bigint);
SELECT public.check_raises('nobody inserts scope rows through PostgREST (no grant)',
  $$INSERT INTO public.member_artist_scopes (org_id, user_id, contact_id) VALUES ('b1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000004', 'c1000000-0000-4000-8000-0000000000c2')$$,
  'permission denied');
RESET ROLE;

SET ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-000000000002"}', false);
SELECT public.check_eq('org-scoped A&R sees every L contact', public.visible_contacts(), 'Kilo,Nova');
SELECT public.check_eq('A&R (no members.manage) does not read others'' scope rows', (SELECT count(*) FROM public.member_artist_scopes), 0::bigint);
RESET ROLE;

SET ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-000000000003"}', false);
SELECT public.check_eq('artists-scoped member sees only their contact', public.visible_contacts(), 'Nova');
SELECT public.check_eq('artists-scoped: can_see_artist on an out-of-scope contact is false', public.can_see_artist(:L, :C2), false);
SELECT public.check_eq('artists-scoped member reads their own scope row', (SELECT count(*) FROM public.member_artist_scopes), 1::bigint);
SELECT public.check_raises('artists-scoped member cannot widen their scope',
  $$INSERT INTO public.member_artist_scopes (org_id, user_id, contact_id) VALUES ('b1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-0000000000c2')$$,
  'permission denied');
SELECT public.check_eq('artists-scoped member cannot widen their membership scope either',
  public.rows_changed($$UPDATE public.org_members SET scope = 'org' WHERE user_id = 'a1000000-0000-4000-8000-000000000003'$$), 0);
RESET ROLE;

SET ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-000000000004"}', false);
SELECT public.check_eq('roster artist with zero scope rows sees nothing', public.visible_contacts(), '');
RESET ROLE;
-- Role `artist` is scoped by ROLE, whatever the scope column says.
ALTER TABLE public.org_members DROP CONSTRAINT org_members_artist_is_scoped;
UPDATE public.org_members SET scope = 'org' WHERE user_id = :ART;
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-000000000004"}', false);
SELECT public.check_eq('a roster artist is scoped even with scope = org', public.visible_contacts(), '');
RESET ROLE;
UPDATE public.org_members SET scope = 'artists' WHERE user_id = :ART;
ALTER TABLE public.org_members ADD CONSTRAINT org_members_artist_is_scoped CHECK (role <> 'artist' OR scope = 'artists');

SET ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-000000000005"}', false);
SELECT public.check_eq('a member without catalog.read sees no contact', public.visible_contacts(), '');
RESET ROLE;

-- Soft-deleting L hides its directory from its own owner.
UPDATE public.organizations SET deleted_at = now() WHERE id = :L;
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-000000000001"}', false);
SELECT public.check_eq('soft-deleted org: its owner sees nothing', public.visible_contacts(), '');
RESET ROLE;
UPDATE public.organizations SET deleted_at = NULL WHERE id = :L;

-- ── Integrity ────────────────────────────────────────────────────────────

SELECT public.check_raises('scope row for another org''s contact is refused (same-org trigger)',
  $$INSERT INTO public.member_artist_scopes (org_id, user_id, contact_id) VALUES ('b1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000004', 'c1000000-0000-4000-8000-0000000000d1')$$,
  'is not a contact of organization');
SELECT public.check_raises('scope row for a producer contact is refused',
  $$INSERT INTO public.member_artist_scopes (org_id, user_id, contact_id) VALUES ('b1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000004', 'c1000000-0000-4000-8000-0000000000a1')$$,
  'is not a contact of organization');
SELECT public.check_raises('scope row for a non-member is refused (FK to org_members)',
  $$INSERT INTO public.member_artist_scopes (org_id, user_id, contact_id) VALUES ('b1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000006', 'c1000000-0000-4000-8000-0000000000c1')$$,
  'foreign key');
SELECT public.check_raises('an org contact cannot carry a user_id',
  $$UPDATE public.contacts SET user_id = '0b0e1a57-0000-4000-8000-000000000001' WHERE id = 'c1000000-0000-4000-8000-0000000000c1'$$,
  'contacts_org_or_owner');
SELECT public.check_raises('an org contact cannot move to another org',
  $$UPDATE public.contacts SET org_id = 'b1000000-0000-4000-8000-000000000002' WHERE id = 'c1000000-0000-4000-8000-0000000000c1'$$,
  'cannot move');
SELECT public.check_raises('one email once per org directory',
  $$INSERT INTO public.contacts (org_id, name, email) VALUES ('b1000000-0000-4000-8000-000000000001', 'Nova again', 'nova@local.test')$$,
  'contacts_org_email_uniq');
-- The same email in the producer's CRM and in an org is two separate people records.
INSERT INTO public.contacts (user_id, name, email) VALUES (:P, 'Nova in the CRM', 'nova@local.test');
-- A producer row's org_id can still be left alone by an ordinary update.
UPDATE public.contacts SET notes = 'unchanged org' WHERE id = :PC1;
DELETE FROM public.org_members WHERE org_id = :L AND user_id = :SC;
SELECT public.check_eq('removing a member removes their scope rows',
  (SELECT count(*) FROM public.member_artist_scopes WHERE user_id = :SC), 0::bigint);

-- ── Replaying 110/111 (db:migrate replays every file) leaves org contacts alone ──
-- 111 adopts NULL-owner contacts onto the single producer and merges ones
-- whose email the producer already has. An org contact is NULL-owner by
-- design and shares an email with a CRM row here (nova@local.test).
INSERT INTO public.contacts (user_id, name, email) VALUES (NULL, 'Real orphan', 'orphan@local.test');
-- One transaction per file, as scripts/apply-migrations.sh runs them (110's
-- temp table is ON COMMIT DROP).
BEGIN;
\ir ../../migrations/110_normalize_contact_emails.sql
COMMIT;
BEGIN;
\ir ../../migrations/111_adopt_orphan_contacts.sql
COMMIT;
SELECT public.check_eq('after replaying 110 + 111 every org contact is still there, ownerless and in its org',
  (SELECT count(*) FROM public.contacts WHERE org_id IS NOT NULL AND user_id IS NULL), 3::bigint);
SELECT public.check_eq('…and a real orphan is still adopted by the producer',
  (SELECT user_id FROM public.contacts WHERE email = 'orphan@local.test'), :P::uuid);

-- ── Accepting an artist-limited invitation writes the scope (carried) ───

CREATE FUNCTION pg_temp.h(t text) RETURNS text LANGUAGE sql AS $$ SELECT encode(sha256(convert_to(t, 'UTF8')), 'hex') $$;
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('a1000000-0000-4000-8000-000000000007', 'new-artist@local.test', now()),
  ('a1000000-0000-4000-8000-000000000008', 'new-ar@local.test', now());
INSERT INTO public.org_invitations (org_id, email, role, functions, artist_ids, token_hash, expires_at, invited_by) VALUES
  (:L, 'new-artist@local.test', 'artist', '{}', ARRAY[:C2::uuid, :D1::uuid, 'c1000000-0000-4000-8000-0000000000ff'::uuid],
   pg_temp.h('artist'), now() + interval '7 days', :O),
  (:L, 'new-ar@local.test', 'member', '{a_and_r}', '{}', pg_temp.h('ar'), now() + interval '7 days', :O);
SET ROLE service_role;
SELECT public.check_eq('artist invitation → joined',
  public.labelos_accept_invitation(pg_temp.h('artist'), 'a1000000-0000-4000-8000-000000000007') ->> 'status', 'joined');
SELECT public.check_eq('org-wide invitation → joined',
  public.labelos_accept_invitation(pg_temp.h('ar'), 'a1000000-0000-4000-8000-000000000008') ->> 'status', 'joined');
RESET ROLE;
SELECT public.check_eq('scope rows = the invitation''s contacts that are in THIS org (other org + unknown skipped)',
  (SELECT string_agg(contact_id::text, ',') FROM public.member_artist_scopes WHERE user_id = 'a1000000-0000-4000-8000-000000000007'),
  'c1000000-0000-4000-8000-0000000000c2');
SELECT public.check_eq('member.joined records the contacts actually scoped',
  (SELECT payload -> 'contact_ids' FROM public.activity_events WHERE verb = 'member.joined' AND subject_id = 'a1000000-0000-4000-8000-000000000007'),
  '["c1000000-0000-4000-8000-0000000000c2"]'::jsonb);
SELECT public.check_eq('an org-wide join writes no scope rows',
  (SELECT count(*) FROM public.member_artist_scopes WHERE user_id = 'a1000000-0000-4000-8000-000000000008'), 0::bigint);
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-000000000007"}', false);
SELECT public.check_eq('the new artist sees exactly their roster contact', public.visible_contacts(), 'Kilo');
RESET ROLE;

-- ── Backfill: a member who joined before 139 ────────────────────────────
-- Simulate 138's state: the membership and event exist, the scope row not.
DELETE FROM public.member_artist_scopes WHERE user_id = 'a1000000-0000-4000-8000-000000000007';
\ir ../../migrations/139_labelos_org_contacts.sql
SELECT public.check_eq('replaying 139 backfills the scope from the accepted invitation',
  (SELECT string_agg(contact_id::text, ',') FROM public.member_artist_scopes WHERE user_id = 'a1000000-0000-4000-8000-000000000007'),
  'c1000000-0000-4000-8000-0000000000c2');
SELECT public.check_eq('backfill adds nothing for an org-scoped member',
  (SELECT count(*) FROM public.member_artist_scopes WHERE user_id = 'a1000000-0000-4000-8000-000000000008'), 0::bigint);

-- ── Artist org: its single roster contact is created with it (D1) ───────
INSERT INTO auth.users (id, email) VALUES ('a1000000-0000-4000-8000-000000000009', '  Nova.Self@Local.Test ');
INSERT INTO public.organizations (id, name, slug, kind, created_by)
  VALUES ('b1000000-0000-4000-8000-000000000003', 'Nova', 'nova', 'artist', 'a1000000-0000-4000-8000-000000000009');
SELECT public.check_eq('artist org gets one artist contact named after it, creator''s email normalised, no user_id',
  (SELECT count(*) || '|' || min(name) || '|' || min(email) || '|' || min(category) || '|' || bool_and(user_id IS NULL)
   FROM public.contacts WHERE org_id = 'b1000000-0000-4000-8000-000000000003'),
  '1|Nova|nova.self@local.test|artist|true');
INSERT INTO public.organizations (id, name, slug, kind, created_by) VALUES
  ('b1000000-0000-4000-8000-000000000004', 'Label L3', 'label-l3', 'label', 'a1000000-0000-4000-8000-000000000009'),
  ('b1000000-0000-4000-8000-000000000005', 'Studio S', 'studio-s', 'producer', 'a1000000-0000-4000-8000-000000000009');
SELECT public.check_eq('label and producer orgs get no automatic contact',
  (SELECT count(*) FROM public.contacts WHERE org_id IN ('b1000000-0000-4000-8000-000000000004', 'b1000000-0000-4000-8000-000000000005')),
  0::bigint);

-- ── Helper hygiene ───────────────────────────────────────────────────────
SELECT public.check_eq('can_see_artist owned by postgres, SECURITY DEFINER, STABLE, pinned search_path',
  (SELECT count(*) FROM pg_proc WHERE proname = 'can_see_artist'
     AND pg_get_userbyid(proowner) = 'postgres' AND prosecdef AND provolatile = 's' AND proconfig @> ARRAY['search_path=public']),
  1::bigint);
SELECT public.check_eq('member_artist_scopes references only org_members and contacts (a second path to organizations makes PostgREST embeds of org_members → organizations ambiguous)',
  (SELECT string_agg(confrelid::regclass::text, ',' ORDER BY confrelid::regclass::text)
   FROM pg_constraint WHERE conrelid = 'public.member_artist_scopes'::regclass AND contype = 'f'),
  'contacts,org_members');
SELECT public.check_eq('member_artist_scopes has RLS on',
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.member_artist_scopes'::regclass), true);

DROP FUNCTION public.visible_contacts();
DROP FUNCTION public.rows_changed(text);
DROP FUNCTION public.check_eq(text, anyelement, anyelement);
DROP FUNCTION public.check_raises(text, text, text);
