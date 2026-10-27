-- Behaviour checks for 186_labelos_listing_consent.sql (LABEL-71), run by
-- scripts/local-db/check.sh (npm run db:local:check) in its own copy of the
-- throwaway database. Every check RAISEs on failure; psql stops at the first.
--
-- What is proven, as the roles PostgREST uses — never only as the service role:
--   - both tables are org-only (no user_id), RLS on, ONE policy that grants
--     nothing: a member, an artist and anon read and write nothing with their
--     own JWT (privileges revoked, 141's trigger says the same);
--   - listing_consents: states proposed|yes|no; `decided_at` is set exactly
--     when answered; one row per (release, artist); a release / artist of
--     another org is refused; org, release and artist never change; an answer
--     never goes back to "asked"; the artist contact cannot be deleted from
--     under their answer (RESTRICT) while deleting the org takes it all;
--   - store_listing_vetoes: only a label with an ACTIVE connection to the
--     release's org can hold one; one per release; release and org never
--     change; deleting the label org / the release removes it.
--
-- Cast: label L (owner O), artist org AR (owner X, artist contact CA, release REL),
-- stranger label L2 (owner Z). Active connection L ↔ AR.

\set O  '''a1860000-0000-4000-8000-000000000001'''
\set X  '''a1860000-0000-4000-8000-000000000002'''
\set Z  '''a1860000-0000-4000-8000-000000000003'''
\set L  '''b1860000-0000-4000-8000-000000000001'''
\set AR '''b1860000-0000-4000-8000-000000000002'''
\set L2 '''b1860000-0000-4000-8000-000000000003'''
\set CL '''c1860000-0000-4000-8000-0000000000c1'''
\set CA '''c1860000-0000-4000-8000-0000000000c2'''
\set CB '''c1860000-0000-4000-8000-0000000000c3'''
\set CX '''c1860000-0000-4000-8000-0000000000c4'''
\set PA '''d1860000-0000-4000-8000-000000000001'''
\set PX '''d1860000-0000-4000-8000-000000000002'''
\set REL  '''e1860000-0000-4000-8000-000000000001'''
\set XREL '''e1860000-0000-4000-8000-000000000002'''
\set CONN '''f1860000-0000-4000-8000-000000000001'''

INSERT INTO auth.users (id, email) VALUES
  (:O, 'o186@local.test'), (:X, 'x186@local.test'), (:Z, 'z186@local.test');
INSERT INTO public.organizations (id, name, slug, kind, created_by) VALUES
  (:L, 'Label L', 'label-l-186', 'label', :O),
  (:AR, 'Artist AR', 'artist-ar-186', 'artist', :X),
  (:L2, 'Label L2', 'label-l2-186', 'label', :Z);
INSERT INTO public.org_members (org_id, user_id, role, functions, scope, cap_grants) VALUES
  (:L, :O, 'owner', '{}', 'org', '{}'),
  (:AR, :X, 'owner', '{}', 'org', '{}'),
  (:L2, :Z, 'owner', '{}', 'org', '{}');
-- An artist org is created with its one roster artist (139/166); give that contact a known id.
UPDATE public.contacts SET id = :CA WHERE org_id = :AR AND org_self_artist;
INSERT INTO public.contacts (id, user_id, org_id, name, email, category) VALUES
  (:CL, NULL, :L, 'Ara', 'ara186@local.test', 'artist'),
  (:CB, NULL, :AR, 'Feature', 'feat186@local.test', 'producer'),
  (:CX, NULL, :L2, 'Other', 'other186@local.test', 'artist');
INSERT INTO public.projects (id, user_id, org_id, name) VALUES
  (:PA, NULL, :AR, 'Ara EP'), (:PX, NULL, :L2, 'L2 EP');
INSERT INTO public.releases (id, org_id, project_id, contact_id, title) VALUES
  (:REL, :AR, :PA, :CA, 'Ara single'), (:XREL, :L2, :PX, :CX, 'L2 single');

INSERT INTO public.org_connections (id, label_org_id, artist_org_id, initiated_by) VALUES (:CONN, :L, :AR, 'label');
UPDATE public.org_connections SET status = 'active', label_contact_id = :CL, accepted_by = :X, accepted_at = now() WHERE id = :CONN;

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
CREATE FUNCTION public.as_user(p_user text) RETURNS void
LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, false);
$$;

-- ── The tables ──────────────────────────────────────────────────────────

SELECT public.check_eq('listing_consents has no user_id column',
  (SELECT count(*)::int FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'listing_consents' AND column_name = 'user_id'), 0);
SELECT public.check_eq('store_listing_vetoes has no user_id column',
  (SELECT count(*)::int FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'store_listing_vetoes' AND column_name = 'user_id'), 0);
