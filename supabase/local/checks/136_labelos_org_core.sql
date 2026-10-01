-- Behaviour checks for 136_labelos_org_core.sql, run by
-- scripts/db/local-check.sh in its own copy of the throwaway database.
-- Every check RAISEs on failure; psql stops at the first one.
--
-- Cast: org A (label): owner O, admin D, member M (marketing), roster
-- artist R. Org B (label): owner X. C belongs to no org.

INSERT INTO auth.users (id) VALUES
  ('a0000000-0000-4000-8000-00000000000a'),  -- O
  ('a0000000-0000-4000-8000-00000000000d'),  -- D
  ('a0000000-0000-4000-8000-00000000000e'),  -- M
  ('a0000000-0000-4000-8000-00000000000f'),  -- R
  ('b0000000-0000-4000-8000-00000000000b'),  -- X
  ('c0000000-0000-4000-8000-00000000000c');  -- C
INSERT INTO public.organizations (id, name, slug, kind) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000000', 'A', 'org-a', 'label'),
  ('bbbbbbbb-0000-4000-8000-000000000000', 'B', 'org-b', 'label');
INSERT INTO public.org_members (org_id, user_id, role, functions, scope) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000000', 'a0000000-0000-4000-8000-00000000000a', 'owner',  '{}',          'org'),
  ('aaaaaaaa-0000-4000-8000-000000000000', 'a0000000-0000-4000-8000-00000000000d', 'admin',  '{}',          'org'),
  ('aaaaaaaa-0000-4000-8000-000000000000', 'a0000000-0000-4000-8000-00000000000e', 'member', '{marketing}', 'org'),
  ('aaaaaaaa-0000-4000-8000-000000000000', 'a0000000-0000-4000-8000-00000000000f', 'artist', '{}',          'artists'),
  ('bbbbbbbb-0000-4000-8000-000000000000', 'b0000000-0000-4000-8000-00000000000b', 'owner',  '{}',          'org');
INSERT INTO public.activity_events (org_id, verb, visibility) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000000', 'song.created', 'artist'),
  ('aaaaaaaa-0000-4000-8000-000000000000', 'legal.note',   'internal'),
  ('bbbbbbbb-0000-4000-8000-000000000000', 'song.created', 'artist');
INSERT INTO public.user_profiles (user_id, display_name) VALUES
  ('a0000000-0000-4000-8000-00000000000a', 'O'),
  ('b0000000-0000-4000-8000-00000000000b', 'X');
INSERT INTO public.org_invitations (org_id, email, role, token_hash, expires_at) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000000', 'x@y.z', 'member', 'h1', now() + interval '7 days');

-- Helpers are created in public and dropped at the end (this database is a
-- throwaway copy anyway). Assertions run as the role currently SET.
CREATE FUNCTION public.check_eq(label text, got anyelement, want anyelement) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'CHECK FAILED: % — got %, want %', label, got, want;
  END IF;
END $$;
-- Runs `stmt`; passes only if it raises an error whose message matches `pattern`.
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
-- Runs `stmt` and returns how many rows it changed (RLS hides rows silently).
CREATE FUNCTION public.rows_changed(stmt text) RETURNS int
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  EXECUTE stmt;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
GRANT EXECUTE ON FUNCTION public.check_eq(text, anyelement, anyelement), public.check_raises(text, text, text), public.rows_changed(text) TO anon, authenticated;

-- ── Functions are owned by postgres, with a pinned search_path ───────────
SELECT public.check_eq('helpers owned by postgres',
  (SELECT count(*) FROM pg_proc WHERE proname IN ('org_role', 'has_org_cap', 'org_members_keep_an_owner')
     AND pg_get_userbyid(proowner) = 'postgres' AND prosecdef AND proconfig @> ARRAY['search_path=public']),
  3::bigint);

