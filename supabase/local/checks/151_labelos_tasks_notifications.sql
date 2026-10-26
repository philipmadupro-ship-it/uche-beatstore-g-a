-- Behaviour checks for 151_labelos_tasks_notifications.sql (LABEL-23), run by
-- scripts/local-db/check.sh (npm run db:local:check) in its own copy of the
-- throwaway database. Every check RAISEs on failure; psql stops at the first.
--
-- What is proven, as `authenticated` with each member's own JWT claims (the
-- way PostgREST reads) — never only as the service role:
--   - tasks: at most one object (CHECK), the object and the assignee belong
--     to the task's org (integrity trigger), the org never changes;
--   - a task is read by its creator, its assignee and the org's owner/admin,
--     and by nobody else: a whole-org A&R who neither made nor holds it
--     reads nothing, another org and an external project member read nothing;
--   - an artists-scoped member reads a task on an object only while their
--     scope reaches it (artist / project / song / release), and tasks with
--     no object stay theirs;
--   - nothing writes tasks through the API roles;
--   - notifications: producer rows (org_id NULL) behave exactly as before —
--     the owner policy, a user's own rows, writable by the user; org rows are
--     readable only by their recipient while still a member, and never
--     writable through the API roles; another user never reads them.
--   - the tasks policy calls no per-row SECURITY DEFINER helper (R-08).
--
-- Cast (seed: producer P):
--   label L : owner O; AR (A&R, whole org); SC (A&R scoped to artist C2);
--             ART (roster artist C1 Nova); ART2 (roster artist C2 Kilo);
--             MK (marketing, whole org)
--   label L2: owner X.   OUT is a member of nothing.   EXT: external editor on LP1.
--   L : LP1 = Nova's project, LP2 = Kilo's Inbox. Songs S1 in LP1, S2 in LP2.
--       REL1 on LP1, REL2 on LP2.
--   L2: XS1 in XP1.

\set P    '''0b0e1a57-0000-4000-8000-000000000001'''
\set O    '''a1510000-0000-4000-8000-000000000001'''
\set AR   '''a1510000-0000-4000-8000-000000000002'''
\set SC   '''a1510000-0000-4000-8000-000000000003'''
\set ART  '''a1510000-0000-4000-8000-000000000004'''
\set ART2 '''a1510000-0000-4000-8000-000000000005'''
\set X    '''a1510000-0000-4000-8000-000000000006'''
\set OUT  '''a1510000-0000-4000-8000-000000000007'''
\set MK   '''a1510000-0000-4000-8000-000000000008'''
\set EXT  '''a1510000-0000-4000-8000-000000000009'''
\set L    '''b1510000-0000-4000-8000-000000000001'''
\set L2   '''b1510000-0000-4000-8000-000000000002'''
\set C1   '''c1510000-0000-4000-8000-0000000000c1'''
\set C2   '''c1510000-0000-4000-8000-0000000000c2'''
\set CX   '''c1510000-0000-4000-8000-0000000000c3'''
\set LP1  '''d1510000-0000-4000-8000-000000000011'''
\set LP2  '''d1510000-0000-4000-8000-000000000012'''
\set XP1  '''d1510000-0000-4000-8000-000000000021'''
\set S1   '''e1510000-0000-4000-8000-000000000001'''
\set S2   '''e1510000-0000-4000-8000-000000000002'''
\set XS1  '''e1510000-0000-4000-8000-000000000004'''
\set PS1  '''e1510000-0000-4000-8000-000000000006'''
\set REL1 '''f1510000-0000-4000-8000-000000000001'''
\set REL2 '''f1510000-0000-4000-8000-000000000002'''

INSERT INTO auth.users (id, email) VALUES
  (:O, 'o151@local.test'), (:AR, 'ar151@local.test'), (:SC, 'sc151@local.test'),
  (:ART, 'art151@local.test'), (:ART2, 'art2151@local.test'), (:MK, 'mk151@local.test'),
  (:EXT, 'ext151@local.test'), (:X, 'x151@local.test'), (:OUT, 'out151@local.test');
