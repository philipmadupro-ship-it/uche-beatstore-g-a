-- Behaviour checks for 161_labelos_saved_views.sql (LABEL-37), run by
-- scripts/local-db/check.sh (npm run db:local:check) in its own copy of the
-- throwaway database. Every check RAISEs on failure; psql stops at the first.
--
-- What is proven, as the roles PostgREST uses — never only as the service role:
--   - the table is org-only (no user_id), RLS on, and its one policy says no:
--     a member with their own JWT reads nothing of it, not even their own row (the
--     definition holds artist ids a scoped member must not read), and the API
--     roles can neither write nor delete (privileges revoked; 141's trigger
--     says the same);
--   - the shape the database insists on: subject songs|releases, a name of 1–80
--     characters, a definition that is a JSON object of at most 4000 bytes,
--     whose `subject` is the row's and whose `v` is a number;
--   - one name per author per subject (case-insensitive, trimmed);
--   - the organization, author and subject never change;
--   - deleting the organization (LABEL-39's purge) deletes its views, and the
--     author's deletion deletes theirs; another org's views are untouched.
--
-- Cast (seed: producer P):
--   label L : owner O, member M (A&R, scoped to artist C1)
--   label L2: owner X

\set P  '''0b0e1a57-0000-4000-8000-000000000001'''
\set O  '''a1610000-0000-4000-8000-000000000001'''
\set M  '''a1610000-0000-4000-8000-000000000002'''
\set X  '''a1610000-0000-4000-8000-000000000003'''
\set L  '''b1610000-0000-4000-8000-000000000001'''
\set L2 '''b1610000-0000-4000-8000-000000000002'''
\set C1 '''c1610000-0000-4000-8000-0000000000c1'''

INSERT INTO auth.users (id, email) VALUES
  (:O, 'o161@local.test'), (:M, 'm161@local.test'), (:X, 'x161@local.test');
INSERT INTO public.organizations (id, name, slug, kind, created_by) VALUES
  (:L, 'Label L', 'label-l-161', 'label', :O),
  (:L2, 'Label L2', 'label-l2-161', 'label', :X);
INSERT INTO public.org_members (org_id, user_id, role, functions, scope, cap_grants) VALUES
  (:L, :O, 'owner', '{}', 'org', '{}'),
  (:L, :M, 'member', '{a_and_r}', 'artists', '{}'),
  (:L2, :X, 'owner', '{}', 'org', '{}');
INSERT INTO public.contacts (id, user_id, org_id, name, email, category) VALUES
  (:C1, NULL, :L, 'Nova', 'nova161@local.test', 'artist');
INSERT INTO public.member_artist_scopes (org_id, user_id, contact_id) VALUES (:L, :M, :C1);

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

-- ── The table ───────────────────────────────────────────────────────────

SELECT public.check_eq('org_saved_views has no user_id column',
  (SELECT count(*)::int FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'org_saved_views' AND column_name = 'user_id'), 0);
SELECT public.check_eq('org_saved_views has row level security on',
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.org_saved_views'::regclass), true);
SELECT public.check_eq('org_saved_views has one policy, and it grants nothing',
  (SELECT string_agg(policyname || '/' || cmd || '/' || qual, ',') FROM pg_policies WHERE schemaname = 'public' AND tablename = 'org_saved_views'),
  'org_saved_views_no_direct_access/ALL/false');

-- ── Shape, as the service role (postgres here) ──────────────────────────

INSERT INTO public.org_saved_views (id, org_id, created_by, subject, name, definition, shared) VALUES
  ('d1610000-0000-4000-8000-000000000001', :L, :O, 'songs', 'Missing artwork', '{"v":1,"subject":"songs","filter":{"missing":["artwork"]}}', true),
  ('d1610000-0000-4000-8000-000000000002', :L, :M, 'songs', 'Nova only', '{"v":1,"subject":"songs","filter":{"artistIds":["c1610000-0000-4000-8000-0000000000c1"]}}', false),
  ('d1610000-0000-4000-8000-000000000003', :L2, :X, 'releases', 'Drafts', '{"v":1,"subject":"releases","filter":{"states":["draft"]}}', true);

SELECT public.check_raises('a definition about another subject is refused',
  $$INSERT INTO public.org_saved_views (org_id, created_by, subject, name, definition) VALUES ('b1610000-0000-4000-8000-000000000001', 'a1610000-0000-4000-8000-000000000001', 'releases', 'x', '{"v":1,"subject":"songs","filter":{}}')$$,
  'definition_shape');
SELECT public.check_raises('a definition that is not an object is refused',
  $$INSERT INTO public.org_saved_views (org_id, created_by, subject, name, definition) VALUES ('b1610000-0000-4000-8000-000000000001', 'a1610000-0000-4000-8000-000000000001', 'songs', 'x', '[1]')$$,
  'definition_shape');
SELECT public.check_raises('a definition without a numeric version is refused',
  $$INSERT INTO public.org_saved_views (org_id, created_by, subject, name, definition) VALUES ('b1610000-0000-4000-8000-000000000001', 'a1610000-0000-4000-8000-000000000001', 'songs', 'x', '{"v":"one","subject":"songs"}')$$,
  'definition_shape');
SELECT public.check_raises('a definition over 4000 bytes is refused',
  $$INSERT INTO public.org_saved_views (org_id, created_by, subject, name, definition) VALUES ('b1610000-0000-4000-8000-000000000001', 'a1610000-0000-4000-8000-000000000001', 'songs', 'x', jsonb_build_object('v', 1, 'subject', 'songs', 'filter', jsonb_build_object('text', repeat('x', 4100))))$$,
  'definition_shape');
SELECT public.check_raises('an empty name is refused',
  $$INSERT INTO public.org_saved_views (org_id, created_by, subject, name, definition) VALUES ('b1610000-0000-4000-8000-000000000001', 'a1610000-0000-4000-8000-000000000001', 'songs', '   ', '{"v":1,"subject":"songs"}')$$,
  'name_check|check constraint');
SELECT public.check_raises('a name over 80 characters is refused',
  $$INSERT INTO public.org_saved_views (org_id, created_by, subject, name, definition) VALUES ('b1610000-0000-4000-8000-000000000001', 'a1610000-0000-4000-8000-000000000001', 'songs', repeat('n', 81), '{"v":1,"subject":"songs"}')$$,
  'name_check|check constraint');
SELECT public.check_raises('an unknown subject is refused',
  $$INSERT INTO public.org_saved_views (org_id, created_by, subject, name, definition) VALUES ('b1610000-0000-4000-8000-000000000001', 'a1610000-0000-4000-8000-000000000001', 'people', 'x', '{"v":1,"subject":"people"}')$$,
  'subject_check|check constraint');
SELECT public.check_raises('one name per author and subject, ignoring case and padding',
  $$INSERT INTO public.org_saved_views (org_id, created_by, subject, name, definition) VALUES ('b1610000-0000-4000-8000-000000000001', 'a1610000-0000-4000-8000-000000000001', 'songs', '  MISSING artwork ', '{"v":1,"subject":"songs"}')$$,
  'idx_org_saved_views_author_name|duplicate key');
-- …but another author may use the name, and so may the same author for the other subject.
INSERT INTO public.org_saved_views (org_id, created_by, subject, name, definition) VALUES
  (:L, :M, 'songs', 'Missing artwork', '{"v":1,"subject":"songs"}'),
  (:L, :O, 'releases', 'Missing artwork', '{"v":1,"subject":"releases"}');

SELECT public.check_raises('the organization never changes',
  $$UPDATE public.org_saved_views SET org_id = 'b1610000-0000-4000-8000-000000000002' WHERE id = 'd1610000-0000-4000-8000-000000000001'$$,
  'never change');
SELECT public.check_raises('the author never changes',
  $$UPDATE public.org_saved_views SET created_by = 'a1610000-0000-4000-8000-000000000002' WHERE id = 'd1610000-0000-4000-8000-000000000001'$$,
  'never change');
UPDATE public.org_saved_views SET name = 'Needs artwork', shared = false WHERE id = 'd1610000-0000-4000-8000-000000000001';
SELECT public.check_eq('a name and the shared flag can change',
  (SELECT name || '/' || shared::text FROM public.org_saved_views WHERE id = 'd1610000-0000-4000-8000-000000000001'), 'Needs artwork/false');

-- ── The API roles ───────────────────────────────────────────────────────

SET ROLE authenticated;
SELECT public.as_user('a1610000-0000-4000-8000-000000000001');
SELECT public.check_raises('the owner cannot read the table with their own JWT',
  $$SELECT count(*) FROM public.org_saved_views$$, 'permission denied');
SELECT public.check_raises('the owner cannot insert',
  $$INSERT INTO public.org_saved_views (org_id, created_by, subject, name, definition) VALUES ('b1610000-0000-4000-8000-000000000001', 'a1610000-0000-4000-8000-000000000001', 'songs', 'forged', '{"v":1,"subject":"songs"}')$$,
  'permission denied');
SELECT public.check_raises('the owner cannot update',
  $$UPDATE public.org_saved_views SET shared = true$$, 'permission denied');
SELECT public.check_raises('the owner cannot delete',
  $$DELETE FROM public.org_saved_views$$, 'permission denied');
SELECT public.as_user('a1610000-0000-4000-8000-000000000002');
SELECT public.check_raises('a scoped member cannot read the artist ids in a definition',
  $$SELECT definition FROM public.org_saved_views$$, 'permission denied');
RESET ROLE;

SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
SELECT public.check_raises('anon reads nothing', $$SELECT count(*) FROM public.org_saved_views$$, 'permission denied');
RESET ROLE;

-- ── Deletion ────────────────────────────────────────────────────────────

SELECT public.check_eq('the rows are all still there after the refused attempts',
  (SELECT count(*)::int FROM public.org_saved_views), 5);
DELETE FROM auth.users WHERE id = :M;
SELECT public.check_eq('a deleted person takes their own views with them',
  (SELECT count(*)::int FROM public.org_saved_views WHERE org_id = :L), 2);
DELETE FROM public.organizations WHERE id = :L;
SELECT public.check_eq('purging an organization deletes its views',
  (SELECT count(*)::int FROM public.org_saved_views WHERE org_id = :L), 0);
SELECT public.check_eq('another organization’s views are untouched',
  (SELECT count(*)::int FROM public.org_saved_views WHERE org_id = :L2), 1);

SELECT 'ok: 161_labelos_saved_views' AS result;
