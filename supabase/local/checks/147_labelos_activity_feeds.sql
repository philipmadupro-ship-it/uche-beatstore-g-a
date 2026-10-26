-- Behaviour checks for 147_labelos_activity_feeds.sql (LABEL-20), run by
-- scripts/local-db/check.sh (npm run db:local:check) in its own copy of the
-- throwaway database. Every check RAISEs on failure; psql stops at the first.
--
-- What is proven, as `authenticated` with each member's own JWT claims (the
-- way PostgREST reads) — never only as the service role:
--   - a member limited to some artists, and a roster artist, read only the
--     events of their artists (and of projects in scope) — the gap LABEL-19
--     carried: 136's policy had no scope predicate;
--   - an event naming an artist is judged by the artist alone;
--   - an event naming neither artist nor project (organization-level) is read
--     by whole-org members only, a song_id alone does not place it;
--   - internal events stay with business.read.internal, an artist never reads
--     them; another org's events and a non-member's reads are empty; anon
--     reads nothing and gets no permission error;
--   - the table is still append-only through the API roles;
--   - user_profiles.last_seen_overview_at: nobody can write it through the
--     API roles, and who can READ it is exactly what 136 already allowed
--     (the user and co-members), nothing wider.
--
-- Cast (seed: producer P):
--   label L : owner O; AR (A&R, whole org: catalog.read, no internal);
--             SC (A&R scoped to artist C2); ART (roster artist C1)
--   label L2: owner X.   OUT is a member of nothing.
--   L : artists C1 (Nova), C2 (Kilo). LP1 = Nova's project (project_contacts),
--       LP2 = Kilo's Inbox, LP3 = a project with no artist. L2: CX, XP1.

\set P   '''0b0e1a57-0000-4000-8000-000000000001'''
\set O   '''a1470000-0000-4000-8000-000000000001'''
\set AR  '''a1470000-0000-4000-8000-000000000002'''
\set SC  '''a1470000-0000-4000-8000-000000000003'''
\set ART '''a1470000-0000-4000-8000-000000000004'''
\set X   '''a1470000-0000-4000-8000-000000000005'''
\set OUT '''a1470000-0000-4000-8000-000000000006'''
\set L   '''b1470000-0000-4000-8000-000000000001'''
\set L2  '''b1470000-0000-4000-8000-000000000002'''
\set C1  '''c1470000-0000-4000-8000-0000000000c1'''
\set C2  '''c1470000-0000-4000-8000-0000000000c2'''
\set CX  '''c1470000-0000-4000-8000-0000000000c3'''
\set GONE '''c1470000-0000-4000-8000-0000000000c9'''
\set LP1 '''d1470000-0000-4000-8000-000000000011'''
\set LP2 '''d1470000-0000-4000-8000-000000000012'''
\set LP3 '''d1470000-0000-4000-8000-000000000013'''
\set XP1 '''d1470000-0000-4000-8000-000000000021'''
\set S9  '''e1470000-0000-4000-8000-000000000009'''

INSERT INTO auth.users (id, email) VALUES
  (:O, 'o147@local.test'), (:AR, 'ar147@local.test'), (:SC, 'sc147@local.test'),
  (:ART, 'art147@local.test'), (:X, 'x147@local.test'), (:OUT, 'out147@local.test');
INSERT INTO public.organizations (id, name, slug, kind, created_by) VALUES
  (:L, 'Label L', 'label-l-147', 'label', :O),
  (:L2, 'Label L2', 'label-l2-147', 'label', :X);
INSERT INTO public.org_members (org_id, user_id, role, functions, scope) VALUES
  (:L, :O, 'owner', '{}', 'org'),
  (:L, :AR, 'member', '{a_and_r}', 'org'),
  (:L, :SC, 'member', '{a_and_r}', 'artists'),
  (:L, :ART, 'artist', '{}', 'artists'),
  (:L2, :X, 'owner', '{}', 'org');
INSERT INTO public.contacts (id, user_id, org_id, name, email, category) VALUES
  (:C1, NULL, :L, 'Nova', 'nova147@local.test', 'artist'),
  (:C2, NULL, :L, 'Kilo', 'kilo147@local.test', 'artist'),
  (:CX, NULL, :L2, 'Xen', 'xen147@local.test', 'artist');
INSERT INTO public.member_artist_scopes (org_id, user_id, contact_id) VALUES
  (:L, :SC, :C2), (:L, :ART, :C1);
INSERT INTO public.projects (id, user_id, org_id, name, inbox_for_contact_id) VALUES
  (:LP1, NULL, :L, 'Nova EP', NULL),
  (:LP2, NULL, :L, 'Inbox · Kilo', :C2),
  (:LP3, NULL, :L, 'Unassigned', NULL),
  (:XP1, NULL, :L2, 'L2 project', NULL);