INSERT INTO public.organizations (id, name, slug, kind, created_by) VALUES
  (:L, 'Label L', 'label-l-151', 'label', :O),
  (:L2, 'Label L2', 'label-l2-151', 'label', :X);
INSERT INTO public.org_members (org_id, user_id, role, functions, scope) VALUES
  (:L, :O, 'owner', '{}', 'org'),
  (:L, :AR, 'member', '{a_and_r}', 'org'),
  (:L, :SC, 'member', '{a_and_r}', 'artists'),
  (:L, :ART, 'artist', '{}', 'artists'),
  (:L, :ART2, 'artist', '{}', 'artists'),
  (:L, :MK, 'member', '{marketing}', 'org'),
  (:L2, :X, 'owner', '{}', 'org');
INSERT INTO public.contacts (id, user_id, org_id, name, email, category) VALUES
  (:C1, NULL, :L, 'Nova', 'nova151@local.test', 'artist'),
  (:C2, NULL, :L, 'Kilo', 'kilo151@local.test', 'artist'),
  (:CX, NULL, :L2, 'Xen', 'xen151@local.test', 'artist');
INSERT INTO public.member_artist_scopes (org_id, user_id, contact_id) VALUES
  (:L, :SC, :C2), (:L, :ART, :C1), (:L, :ART2, :C2);
INSERT INTO public.projects (id, user_id, org_id, name, inbox_for_contact_id) VALUES
  (:LP1, NULL, :L, 'Nova EP', NULL),
  (:LP2, NULL, :L, 'Inbox · Kilo', :C2),
  (:XP1, NULL, :L2, 'L2 project', NULL);
INSERT INTO public.project_contacts (user_id, project_id, contact_id, role) VALUES (NULL, :LP1, :C1, 'artist');
INSERT INTO public.project_members (org_id, project_id, user_id, role, allow_downloads, invited_by) VALUES
  (:L, :LP1, :EXT, 'editor', true, :O);
INSERT INTO public.tracks (id, user_id, org_id, created_by, title, type, audio_url, song_stage) VALUES
  (:S1, NULL, :L, :AR, 'Nova demo', 'song', 'r2://private/orgs/l/s1', 'in_review'),
  (:S2, NULL, :L, :AR, 'Kilo demo', 'song', 'r2://private/orgs/l/s2', 'inbox'),
  (:XS1, NULL, :L2, :X, 'L2 demo', 'song', 'r2://private/orgs/l2/s1', 'inbox');
INSERT INTO public.tracks (id, user_id, title, type, audio_url) VALUES (:PS1, :P, 'P song', 'song', 'r2://private/p1');
INSERT INTO public.project_tracks (project_id, track_id, position) VALUES (:LP1, :S1, 0), (:LP2, :S2, 0), (:XP1, :XS1, 0);
INSERT INTO public.releases (id, org_id, project_id, contact_id, title) VALUES
  (:REL1, :L, :LP1, :C1, 'Nova single'), (:REL2, :L, :LP2, :C2, 'Kilo single');

CREATE TABLE public.chk_lbl (id uuid PRIMARY KEY, name text NOT NULL);
GRANT SELECT ON public.chk_lbl TO anon, authenticated, service_role;
INSERT INTO public.chk_lbl VALUES (:O, 'O'), (:AR, 'AR'), (:SC, 'SC'), (:ART, 'ART'), (:MK, 'MK');

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
-- The task titles the caller reads, sorted.
CREATE FUNCTION public.visible_tasks() RETURNS text
LANGUAGE sql AS $$
  SELECT coalesce(string_agg(title, ',' ORDER BY title), '') FROM public.tasks
$$;
-- The notification titles the caller reads, sorted.
CREATE FUNCTION public.visible_notifs() RETURNS text
LANGUAGE sql AS $$
  SELECT coalesce(string_agg(title, ',' ORDER BY title), '') FROM public.notifications
