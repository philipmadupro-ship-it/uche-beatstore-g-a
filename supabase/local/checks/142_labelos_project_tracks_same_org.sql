-- Behaviour checks for 142_labelos_project_tracks_same_org.sql, run by
-- scripts/local-db/check.sh (npm run db:local:check) in its own copy of the
-- throwaway database. Every check RAISEs on failure; psql stops at the first.
--
-- Cast (seed: producer P with a creator_profiles row):
--   another producer Q; label L (owner O), label L2 (owner X).
--   P's rows: project PP1, beat PT1, loop PT2 (org_id NULL).
--   Q's rows: project QP1, beat QT1.
--   L's rows: project LP1 (written with P as user_id, as an upload by P
--             would), song LS1 (user_id P), master LM1 (user_id O).
--   L2's rows: project XP1, song XS1.
--
-- The trigger runs for every role (it is a data rule, not a permission), so
-- the org cases are asserted as the service role — the only role 141 lets
-- write an org row — and the producer cases as P through RLS. As P, an org
-- track is refused by 141's service-only trigger first (it sorts before
-- this one), so those two checks accept either message; the service-role
-- block is where this trigger alone decides.

\set P   '''0b0e1a57-0000-4000-8000-000000000001'''
\set O   '''a1420000-0000-4000-8000-000000000001'''
\set X   '''a1420000-0000-4000-8000-000000000002'''
\set Q   '''a1420000-0000-4000-8000-000000000003'''
\set L   '''b1420000-0000-4000-8000-000000000001'''
\set L2  '''b1420000-0000-4000-8000-000000000002'''
\set PP1 '''d1420000-0000-4000-8000-000000000001'''
\set QP1 '''d1420000-0000-4000-8000-000000000002'''
\set LP1 '''d1420000-0000-4000-8000-000000000011'''
\set XP1 '''d1420000-0000-4000-8000-000000000021'''
\set PT1 '''e1420000-0000-4000-8000-000000000001'''
\set PT2 '''e1420000-0000-4000-8000-000000000002'''
\set QT1 '''e1420000-0000-4000-8000-000000000003'''
\set LS1 '''e1420000-0000-4000-8000-000000000011'''
\set LM1 '''e1420000-0000-4000-8000-000000000012'''
\set XS1 '''e1420000-0000-4000-8000-000000000021'''

INSERT INTO auth.users (id, email) VALUES
  (:O, 'o142@local.test'), (:X, 'x142@local.test'), (:Q, 'q142@local.test');
INSERT INTO public.organizations (id, name, slug, kind, created_by) VALUES
  (:L, 'Label L', 'label-l-142', 'label', :O),
  (:L2, 'Label L2', 'label-l2-142', 'label', :X);
INSERT INTO public.org_members (org_id, user_id, role, functions, scope) VALUES
  (:L, :O, 'owner', '{}', 'org'),
  (:L, :P, 'member', '{a_and_r}', 'org'),
  (:L2, :X, 'owner', '{}', 'org');

INSERT INTO public.tracks (id, user_id, title, type, audio_url) VALUES
  (:PT1, :P, 'P beat', 'beat', 'r2://private/p1'),
  (:PT2, :P, 'P loop', 'loop', 'r2://private/p2'),
  (:QT1, :Q, 'Q beat', 'beat', 'r2://private/q1');
INSERT INTO public.projects (id, user_id, name) VALUES (:PP1, :P, 'P project'), (:QP1, :Q, 'Q project');
INSERT INTO public.projects (id, user_id, org_id, name) VALUES
  (:LP1, :P, :L, 'Inbox · Nova'),
  (:XP1, :X, :L2, 'L2 project');
INSERT INTO public.tracks (id, user_id, org_id, created_by, title, type, audio_url, song_stage) VALUES
  (:LS1, :P, :L, :P, 'Nova demo', 'song', 'r2://private/orgs/l/tracks/s1', 'inbox'),
  (:LM1, :O, :L, :O, 'Nova master', 'song', 'r2://private/orgs/l/tracks/m1', NULL),
  (:XS1, :X, :L2, :X, 'L2 song', 'song', 'r2://private/orgs/l2/tracks/s1', 'inbox');

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
CREATE FUNCTION public.check_ok(label text, stmt text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE stmt;
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'CHECK FAILED: % — raised "%"', label, SQLERRM;
END $$;
CREATE FUNCTION public.as_user(p_user text) RETURNS void
LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, false);
$$;
GRANT EXECUTE ON FUNCTION public.check_eq(text, anyelement, anyelement), public.check_raises(text, text, text),
  public.check_ok(text, text), public.as_user(text) TO anon, authenticated, service_role;

SELECT public.check_eq('the trigger fires on insert and on a move, not on a reorder',
  (SELECT string_agg(e.event_manipulation, ',' ORDER BY e.event_manipulation)
   FROM information_schema.triggers e
   WHERE e.event_object_table = 'project_tracks' AND e.trigger_name = 'project_tracks_same_owner'),
  'INSERT,UPDATE');