SELECT public.check_eq('both tables have row level security on',
  (SELECT count(*)::int FROM pg_class WHERE oid IN ('public.listing_consents'::regclass, 'public.store_listing_vetoes'::regclass) AND relrowsecurity), 2);
SELECT public.check_eq('each table has one policy, and it grants nothing',
  (SELECT string_agg(policyname || '/' || cmd || '/' || qual, ',' ORDER BY policyname) FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('listing_consents', 'store_listing_vetoes')),
  'listing_consents_no_direct_access/ALL/false,store_listing_vetoes_no_direct_access/ALL/false');

-- ── listing_consents: shape, as the service role (postgres here) ────────

INSERT INTO public.listing_consents (id, org_id, release_id, artist_contact_id, proposed_by) VALUES
  ('a2860000-0000-4000-8000-000000000001', :AR, :REL, :CA, :X),
  ('a2860000-0000-4000-8000-000000000002', :AR, :REL, :CB, :X);
SELECT public.check_eq('a new consent is asked, with no decision',
  (SELECT state || '/' || (decided_at IS NULL)::text FROM public.listing_consents WHERE id = 'a2860000-0000-4000-8000-000000000001'), 'proposed/true');

SELECT public.check_raises('one row per release and artist',
  format($$INSERT INTO public.listing_consents (org_id, release_id, artist_contact_id) VALUES (%L, %L, %L)$$, 'b1860000-0000-4000-8000-000000000002', 'e1860000-0000-4000-8000-000000000001', 'c1860000-0000-4000-8000-0000000000c2'),
  'listing_consents_one_per_artist|duplicate key');
SELECT public.check_raises('an unknown state is refused',
  format($$UPDATE public.listing_consents SET state = 'maybe' WHERE id = %L$$, 'a2860000-0000-4000-8000-000000000001'),
  'state_check|check constraint');
SELECT public.check_raises('an answer without a time is refused',
  format($$UPDATE public.listing_consents SET state = 'yes' WHERE id = %L$$, 'a2860000-0000-4000-8000-000000000001'),
  'decided_shape|check constraint');
SELECT public.check_raises('a release of another organization is refused',
  format($$INSERT INTO public.listing_consents (org_id, release_id, artist_contact_id) VALUES (%L, %L, %L)$$, 'b1860000-0000-4000-8000-000000000003', 'e1860000-0000-4000-8000-000000000001', 'c1860000-0000-4000-8000-0000000000c4'),
  'belongs to another organization');
SELECT public.check_raises('an artist of another organization is refused',
  format($$INSERT INTO public.listing_consents (org_id, release_id, artist_contact_id) VALUES (%L, %L, %L)$$, 'b1860000-0000-4000-8000-000000000002', 'e1860000-0000-4000-8000-000000000001', 'c1860000-0000-4000-8000-0000000000c4'),
  'artist belongs to another organization');

UPDATE public.listing_consents SET state = 'no', decided_by = :X, decided_at = now() WHERE id = 'a2860000-0000-4000-8000-000000000001';
SELECT public.check_eq('a no is recorded with who and when',
  (SELECT state || '/' || (decided_by = 'a1860000-0000-4000-8000-000000000002')::text || '/' || (decided_at IS NOT NULL)::text FROM public.listing_consents WHERE id = 'a2860000-0000-4000-8000-000000000001'), 'no/true/true');
UPDATE public.listing_consents SET state = 'yes', decided_by = :X, decided_at = now() WHERE id = 'a2860000-0000-4000-8000-000000000001';
SELECT public.check_eq('the artist may change a no to a yes',
  (SELECT state FROM public.listing_consents WHERE id = 'a2860000-0000-4000-8000-000000000001'), 'yes');
SELECT public.check_raises('an answered consent never goes back to asked',
  format($$UPDATE public.listing_consents SET state = 'proposed', decided_at = NULL WHERE id = %L$$, 'a2860000-0000-4000-8000-000000000001'),
  'does not go back to asked');
SELECT public.check_raises('the release never changes',
  format($$UPDATE public.listing_consents SET release_id = %L WHERE id = %L$$, 'e1860000-0000-4000-8000-000000000002', 'a2860000-0000-4000-8000-000000000001'),
  'never change|belongs to another organization');
SELECT public.check_raises('the artist never changes',
  format($$UPDATE public.listing_consents SET artist_contact_id = %L WHERE id = %L$$, 'c1860000-0000-4000-8000-0000000000c3', 'a2860000-0000-4000-8000-000000000001'),
  'never change|one_per_artist|duplicate key');