-- ── Member M (marketing) ─────────────────────────────────────────────────
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-00000000000e', false);
SELECT public.check_eq('M sees only org A', (SELECT string_agg(slug, ',') FROM public.organizations), 'org-a');
SELECT public.check_eq('M sees A''s 4 members', (SELECT count(*) FROM public.org_members), 4::bigint);
SELECT public.check_eq('M (business side) sees internal + artist events of A',
  (SELECT string_agg(verb, ',' ORDER BY verb) FROM public.activity_events), 'legal.note,song.created');
SELECT public.check_eq('M sees co-member profile O, not X',
  (SELECT string_agg(display_name, ',') FROM public.user_profiles), 'O');
SELECT public.check_eq('M cannot see invitations', (SELECT count(*) FROM public.org_invitations), 0::bigint);
SELECT public.check_eq('M role in A', public.org_role('aaaaaaaa-0000-4000-8000-000000000000'), 'member');
SELECT public.check_eq('M has nothing in B', public.has_org_cap('bbbbbbbb-0000-4000-8000-000000000000', 'catalog.read'), false);
SELECT public.check_raises('M cannot self-join org B',
  $$INSERT INTO public.org_members (org_id, user_id, role) VALUES ('bbbbbbbb-0000-4000-8000-000000000000', 'a0000000-0000-4000-8000-00000000000e', 'owner')$$,
  'permission denied');
SELECT public.check_eq('M cannot edit own functions',
  public.rows_changed($$UPDATE public.org_members SET functions = '{a_and_r}' WHERE user_id = 'a0000000-0000-4000-8000-00000000000e'$$), 0);
SELECT public.check_raises('activity_events: no UPDATE', $$UPDATE public.activity_events SET verb = 'x.y'$$, 'permission denied');
SELECT public.check_raises('activity_events: no DELETE', $$DELETE FROM public.activity_events$$, 'permission denied');
SELECT public.check_eq('organizations: no member writes',
  public.rows_changed($$UPDATE public.organizations SET kind = 'artist'$$), 0);

-- ── Roster artist R ──────────────────────────────────────────────────────
SELECT set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-00000000000f', false);
SELECT public.check_eq('roster artist sees no business-internal events',
  (SELECT string_agg(verb, ',') FROM public.activity_events), 'song.created');
SELECT public.check_eq('roster artist never holds contracts.read',
  public.has_org_cap('aaaaaaaa-0000-4000-8000-000000000000', 'contracts.read'), false);

-- ── Outsider C and anon ──────────────────────────────────────────────────
SELECT set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-00000000000c', false);
SELECT public.check_eq('outsider sees no orgs', (SELECT count(*) FROM public.organizations), 0::bigint);
SELECT public.check_eq('outsider sees no members', (SELECT count(*) FROM public.org_members), 0::bigint);
SELECT public.check_eq('outsider sees no events', (SELECT count(*) FROM public.activity_events), 0::bigint);
RESET ROLE;
SET ROLE anon;
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT public.check_eq('anon sees no orgs', (SELECT count(*) FROM public.organizations), 0::bigint);
SELECT public.check_eq('anon has no role', public.org_role('aaaaaaaa-0000-4000-8000-000000000000'), NULL::text);
RESET ROLE;

-- ── Admin D ──────────────────────────────────────────────────────────────
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-00000000000d', false);
SELECT public.check_eq('admin sees invitations', (SELECT count(*) FROM public.org_invitations), 1::bigint);
SELECT public.check_eq('admin edits a member''s functions and overrides',
  public.rows_changed($$UPDATE public.org_members SET functions = '{a_and_r}', cap_grants = '{rights.write}' WHERE user_id = 'a0000000-0000-4000-8000-00000000000e'$$), 1);
SELECT public.check_raises('admin cannot rewrite a membership''s user_id',
  $$UPDATE public.org_members SET user_id = 'c0000000-0000-4000-8000-00000000000c' WHERE user_id = 'a0000000-0000-4000-8000-00000000000e'$$,
  'permission denied');