INSERT INTO public.project_contacts (user_id, project_id, contact_id, role) VALUES (NULL, :LP1, :C1, 'artist');

-- One row per case; `n` is how the checks name it.
--  1 artist C1 + LP1            2 artist C2 + LP2         3 project-only LP1
--  4 project-only LP2           5 project-only LP3 (no artist)
--  6 internal, no context       7 artist-visibility, no context (org-level)
--  8 internal, C1 + LP1 (a restricted file)                9 artist C1 but project LP2
-- 10 song_id only              11 other org (CX)         12 artist of a deleted contact
INSERT INTO public.activity_events (org_id, actor_id, verb, subject_type, artist_id, project_id, song_id, payload, visibility, created_at) VALUES
  (:L,  :AR, 'song.created',     'track',   :C1,  :LP1, NULL, '{"n":1}',  'artist',   now() - interval '12 min'),
  (:L,  :AR, 'song.created',     'track',   :C2,  :LP2, NULL, '{"n":2}',  'artist',   now() - interval '11 min'),
  (:L,  :AR, 'file.uploaded',    'asset',   NULL, :LP1, NULL, '{"n":3}',  'artist',   now() - interval '10 min'),
  (:L,  :AR, 'file.uploaded',    'asset',   NULL, :LP2, NULL, '{"n":4}',  'artist',   now() - interval '9 min'),
  (:L,  :AR, 'file.uploaded',    'asset',   NULL, :LP3, NULL, '{"n":5}',  'artist',   now() - interval '8 min'),
  (:L,  :O,  'member.removed',   'member',  NULL, NULL, NULL, '{"n":6}',  'internal', now() - interval '7 min'),
  (:L,  :O,  'org.settings_changed', 'org', NULL, NULL, NULL, '{"n":7}',  'artist',   now() - interval '6 min'),
  (:L,  :O,  'file.uploaded',    'asset',   :C1,  :LP1, NULL, '{"n":8}',  'internal', now() - interval '5 min'),
  (:L,  :AR, 'release.created',  'release', :C1,  :LP2, NULL, '{"n":9}',  'artist',   now() - interval '4 min'),
  (:L,  :AR, 'recording.uploaded','track',  NULL, NULL, :S9,  '{"n":10}', 'artist',   now() - interval '3 min'),
  (:L2, :X,  'song.created',     'track',   :CX,  :XP1, NULL, '{"n":11}', 'artist',   now() - interval '2 min'),
  (:L,  :AR, 'song.created',     'track',   :GONE, NULL, NULL, '{"n":12}', 'artist',   now() - interval '1 min');

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
CREATE FUNCTION public.as_user(p_user text) RETURNS void
LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, false);
$$;
-- The events the caller reads, by case number.
CREATE FUNCTION public.visible_events() RETURNS text
LANGUAGE sql AS $$
  SELECT coalesce(string_agg(e.payload ->> 'n', ',' ORDER BY (e.payload ->> 'n')::int), '') FROM public.activity_events e
$$;
GRANT EXECUTE ON FUNCTION public.check_eq(text, anyelement, anyelement), public.check_raises(text, text, text),
  public.rows_changed(text), public.as_user(text), public.visible_events()
  TO anon, authenticated, service_role;

-- ── Schema ──────────────────────────────────────────────────────────────