$$;
GRANT EXECUTE ON FUNCTION public.check_eq(text, anyelement, anyelement), public.check_raises(text, text, text),
  public.rows_changed(text), public.as_user(text), public.visible_tasks(), public.visible_notifs()
  TO anon, authenticated, service_role;

-- ── Schema ──────────────────────────────────────────────────────────────

SELECT public.check_eq('RLS is on for tasks',
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.tasks'::regclass), true);
SELECT public.check_eq('tasks has one policy, a SELECT — nothing writes through the API roles',
  (SELECT string_agg(policyname || '=' || permissive || '/' || cmd, ' ') FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tasks'),
  'tasks_member_read=PERMISSIVE/SELECT');
SELECT public.check_eq('no user_id column: a task is an org row',
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'user_id'), 0::bigint);
SELECT public.check_eq('the policy calls no per-row SECURITY DEFINER helper (R-08)',
  (SELECT qual !~ 'can_see_org_project' AND qual !~ 'can_see_org_track' AND qual !~ 'can_see_artist'
          AND qual !~ 'has_org_cap' AND qual ~ 'labelos_scoped_projects' AND qual ~ 'labelos_scoped_tracks' AND qual ~ 'labelos_scoped_releases'
   FROM pg_policies WHERE tablename = 'tasks'), true);
SELECT public.check_eq('notifications.org_id exists and is nullable',
  (SELECT is_nullable FROM information_schema.columns WHERE table_name = 'notifications' AND column_name = 'org_id'), 'YES');
SELECT public.check_eq('notifications keeps its owner policy and gains one RESTRICTIVE SELECT policy',
  (SELECT string_agg(policyname || '=' || permissive || '/' || cmd, ' ' ORDER BY policyname) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notifications'),
  'notifications_org_member_only=RESTRICTIVE/SELECT owner=PERMISSIVE/ALL');

-- ── Writes (as the service role: what /api/org does) ─────────────────────
-- AR made t_ar_artist (on Nova) for MK; MK made t_mk_song (on S1) for AR;
-- O made t_org_wide for AR; SC made t_sc_kilo (on Kilo) and holds t_kilo_rel
-- (on REL2) from AR; AR made t_ar_p1 on project LP1 for SC (SC cannot reach it).

INSERT INTO public.tasks (org_id, title, assignee_id, created_by, artist_id) VALUES (:L, 't_ar_artist', :MK, :AR, :C1);
INSERT INTO public.tasks (org_id, title, assignee_id, created_by, song_id) VALUES (:L, 't_mk_song', :AR, :MK, :S1);
INSERT INTO public.tasks (org_id, title, assignee_id, created_by) VALUES (:L, 't_org_wide', :AR, :O);
INSERT INTO public.tasks (org_id, title, assignee_id, created_by, artist_id) VALUES (:L, 't_sc_kilo', :SC, :SC, :C2);
INSERT INTO public.tasks (org_id, title, assignee_id, created_by, release_id) VALUES (:L, 't_kilo_rel', :SC, :AR, :REL2);
INSERT INTO public.tasks (org_id, title, assignee_id, created_by, project_id) VALUES (:L, 't_ar_p1', :SC, :AR, :LP1);
INSERT INTO public.tasks (org_id, title, assignee_id, created_by, song_id) VALUES (:L, 't_art_nova_song', :ART, :AR, :S1);
INSERT INTO public.tasks (org_id, title, assignee_id, created_by) VALUES (:L, 't_unassigned', NULL, :AR);
INSERT INTO public.tasks (org_id, title, assignee_id, created_by) VALUES (:L2, 't_x', :X, :X);

-- ── Integrity ───────────────────────────────────────────────────────────

SELECT public.check_raises('a task has at most one object',
  $$INSERT INTO public.tasks (org_id, title, artist_id, project_id) VALUES ('b1510000-0000-4000-8000-000000000001', 'two', 'c1510000-0000-4000-8000-0000000000c1', 'd1510000-0000-4000-8000-000000000011')$$,
  'tasks_one_object');
SELECT public.check_raises('an empty title is refused',
  $$INSERT INTO public.tasks (org_id, title) VALUES ('b1510000-0000-4000-8000-000000000001', '   ')$$, 'tasks_title_check');
SELECT public.check_raises('an artist of another org is refused',
  $$INSERT INTO public.tasks (org_id, title, artist_id) VALUES ('b1510000-0000-4000-8000-000000000001', 'x', 'c1510000-0000-4000-8000-0000000000c3')$$, 'same organization');
SELECT public.check_raises('a project of another org is refused',
  $$INSERT INTO public.tasks (org_id, title, project_id) VALUES ('b1510000-0000-4000-8000-000000000001', 'x', 'd1510000-0000-4000-8000-000000000021')$$, 'same organization');
SELECT public.check_raises('a song of another org is refused',
  $$INSERT INTO public.tasks (org_id, title, song_id) VALUES ('b1510000-0000-4000-8000-000000000001', 'x', 'e1510000-0000-4000-8000-000000000004')$$, 'same organization');
SELECT public.check_raises('a producer song is refused',
  $$INSERT INTO public.tasks (org_id, title, song_id) VALUES ('b1510000-0000-4000-8000-000000000001', 'x', 'e1510000-0000-4000-8000-000000000006')$$, 'same organization');
SELECT public.check_raises('a release of another org is refused (no such release in L2: any L release under L2)',
  $$INSERT INTO public.tasks (org_id, title, release_id) VALUES ('b1510000-0000-4000-8000-000000000002', 'x', 'f1510000-0000-4000-8000-000000000001')$$, 'same organization');
SELECT public.check_raises('an assignee outside the org is refused',
  $$INSERT INTO public.tasks (org_id, title, assignee_id) VALUES ('b1510000-0000-4000-8000-000000000001', 'x', 'a1510000-0000-4000-8000-000000000006')$$, 'assignee must be a member');
SELECT public.check_raises('an external project member cannot be assigned an org task',
  $$INSERT INTO public.tasks (org_id, title, assignee_id) VALUES ('b1510000-0000-4000-8000-000000000001', 'x', 'a1510000-0000-4000-8000-000000000009')$$, 'assignee must be a member');
SELECT public.check_raises('a task keeps its org',
  $$UPDATE public.tasks SET org_id = 'b1510000-0000-4000-8000-000000000001' WHERE title = 't_x'$$, 'keeps its organization|same organization');

-- ── Reads, as members, with their own claims ────────────────────────────

SET ROLE authenticated;

SELECT public.as_user(:O);
SELECT public.check_eq('owner (holds everything, whole org): every task of L, none of L2''s',
  public.visible_tasks(), 't_ar_artist,t_ar_p1,t_art_nova_song,t_kilo_rel,t_mk_song,t_org_wide,t_sc_kilo,t_unassigned');

SELECT public.as_user(:AR);
SELECT public.check_eq('A&R (whole org): the tasks they made or hold — not the ones MK/SC/O made for others',
  public.visible_tasks(), 't_ar_artist,t_ar_p1,t_art_nova_song,t_kilo_rel,t_mk_song,t_org_wide,t_unassigned');
SELECT public.check_eq('… and not t_sc_kilo (SC made it for themself)',
  (SELECT count(*) FROM public.tasks WHERE title = 't_sc_kilo'), 0::bigint);

SELECT public.as_user(:MK);
SELECT public.check_eq('marketing (whole org): the task they made and the one given to them',
  public.visible_tasks(), 't_ar_artist,t_mk_song');

SELECT public.as_user(:SC);
SELECT public.check_eq('A&R scoped to Kilo: their own tasks on Kilo''s artist and release; NOT the one on Nova''s project though it is assigned to them',
  public.visible_tasks(), 't_kilo_rel,t_sc_kilo');

SELECT public.as_user(:ART);
SELECT public.check_eq('roster artist Nova, assigned a task on her song: sees it, and nothing else',
  public.visible_tasks(), 't_art_nova_song');

SELECT public.as_user(:ART2);
SELECT public.check_eq('another artist of the label: no task is theirs', public.visible_tasks(), '');

SELECT public.as_user(:EXT);
SELECT public.check_eq('an external project member (editor on LP1, no org membership) reads no task', public.visible_tasks(), '');

SELECT public.as_user(:X);
SELECT public.check_eq('L2''s owner: only L2''s task', public.visible_tasks(), 't_x');
SELECT public.as_user(:OUT);
SELECT public.check_eq('a user in no org: nothing', public.visible_tasks(), '');
SELECT public.as_user(:P);
SELECT public.check_eq('the producer, member of neither: nothing', public.visible_tasks(), '');

-- Nothing writes through the API roles.
SELECT public.as_user(:AR);
SELECT public.check_raises('a member cannot insert a task through the API roles',
  $$INSERT INTO public.tasks (org_id, title, created_by) VALUES ('b1510000-0000-4000-8000-000000000001', 'sneaky', 'a1510000-0000-4000-8000-000000000002')$$,
  'written through /api/org only|row-level security|permission denied');
SELECT public.check_eq('… nor update their own', public.rows_changed($$UPDATE public.tasks SET title = 'x' WHERE created_by = 'a1510000-0000-4000-8000-000000000002'$$), 0);
SELECT public.check_eq('… nor delete one', public.rows_changed($$DELETE FROM public.tasks WHERE created_by = 'a1510000-0000-4000-8000-000000000002'$$), 0);
RESET ROLE;

SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
SELECT public.check_eq('anon: no task, and no permission error', public.visible_tasks(), '');
RESET ROLE;

SELECT public.check_eq('the failed writes changed nothing', (SELECT count(*) FROM public.tasks), 9::bigint);

-- A member who leaves loses the tasks at once; their old tasks stay editable by the service role.
DELETE FROM public.org_members WHERE org_id = :L AND user_id = :MK;
SET ROLE authenticated;
SELECT public.as_user(:MK);
SELECT public.check_eq('a removed member reads none of the org''s tasks (even ones they made)', public.visible_tasks(), '');
RESET ROLE;
UPDATE public.tasks SET done_at = now() WHERE title = 't_mk_song';
SELECT public.check_eq('… and the service role can still update a task whose assignee left',
  (SELECT count(*) FROM public.tasks WHERE title = 't_mk_song' AND done_at IS NOT NULL), 1::bigint);

-- ── Notifications ───────────────────────────────────────────────────────
-- Producer rows (no org_id): the producer's own, writable by them as before.
-- Org rows: AR was assigned t_mk_song and the org-wide one; ART2 was told
-- about something in L2 by mistake (must not read it as a non-member).

INSERT INTO public.notifications (user_id, kind, title) VALUES (:P, 'purchase', 'n_purchase');
INSERT INTO public.notifications (user_id, org_id, kind, title) VALUES
  (:AR, :L, 'task_assigned', 'n_ar_task'),
  (:AR, :L2, 'task_assigned', 'n_ar_in_l2'),
  (:SC, :L, 'task_assigned', 'n_sc_task'),
  (:X,  :L2, 'task_assigned', 'n_x_task');

SET ROLE authenticated;
SELECT public.as_user(:P);
SELECT public.check_eq('producer: reads its own producer notification exactly as before', public.visible_notifs(), 'n_purchase');
SELECT public.check_eq('producer: can still insert and mark read its own producer notifications',
  public.rows_changed($$INSERT INTO public.notifications (user_id, kind, title) VALUES ('0b0e1a57-0000-4000-8000-000000000001', 'purchase', 'n_two')$$), 1);
SELECT public.check_eq('… and update them',
  public.rows_changed($$UPDATE public.notifications SET read = true WHERE title = 'n_two'$$), 1);
SELECT public.check_eq('… and delete them',
  public.rows_changed($$DELETE FROM public.notifications WHERE title = 'n_two'$$), 1);

SELECT public.as_user(:AR);
SELECT public.check_eq('A&R: only their own org notification of an org they are IN (L), not the one stamped L2 (not a member)',
  public.visible_notifs(), 'n_ar_task');
SELECT public.as_user(:SC);
SELECT public.check_eq('SC reads their own, never AR''s', public.visible_notifs(), 'n_sc_task');
SELECT public.as_user(:O);
SELECT public.check_eq('the owner receives nothing they were not addressed', public.visible_notifs(), '');
SELECT public.as_user(:X);
SELECT public.check_eq('L2 owner: their own', public.visible_notifs(), 'n_x_task');

-- Nothing forges or edits an org notification through the API roles.
SELECT public.as_user(:AR);
SELECT public.check_raises('a member cannot insert an org notification for themself',
  $$INSERT INTO public.notifications (user_id, org_id, kind, title) VALUES ('a1510000-0000-4000-8000-000000000002', 'b1510000-0000-4000-8000-000000000001', 'task_assigned', 'forged')$$,
  'written through /api/org only');
SELECT public.check_raises('… nor mark one read through PostgREST (reading goes through the route)',
  $$UPDATE public.notifications SET read = true WHERE title = 'n_ar_task'$$, 'written through /api/org only');
SELECT public.check_raises('… nor delete one',
  $$DELETE FROM public.notifications WHERE title = 'n_ar_task'$$, 'written through /api/org only');
RESET ROLE;

-- Leaving the org ends reading the org's notifications.
DELETE FROM public.org_members WHERE org_id = :L AND user_id = :SC;
SET ROLE authenticated;
SELECT public.as_user(:SC);
SELECT public.check_eq('a removed member no longer reads the org''s notifications addressed to them', public.visible_notifs(), '');
RESET ROLE;

SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
SELECT public.check_eq('anon: no notification, no error', public.visible_notifs(), '');
RESET ROLE;

-- ── R-08: the tasks policy plans as hashed subplans, not per-row calls ──

CREATE FUNCTION public.plan_filters(q text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE r text; filters text := '';
BEGIN
  FOR r IN EXECUTE 'EXPLAIN (COSTS OFF) ' || q LOOP
    -- Only the scan of the table itself (the first Filter): the lines below it
    -- belong to the subplans' own scans (org_members under its own policy).
    IF r ~ 'Filter:' THEN filters := r; EXIT; END IF;
  END LOOP;
  RETURN filters;
END $$;
GRANT EXECUTE ON FUNCTION public.plan_filters(text) TO authenticated;

SET ROLE authenticated;
SELECT public.as_user(:AR);
SELECT public.check_eq('the tasks read plans its membership and scope tests as hashed subplans',
  public.plan_filters('SELECT * FROM public.tasks') ~ 'hashed SubPlan', true);
SELECT public.check_eq('… and no correlated (per-row) SubPlan or SECURITY DEFINER call remains in the filter',
  public.plan_filters('SELECT * FROM public.tasks') ~ '(?<!hashed )SubPlan|can_see_org_|has_org_cap|can_see_artist', false);
RESET ROLE;

-- ── Cascades ────────────────────────────────────────────────────────────

DELETE FROM public.tracks WHERE id = :S1;
SELECT public.check_eq('deleting a song deletes its tasks',
  (SELECT count(*) FROM public.tasks WHERE title IN ('t_mk_song', 't_art_nova_song')), 0::bigint);
DELETE FROM public.organizations WHERE id = :L2;
SELECT public.check_eq('deleting an org deletes its tasks and org notifications',
  (SELECT count(*) FROM public.tasks WHERE title = 't_x') + (SELECT count(*) FROM public.notifications WHERE title IN ('n_x_task', 'n_ar_in_l2')), 0::bigint);