SELECT public.check_eq('… and an UPDATE only of project_id / track_id',
  (SELECT string_agg(c.event_object_column::text, ',' ORDER BY c.event_object_column)
   FROM information_schema.triggered_update_columns c
   WHERE c.event_object_table = 'project_tracks' AND c.trigger_name = 'project_tracks_same_owner'),
  'project_id,track_id');

-- ── Producer: unchanged for its own rows (through RLS, as the app writes) ──

SET ROLE authenticated;
SELECT public.as_user(:P);
SELECT public.check_ok('the producer adds their own track to their own project',
  $$INSERT INTO public.project_tracks (project_id, track_id, position) VALUES ('d1420000-0000-4000-8000-000000000001', 'e1420000-0000-4000-8000-000000000001', 0)$$);
SELECT public.check_ok('… and reorders it',
  $$UPDATE public.project_tracks SET position = 3, role = 'reference' WHERE project_id = 'd1420000-0000-4000-8000-000000000001'$$);
SELECT public.check_raises('the producer cannot add another producer''s track to their project (different owner, no org)',
  $$INSERT INTO public.project_tracks (project_id, track_id) VALUES ('d1420000-0000-4000-8000-000000000001', 'e1420000-0000-4000-8000-000000000003')$$,
  'same owner or the same organization');
SELECT public.check_raises('… nor an org track carrying their own user_id',
  $$INSERT INTO public.project_tracks (project_id, track_id) VALUES ('d1420000-0000-4000-8000-000000000001', 'e1420000-0000-4000-8000-000000000011')$$,
  'same owner or the same organization|written through /api/org only');
SELECT public.check_raises('… nor move a row onto one',
  $$UPDATE public.project_tracks SET track_id = 'e1420000-0000-4000-8000-000000000011' WHERE project_id = 'd1420000-0000-4000-8000-000000000001'$$,
  'same owner or the same organization|written through /api/org only');
RESET ROLE;

-- ── Org rows: the service role (the /api/org routes) ─────────────────────

SET ROLE service_role;
SELECT public.check_ok('an org song goes into a project of its org',
  $$INSERT INTO public.project_tracks (project_id, track_id, position) VALUES ('d1420000-0000-4000-8000-000000000011', 'e1420000-0000-4000-8000-000000000011', 0)$$);
SELECT public.check_ok('… and so does its master, whoever uploaded either',
  $$INSERT INTO public.project_tracks (project_id, track_id, position) VALUES ('d1420000-0000-4000-8000-000000000011', 'e1420000-0000-4000-8000-000000000012', 1)$$);
SELECT public.check_raises('another org''s song is refused',
  $$INSERT INTO public.project_tracks (project_id, track_id) VALUES ('d1420000-0000-4000-8000-000000000011', 'e1420000-0000-4000-8000-000000000021')$$,
  'same owner or the same organization');
SELECT public.check_raises('a producer track into an org project is refused, even with the same user_id',
  $$INSERT INTO public.project_tracks (project_id, track_id) VALUES ('d1420000-0000-4000-8000-000000000011', 'e1420000-0000-4000-8000-000000000001')$$,
  'same owner or the same organization');
SELECT public.check_raises('an org track into a producer project is refused, even with the same user_id',
  $$INSERT INTO public.project_tracks (project_id, track_id) VALUES ('d1420000-0000-4000-8000-000000000001', 'e1420000-0000-4000-8000-000000000011')$$,
  'same owner or the same organization');
SELECT public.check_raises('different producers, no org: refused for the service role too',
  $$INSERT INTO public.project_tracks (project_id, track_id) VALUES ('d1420000-0000-4000-8000-000000000002', 'e1420000-0000-4000-8000-000000000002')$$,
  'same owner or the same organization');
SELECT public.check_raises('moving an org row into another org''s project is refused',
  $$UPDATE public.project_tracks SET project_id = 'd1420000-0000-4000-8000-000000000021' WHERE track_id = 'e1420000-0000-4000-8000-000000000012'$$,
  'same owner or the same organization');
SELECT public.check_ok('reordering an org row is fine',
  $$UPDATE public.project_tracks SET position = 5 WHERE track_id = 'e1420000-0000-4000-8000-000000000012'$$);
RESET ROLE;

SELECT public.check_eq('exactly the allowed rows exist',
  (SELECT string_agg(t.title || '@' || p.name, ',' ORDER BY t.title)
   FROM public.project_tracks pt JOIN public.tracks t ON t.id = pt.track_id JOIN public.projects p ON p.id = pt.project_id
   WHERE pt.project_id IN (:PP1, :QP1, :LP1, :XP1)),
  'Nova demo@Inbox · Nova,Nova master@Inbox · Nova,P beat@P project');