SELECT public.check_eq('RLS is on for activity_events',
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.activity_events'::regclass), true);
SELECT public.check_eq('one policy, a SELECT, for everyone — nothing writes through the API roles',
  (SELECT string_agg(policyname || '=' || permissive || '/' || cmd || '/' || array_to_string(roles, '+'), ' ')
   FROM pg_policies WHERE schemaname = 'public' AND tablename = 'activity_events'),
  'activity_events_member_read=PERMISSIVE/SELECT/public');
SELECT public.check_eq('the policy still holds both 136 conditions and now the scope sets',
  (SELECT qual ~ 'catalog\.read' AND qual ~ 'business\.read\.internal' AND qual ~ 'labelos_scoped_projects' AND qual ~ 'member_artist_scopes'
   FROM pg_policies WHERE tablename = 'activity_events'), true);
SELECT public.check_eq('last_seen_overview_at is a nullable timestamptz on user_profiles',
  (SELECT data_type || '/' || is_nullable FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'user_profiles' AND column_name = 'last_seen_overview_at'),
  'timestamp with time zone/YES');
SELECT public.check_eq('user_profiles still has exactly one policy: the 136 SELECT',
  (SELECT string_agg(policyname || '=' || cmd, ',') FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_profiles'),
  'user_profiles_self_or_co_member_read=SELECT');
SELECT public.check_eq('the feed indexes exist',
  (SELECT count(*) FROM pg_indexes WHERE tablename = 'activity_events'
   AND indexname IN ('idx_activity_events_project_created', 'idx_activity_events_song_created')), 2::bigint);

-- ── Reads, as members, with their own claims ────────────────────────────

SET ROLE authenticated;

SELECT public.as_user(:O);
SELECT public.check_eq('owner (whole org, business.read.internal): every event of L, none of L2''s',
  public.visible_events(), '1,2,3,4,5,6,7,8,9,10,12');

SELECT public.as_user(:AR);
SELECT public.check_eq('A&R, whole org: every artist-visible event, nothing internal (6, 8)',
  public.visible_events(), '1,2,3,4,5,7,9,10,12');

SELECT public.as_user(:SC);
SELECT public.check_eq('A&R scoped to Kilo: Kilo''s event and the project-only event of Kilo''s project — nothing of Nova, nothing org-level',
  public.visible_events(), '2,4');
SELECT public.check_eq('… so Nova''s song.created (1) is not readable',
  (SELECT count(*) FROM public.activity_events WHERE payload ->> 'n' = '1'), 0::bigint);
SELECT public.check_eq('… and a release for Nova inside Kilo''s project (9) is not Kilo''s news: the artist decides',
  (SELECT count(*) FROM public.activity_events WHERE payload ->> 'n' = '9'), 0::bigint);

SELECT public.as_user(:ART);
SELECT public.check_eq('roster artist Nova: Nova''s events (1, 3, 9 — 9 although its project is Kilo''s); never the internal one (8)',
  public.visible_events(), '1,3,9');

SELECT public.as_user(:X);
SELECT public.check_eq('L2''s owner: only L2''s event', public.visible_events(), '11');

SELECT public.as_user(:OUT);
SELECT public.check_eq('a user in no org: nothing', public.visible_events(), '');
SELECT public.as_user(:P);
SELECT public.check_eq('the producer, member of neither: nothing', public.visible_events(), '');
RESET ROLE;

SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
SELECT public.check_eq('anon: nothing, and no permission error', public.visible_events(), '');
RESET ROLE;

-- The policy's set-based scope agrees with the per-object helpers it replaces
-- (can_see_artist / can_see_org_project, 139 / 141): the same answer for every
-- contact and project of the org, for each limited member.
SET ROLE authenticated;
SELECT public.as_user(:SC);
SELECT public.check_eq('scoped A&R: the scope rows == the contacts can_see_artist admits',
  (SELECT string_agg(c.id::text, ',' ORDER BY c.id) FROM public.contacts c WHERE c.org_id = :L AND public.can_see_artist(c.org_id, c.id)),
  (SELECT string_agg(s.contact_id::text, ',' ORDER BY s.contact_id) FROM public.member_artist_scopes s WHERE s.user_id = :SC));
SELECT public.check_eq('scoped A&R: labelos_scoped_projects() == the projects can_see_org_project admits',
  (SELECT string_agg(p.id::text, ',' ORDER BY p.id) FROM public.projects p WHERE public.can_see_org_project(p.org_id, p.id)),
  (SELECT string_agg(sp.project_id::text, ',' ORDER BY sp.project_id) FROM public.labelos_scoped_projects() sp));
SELECT public.check_eq('… and it is Kilo''s Inbox, nothing of Nova''s',
  (SELECT string_agg(sp.project_id::text, ',') FROM public.labelos_scoped_projects() sp), 'd1470000-0000-4000-8000-000000000012');
SELECT public.as_user(:ART);
SELECT public.check_eq('roster artist: labelos_scoped_projects() == can_see_org_project (Nova''s linked project)',
  (SELECT string_agg(p.id::text, ',' ORDER BY p.id) FROM public.projects p WHERE public.can_see_org_project(p.org_id, p.id)),
  (SELECT string_agg(sp.project_id::text, ',' ORDER BY sp.project_id) FROM public.labelos_scoped_projects() sp));
SELECT public.as_user(:O);
SELECT public.check_eq('a whole-org owner has no scope rows, so the set is empty (the whole-org disjunct covers them)',
  (SELECT count(*) FROM public.labelos_scoped_projects()), 0::bigint);
SELECT public.as_user(:X);
SELECT public.check_eq('another org''s owner: empty too, and Kilo''s project is nowhere in it',
  (SELECT count(*) FROM public.labelos_scoped_projects()), 0::bigint);
RESET ROLE;
SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
SELECT public.check_eq('anon: the function answers empty, not a permission error', (SELECT count(*) FROM public.labelos_scoped_projects()), 0::bigint);
RESET ROLE;

-- ── Current scope, not scope at write time (08 §B4) ─────────────────────

-- Widen SC to Nova as well: Nova's events appear without a new event row.
INSERT INTO public.member_artist_scopes (org_id, user_id, contact_id) VALUES (:L, :SC, :C1);
SET ROLE authenticated;
SELECT public.as_user(:SC);
SELECT public.check_eq('after Nova joins the scope, her history is readable (9 now too is Nova''s, 1 and 3 are)',
  public.visible_events(), '1,2,3,4,9');
RESET ROLE;
DELETE FROM public.member_artist_scopes WHERE user_id = :SC AND contact_id = :C2;
SET ROLE authenticated;
SELECT public.as_user(:SC);
SELECT public.check_eq('after Kilo leaves the scope, Kilo''s history goes with it',
  public.visible_events(), '1,3,9');
RESET ROLE;
DELETE FROM public.org_members WHERE user_id = :SC AND org_id = :L;
SET ROLE authenticated;
SELECT public.as_user(:SC);
SELECT public.check_eq('a removed member reads nothing', public.visible_events(), '');
RESET ROLE;

-- ── Append-only through the API roles ───────────────────────────────────

SET ROLE authenticated;
SELECT public.as_user(:O);
SELECT public.check_raises('the owner cannot update an event through PostgREST',
  $$UPDATE public.activity_events SET visibility = 'artist'$$, 'permission denied');
SELECT public.check_raises('… nor delete one',
  $$DELETE FROM public.activity_events$$, 'permission denied');
SELECT public.check_raises('… nor insert one',
  $$INSERT INTO public.activity_events (org_id, verb) VALUES ('b1470000-0000-4000-8000-000000000001', 'song.created')$$,
  'row-level security');
RESET ROLE;

-- ── user_profiles.last_seen_overview_at ─────────────────────────────────
-- Written by the service role only (the route), for the session's own user.

INSERT INTO public.user_profiles (user_id, display_name) VALUES (:O, 'Owner'), (:AR, 'Ana'), (:X, 'Xen'), (:OUT, 'Out');
UPDATE public.user_profiles SET last_seen_overview_at = '2026-10-01T00:00:00Z' WHERE user_id IN (:O, :X);

SET ROLE authenticated;
SELECT public.as_user(:O);
SELECT public.check_eq('a member cannot write it for themself through PostgREST (no write policy)',
  public.rows_changed($$UPDATE public.user_profiles SET last_seen_overview_at = now() WHERE user_id = 'a1470000-0000-4000-8000-000000000001'$$), 0);
SELECT public.check_eq('… nor for anyone else',
  public.rows_changed($$UPDATE public.user_profiles SET last_seen_overview_at = now() WHERE user_id = 'a1470000-0000-4000-8000-000000000002'$$), 0);
SELECT public.check_raises('… nor insert a row',
  $$INSERT INTO public.user_profiles (user_id, last_seen_overview_at) VALUES ('a1470000-0000-4000-8000-000000000006', now())$$,
  'row-level security|duplicate key');
SELECT public.check_eq('who can read it is what 136 allowed: the owner reads their own and co-member Ana''s, not L2''s owner''s or an outsider''s',
  (SELECT string_agg(display_name, ',' ORDER BY display_name) FROM public.user_profiles), 'Ana,Owner');
SELECT public.as_user(:OUT);
SELECT public.check_eq('an outsider reads only their own row',
  (SELECT string_agg(display_name, ',') FROM public.user_profiles), 'Out');
RESET ROLE;
SELECT public.check_eq('none of that changed the stored value',
  (SELECT last_seen_overview_at FROM public.user_profiles WHERE user_id = :O), '2026-10-01T00:00:00Z'::timestamptz);

-- The service role (the route) moves it forward, monotonically.
SET ROLE service_role;
INSERT INTO public.user_profiles (user_id, last_seen_overview_at) VALUES (:AR, '2026-10-02T00:00:00Z')
  ON CONFLICT (user_id) DO UPDATE SET last_seen_overview_at = GREATEST(public.user_profiles.last_seen_overview_at, EXCLUDED.last_seen_overview_at);
SELECT public.check_eq('the route''s upsert sets it', (SELECT last_seen_overview_at FROM public.user_profiles WHERE user_id = 'a1470000-0000-4000-8000-000000000002'), '2026-10-02T00:00:00Z'::timestamptz);
INSERT INTO public.user_profiles (user_id, last_seen_overview_at) VALUES (:AR, '2026-09-01T00:00:00Z')
  ON CONFLICT (user_id) DO UPDATE SET last_seen_overview_at = GREATEST(public.user_profiles.last_seen_overview_at, EXCLUDED.last_seen_overview_at);
SELECT public.check_eq('… and never moves it back', (SELECT last_seen_overview_at FROM public.user_profiles WHERE user_id = 'a1470000-0000-4000-8000-000000000002'), '2026-10-02T00:00:00Z'::timestamptz);
RESET ROLE;