SELECT public.check_raises('an artist cannot be deleted from under their answer',
  format($$DELETE FROM public.contacts WHERE id = %L$$, 'c1860000-0000-4000-8000-0000000000c3'),
  'foreign key|violates');

-- ── store_listing_vetoes ────────────────────────────────────────────────

SELECT public.check_raises('a label without a connection cannot veto',
  format($$INSERT INTO public.store_listing_vetoes (release_id, org_id) VALUES (%L, %L)$$, 'e1860000-0000-4000-8000-000000000001', 'b1860000-0000-4000-8000-000000000003'),
  'no active connection');
SELECT public.check_raises('a label cannot veto a release of an unconnected org',
  format($$INSERT INTO public.store_listing_vetoes (release_id, org_id) VALUES (%L, %L)$$, 'e1860000-0000-4000-8000-000000000002', 'b1860000-0000-4000-8000-000000000001'),
  'no active connection');
INSERT INTO public.store_listing_vetoes (release_id, org_id, vetoed_by) VALUES (:REL, :L, :O);
SELECT public.check_eq('the connected label holds a veto', (SELECT count(*)::int FROM public.store_listing_vetoes WHERE org_id = :L), 1);
SELECT public.check_raises('one veto per release',
  format($$INSERT INTO public.store_listing_vetoes (release_id, org_id) VALUES (%L, %L)$$, 'e1860000-0000-4000-8000-000000000001', 'b1860000-0000-4000-8000-000000000001'),
  'duplicate key');
SELECT public.check_raises('the release of a veto never changes',
  format($$UPDATE public.store_listing_vetoes SET release_id = %L$$, 'e1860000-0000-4000-8000-000000000002'),
  'never change');

-- ── The API roles read and write neither table ──────────────────────────

SET ROLE authenticated;
SELECT public.as_user('a1860000-0000-4000-8000-000000000002');
SELECT public.check_raises('the artist cannot read their own consents with their JWT',
  $$SELECT count(*) FROM public.listing_consents$$, 'permission denied');
SELECT public.check_raises('the artist cannot answer by writing the row',
  $$UPDATE public.listing_consents SET state = 'yes'$$, 'permission denied');
SELECT public.check_raises('the artist cannot forge a consent',
  $$INSERT INTO public.listing_consents (org_id, release_id, artist_contact_id) VALUES ('b1860000-0000-4000-8000-000000000002', 'e1860000-0000-4000-8000-000000000001', 'c1860000-0000-4000-8000-0000000000c3')$$, 'permission denied');
SELECT public.check_raises('the artist cannot delete a consent',
  $$DELETE FROM public.listing_consents$$, 'permission denied');
SELECT public.as_user('a1860000-0000-4000-8000-000000000001');
SELECT public.check_raises('the label owner cannot read the veto table',
  $$SELECT count(*) FROM public.store_listing_vetoes$$, 'permission denied');
SELECT public.check_raises('the label owner cannot lift the veto by writing',
  $$DELETE FROM public.store_listing_vetoes$$, 'permission denied');
SELECT public.check_raises('the label owner cannot write a veto',
  $$INSERT INTO public.store_listing_vetoes (release_id, org_id) VALUES ('e1860000-0000-4000-8000-000000000001', 'b1860000-0000-4000-8000-000000000001')$$, 'permission denied');
RESET ROLE;

SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
SELECT public.check_raises('anon reads no consent', $$SELECT count(*) FROM public.listing_consents$$, 'permission denied');
SELECT public.check_raises('anon reads no veto', $$SELECT count(*) FROM public.store_listing_vetoes$$, 'permission denied');
RESET ROLE;

-- ── Deletion ────────────────────────────────────────────────────────────

SELECT public.check_eq('the rows survived the refused attempts',
  (SELECT count(*)::int FROM public.listing_consents) * 10 + (SELECT count(*)::int FROM public.store_listing_vetoes), 21);
DELETE FROM public.store_listing_vetoes WHERE release_id = :REL;
SELECT public.check_eq('the service role lifts a veto', (SELECT count(*)::int FROM public.store_listing_vetoes), 0);
INSERT INTO public.store_listing_vetoes (release_id, org_id) VALUES (:REL, :L);
DELETE FROM public.organizations WHERE id = :L;
SELECT public.check_eq('purging the label deletes its veto', (SELECT count(*)::int FROM public.store_listing_vetoes), 0);
SELECT public.check_eq('…and leaves the artist org’s consents', (SELECT count(*)::int FROM public.listing_consents WHERE org_id = :AR), 2);
DELETE FROM public.organizations WHERE id = :AR;
SELECT public.check_eq('purging the artist org deletes its consents', (SELECT count(*)::int FROM public.listing_consents), 0);

SELECT 'ok: 186_labelos_listing_consent' AS result;