SELECT public.check_eq('admin cannot demote the owner',
  public.rows_changed($$UPDATE public.org_members SET role = 'admin' WHERE user_id = 'a0000000-0000-4000-8000-00000000000a'$$), 0);
SELECT public.check_raises('admin cannot make an owner',
  $$UPDATE public.org_members SET role = 'owner' WHERE user_id = 'a0000000-0000-4000-8000-00000000000e'$$,
  'row-level security');
SELECT public.check_eq('admin cannot touch org B',
  public.rows_changed($$UPDATE public.org_members SET functions = '{legal}' WHERE org_id = 'bbbbbbbb-0000-4000-8000-000000000000'$$), 0);
RESET ROLE;

-- ── Owner rules (need real commits: the trigger is deferred) ─────────────
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-00000000000b', false);
\set ON_ERROR_STOP 0
-- X is B's only owner: the delete must fail at COMMIT.
\echo '(expected: "must keep at least one owner" error next)'
DELETE FROM public.org_members WHERE user_id = 'b0000000-0000-4000-8000-00000000000b';
\set ON_ERROR_STOP 1
SELECT public.check_eq('last owner cannot leave',
  (SELECT count(*) FROM public.org_members WHERE user_id = 'b0000000-0000-4000-8000-00000000000b'), 1::bigint);

-- Through RLS, O transfers A to M by promoting first: once O has demoted
-- themselves they are no longer an owner and cannot write owner rows.
SELECT set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-00000000000a', false);
BEGIN;
UPDATE public.org_members SET role = 'owner' WHERE user_id = 'a0000000-0000-4000-8000-00000000000e';
UPDATE public.org_members SET role = 'admin' WHERE user_id = 'a0000000-0000-4000-8000-00000000000a';
COMMIT;
SELECT public.check_raises('ex-owner can no longer make owners',
  $$UPDATE public.org_members SET role = 'owner' WHERE user_id = 'a0000000-0000-4000-8000-00000000000d'$$,
  'row-level security');
RESET ROLE;
SELECT public.check_eq('ownership transfer through RLS',
  (SELECT string_agg(role, ',' ORDER BY role) FROM public.org_members WHERE org_id = 'aaaaaaaa-0000-4000-8000-000000000000'),
  'admin,admin,artist,owner');

-- A service-role route may demote first: the owner check waits for COMMIT.
BEGIN;
UPDATE public.org_members SET role = 'admin' WHERE user_id = 'a0000000-0000-4000-8000-00000000000e';
UPDATE public.org_members SET role = 'owner' WHERE user_id = 'a0000000-0000-4000-8000-00000000000a';
COMMIT;
SELECT public.check_eq('deferred owner check allows demote-then-promote',
  (SELECT role FROM public.org_members WHERE user_id = 'a0000000-0000-4000-8000-00000000000a'), 'owner');

-- ── Soft and hard delete ─────────────────────────────────────────────────
UPDATE public.organizations SET deleted_at = now() WHERE slug = 'org-a';
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-00000000000e', false);
SELECT public.check_eq('soft-deleted org is hidden', (SELECT count(*) FROM public.organizations), 0::bigint);
SELECT public.check_eq('soft-deleted org grants nothing',
  public.has_org_cap('aaaaaaaa-0000-4000-8000-000000000000', 'catalog.read'), false);
RESET ROLE;
DELETE FROM public.organizations WHERE slug = 'org-b';
SELECT public.check_eq('hard delete cascades past the owner trigger',
  (SELECT count(*) FROM public.org_members WHERE org_id = 'bbbbbbbb-0000-4000-8000-000000000000'), 0::bigint);

DROP FUNCTION public.check_eq(text, anyelement, anyelement);
DROP FUNCTION public.check_raises(text, text, text);
DROP FUNCTION public.rows_changed(text);
