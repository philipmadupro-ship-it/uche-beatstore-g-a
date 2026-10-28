-- Behaviour check for LABEL-39 (org export, deletion and event retention).
-- It belongs to no migration — LABEL-39 adds none — and runs like the others
-- under scripts/local-db/check.sh, in its own copy of the throwaway database.
-- Every check RAISEs on failure; psql stops at the first.
--
-- What it proves about the purge cron's one statement,
-- `DELETE FROM organizations WHERE id = <org>` (lib/labelos/org-lifecycle-store
-- #purgeOrg), against the REAL schema:
--   1. no row of the org is left, in ANY table that carries an org_id and in
--      the tables that hang from the org's projects, songs and contacts;
--   2. audit events were there until that moment, and go with the org;
--   3. a second org's rows, the producer's rows, the producer's own `producer`
--      org and the people (auth.users) are exactly as they were;
--   4. a soft-deleted org is gone for every member under RLS, its rows and
--      audit events are still there, and restoring brings it back;
--   5. only the service role can prune activity_events (retention, D9);
--      members cannot.
--
-- Cast (seed: producer P with a creator_profiles row):
--   label L : owner O, member M, external editor E on LP1, roster artist C1
--   label L2: owner X
--   P owns a producer-kind org PO and an ordinary catalogue (org_id NULL).

\set P   '''0b0e1a57-0000-4000-8000-000000000001'''
\set O   '''a3900000-0000-4000-8000-000000000001'''
\set M   '''a3900000-0000-4000-8000-000000000002'''
\set E   '''a3900000-0000-4000-8000-000000000003'''
\set X   '''a3900000-0000-4000-8000-000000000004'''
\set L   '''b3900000-0000-4000-8000-000000000001'''
\set L2  '''b3900000-0000-4000-8000-000000000002'''
\set PO  '''b3900000-0000-4000-8000-000000000003'''
\set C1  '''c3900000-0000-4000-8000-0000000000c1'''
\set CX  '''c3900000-0000-4000-8000-0000000000c2'''
\set CP  '''c3900000-0000-4000-8000-0000000000c3'''
\set LP1 '''d3900000-0000-4000-8000-000000000011'''
\set LP2 '''d3900000-0000-4000-8000-000000000012'''
\set XP1 '''d3900000-0000-4000-8000-000000000021'''
\set PP1 '''d3900000-0000-4000-8000-000000000031'''
\set S1  '''e3900000-0000-4000-8000-000000000001'''
\set S2  '''e3900000-0000-4000-8000-000000000002'''
\set XS1 '''e3900000-0000-4000-8000-000000000011'''
\set XS2 '''e3900000-0000-4000-8000-000000000012'''
\set PT1 '''e3900000-0000-4000-8000-000000000021'''
\set PT2 '''e3900000-0000-4000-8000-000000000022'''
\set REL '''f3900000-0000-4000-8000-000000000001'''
\set XREL '''f3900000-0000-4000-8000-000000000002'''

INSERT INTO auth.users (id, email) VALUES
  (:O, 'o390@local.test'), (:M, 'm390@local.test'), (:E, 'e390@local.test'), (:X, 'x390@local.test');
INSERT INTO public.organizations (id, name, slug, kind, created_by) VALUES
  (:L, 'Label L', 'label-l-390', 'label', :O),
  (:L2, 'Label L2', 'label-l2-390', 'label', :X),
  (:PO, 'Producer studio', 'studio-390', 'producer', :P);
INSERT INTO public.org_members (org_id, user_id, role, functions, scope) VALUES
  (:L, :O, 'owner', '{}', 'org'),
  (:L, :M, 'member', '{a_and_r}', 'org'),
  (:L2, :X, 'owner', '{}', 'org'),
  (:PO, :P, 'owner', '{}', 'org');
INSERT INTO public.org_invitations (org_id, email, role, token_hash, expires_at, invited_by) VALUES
  (:L, 'new390@local.test', 'member', 'hash-l', now() + interval '7 days', :O),
  (:L2, 'new2390@local.test', 'member', 'hash-l2', now() + interval '7 days', :X);

INSERT INTO public.contacts (id, user_id, org_id, name, email, category) VALUES
  (:C1, NULL, :L, 'Nova', 'nova390@local.test', 'artist'),
  (:CX, NULL, :L2, 'Xen', 'xen390@local.test', 'artist');
INSERT INTO public.contacts (id, user_id, name, email) VALUES (:CP, :P, 'Producer contact', 'pc390@local.test');
INSERT INTO public.member_artist_scopes (org_id, user_id, contact_id) VALUES (:L, :M, :C1);

INSERT INTO public.projects (id, user_id, org_id, name) VALUES
  (:LP1, NULL, :L, 'Nova EP'), (:LP2, NULL, :L, 'Second'), (:XP1, NULL, :L2, 'L2 EP');
INSERT INTO public.projects (id, user_id, name) VALUES (:PP1, :P, 'Producer project');
INSERT INTO public.project_contacts (user_id, project_id, contact_id, role) VALUES (NULL, :LP1, :C1, 'artist');
INSERT INTO public.project_members (org_id, project_id, user_id, role, allow_downloads, invited_by) VALUES
  (:L, :LP1, :E, 'editor', true, :O);

INSERT INTO public.tracks (id, user_id, org_id, created_by, title, type, audio_url, song_stage) VALUES
  (:S1, NULL, :L, :O, 'Nova demo', 'song', 'r2://private/orgs/l/s1', 'in_review'),
  (:S2, NULL, :L, :O, 'Nova master', 'song', 'r2://private/orgs/l/s2', 'inbox'),
  (:XS1, NULL, :L2, :X, 'L2 demo', 'song', 'r2://private/orgs/l2/s1', 'inbox'),
  (:XS2, NULL, :L2, :X, 'L2 master', 'song', 'r2://private/orgs/l2/s2', 'inbox');
INSERT INTO public.tracks (id, user_id, title, type, audio_url) VALUES
  (:PT1, :P, 'P beat', 'beat', 'r2://private/p1'), (:PT2, :P, 'P other beat', 'beat', 'r2://private/p2');
INSERT INTO public.project_tracks (project_id, track_id, position) VALUES
  (:LP1, :S1, 0), (:LP1, :S2, 1), (:XP1, :XS1, 0), (:PP1, :PT1, 0);
INSERT INTO public.track_links (from_track_id, to_track_id, user_id, relation) VALUES
  (:S1, :S2, NULL, 'master'), (:XS1, :XS2, NULL, 'version');
INSERT INTO public.track_links (from_track_id, to_track_id, user_id, relation) VALUES (:PT1, :PT2, :P, 'loop');
INSERT INTO public.track_tags (track_id, tag) VALUES (:S1, 'dark'), (:XS1, 'bright'), (:PT1, 'trap');
INSERT INTO public.stems (track_id) VALUES (:S1), (:XS1), (:PT1);
INSERT INTO public.song_reviews (org_id, track_id, reviewer_id, rating, verdict) VALUES
  (:L, :S1, :M, 4, 'shortlist'), (:L2, :XS1, :X, 3, 'hold');

INSERT INTO public.project_assets (user_id, created_by, project_id, kind, sensitivity, url) VALUES
  (NULL, :O, :LP1, 'artwork', 'normal', 'r2://private/orgs/l/assets/a'),
  (NULL, :X, :XP1, 'artwork', 'normal', 'r2://private/orgs/l2/assets/a');
INSERT INTO public.project_assets (user_id, project_id, kind, url) VALUES (:P, :PP1, 'lyrics', 'r2://private/project-assets/p');
INSERT INTO public.project_comments (project_id, track_id, user_id, author_name, body) VALUES
  (:LP1, :S1, :O, 'Owner', 'org note'), (:XP1, :XS1, :X, 'X', 'l2 note'), (:PP1, :PT1, :P, 'P', 'producer note');

-- Releases hang from a project, a contact and a song: the NO ACTION foreign
-- keys (release_items → tracks, releases → projects / contacts) must not stop
-- the cascade that also removes the release itself.
INSERT INTO public.releases (id, org_id, project_id, contact_id, title) VALUES
  (:REL, :L, :LP1, :C1, 'Nova single'), (:XREL, :L2, :XP1, :CX, 'L2 single');
INSERT INTO public.release_items (release_id, org_id, position, song_track_id, master_track_id) VALUES
  (:REL, :L, 1, :S1, :S2), (:XREL, :L2, 1, :XS1, :XS1);
-- LABEL-71: an artist's answer on the listing (NO ACTION toward contacts, so the purge must still go through).
INSERT INTO public.listing_consents (org_id, release_id, artist_contact_id, state, decided_at) VALUES
  (:L, :REL, :C1, 'no', now()), (:L2, :XREL, :CX, 'proposed', NULL);

INSERT INTO public.tasks (org_id, title, assignee_id, created_by, project_id) VALUES
  (:L, 'Clear the sample', :M, :O, :LP1), (:L2, 'L2 task', :X, :X, NULL);
INSERT INTO public.notifications (user_id, org_id, kind, title) VALUES
  (:M, :L, 'task_assigned', 'Assigned'), (:X, :L2, 'task_assigned', 'L2 assigned'), (:P, NULL, 'sale', 'A sale');

-- Events: everyday + audit, old + recent, in both orgs and the producer org.
INSERT INTO public.activity_events (org_id, actor_id, verb, audit, visibility, created_at) VALUES
  (:L, :O, 'org.created', true, 'internal', now() - interval '5 years'),
  (:L, :O, 'member.removed', true, 'internal', now() - interval '30 months'),
  (:L, :O, 'song.created', false, 'artist', now() - interval '30 months'),
  (:L, :O, 'song.created', false, 'artist', now() - interval '1 day'),
  (:L2, :X, 'org.created', true, 'internal', now() - interval '5 years'),
  (:L2, :X, 'song.created', false, 'artist', now() - interval '30 months'),
  (:PO, :P, 'org.created', true, 'internal', now() - interval '5 years');

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
-- How many rows `tbl` holds where `cond` is true (run as whoever the session is).
CREATE FUNCTION public.n(tbl text, cond text DEFAULT 'true') RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE r bigint;
BEGIN
  EXECUTE format('SELECT count(*) FROM %s WHERE %s', tbl, cond) INTO r;
  RETURN r;
END $$;
-- Every row, in every public table that has an org_id column, for one org.
CREATE FUNCTION public.org_rows_anywhere(p_org uuid) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE t record; total bigint := 0; r bigint;
BEGIN
  FOR t IN
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables tb ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name AND tb.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public' AND c.column_name = 'org_id'
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE org_id = $1', t.table_name) INTO r USING p_org;
    total := total + r;
  END LOOP;
  RETURN total;
END $$;
GRANT EXECUTE ON FUNCTION public.check_eq(text, anyelement, anyelement), public.check_raises(text, text, text),
  public.rows_changed(text), public.as_user(text), public.n(text, text), public.org_rows_anywhere(uuid)
  TO anon, authenticated, service_role;
-- The check functions read tables as whoever calls them; the fixtures need the rows visible to each role.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO service_role;

-- ── Before: what the org holds ───────────────────────────────────────────

SELECT public.check_eq('the seed put rows of L in many tables', public.org_rows_anywhere(:L) >= 14, true);
SELECT public.check_eq('L has audit events', public.n('public.activity_events', 'org_id = ' || quote_literal(:L::text) || ' AND audit'), 2::bigint);
SELECT public.check_eq('L has everyday events', public.n('public.activity_events', 'org_id = ' || quote_literal(:L::text) || ' AND NOT audit'), 2::bigint);

-- ── Soft delete (D10): gone for every member, intact underneath ──────────

SELECT public.as_user(:O);
SET ROLE authenticated;
SELECT public.check_eq('the owner reads the org', public.n('public.organizations', 'id = ' || quote_literal(:L::text)), 1::bigint);
SELECT public.check_eq('… and its songs', public.n('public.tracks', 'org_id = ' || quote_literal(:L::text)), 2::bigint);
RESET ROLE;

UPDATE public.organizations SET deleted_at = now() WHERE id = :L;

SELECT public.as_user(:O);
SET ROLE authenticated;
SELECT public.check_eq('a soft-deleted org is invisible to its owner', public.n('public.organizations', 'id = ' || quote_literal(:L::text)), 0::bigint);
SELECT public.check_eq('… and its members list', public.n('public.org_members', 'org_id = ' || quote_literal(:L::text)), 0::bigint);
SELECT public.check_eq('… and its songs', public.n('public.tracks', 'org_id = ' || quote_literal(:L::text)), 0::bigint);
SELECT public.check_eq('… and its audit events', public.n('public.activity_events', 'org_id = ' || quote_literal(:L::text)), 0::bigint);
RESET ROLE;
SELECT public.as_user(:E);
SET ROLE authenticated;
SELECT public.check_eq('… and the external member’s own membership', public.n('public.project_members', 'org_id = ' || quote_literal(:L::text)), 0::bigint);
RESET ROLE;
SELECT public.as_user(:X);
SET ROLE authenticated;
SELECT public.check_eq('another org’s owner still reads their own org', public.n('public.organizations', 'id = ' || quote_literal(:L2::text)), 1::bigint);
RESET ROLE;

SELECT public.check_eq('nothing was deleted by the soft delete', public.org_rows_anywhere(:L) >= 14, true);
SELECT public.check_eq('… audit events included', public.n('public.activity_events', 'org_id = ' || quote_literal(:L::text) || ' AND audit'), 2::bigint);

-- Restore: the grace period's whole point.
UPDATE public.organizations SET deleted_at = NULL WHERE id = :L;
SELECT public.as_user(:O);
SET ROLE authenticated;
SELECT public.check_eq('a restored org is back for its owner', public.n('public.organizations', 'id = ' || quote_literal(:L::text)), 1::bigint);
SELECT public.check_eq('… with its songs', public.n('public.tracks', 'org_id = ' || quote_literal(:L::text)), 2::bigint);
RESET ROLE;

-- ── Retention (D9): only the service role may prune, and what it prunes ──

SELECT public.as_user(:O);
SET ROLE authenticated;
SELECT public.check_raises('a member cannot delete events',
  $$DELETE FROM public.activity_events WHERE org_id = 'b3900000-0000-4000-8000-000000000001'$$, 'permission denied');
RESET ROLE;
SET ROLE service_role;
SELECT public.check_eq('the service role prunes everyday events older than 24 months, in every org',
  public.rows_changed($$DELETE FROM public.activity_events WHERE audit = false AND created_at < now() - interval '24 months'$$), 2);
RESET ROLE;
SELECT public.check_eq('… audit events of any age stay', public.n('public.activity_events', 'audit'), 4::bigint);
SELECT public.check_eq('… and recent everyday events', public.n('public.activity_events', 'NOT audit'), 1::bigint);

-- ── Hard delete: the purge cron's one statement ─────────────────────────

CREATE TABLE public.snap AS
SELECT 'tracks' AS t, (SELECT count(*) FROM public.tracks WHERE org_id IS DISTINCT FROM :L::uuid) AS n
UNION ALL SELECT 'projects', (SELECT count(*) FROM public.projects WHERE org_id IS DISTINCT FROM :L::uuid)
UNION ALL SELECT 'contacts', (SELECT count(*) FROM public.contacts WHERE org_id IS DISTINCT FROM :L::uuid)
UNION ALL SELECT 'project_tracks', (SELECT count(*) FROM public.project_tracks WHERE project_id <> ALL (ARRAY[:LP1, :LP2]::uuid[]))
UNION ALL SELECT 'track_links', (SELECT count(*) FROM public.track_links WHERE from_track_id <> ALL (ARRAY[:S1, :S2]::uuid[]))
UNION ALL SELECT 'track_tags', (SELECT count(*) FROM public.track_tags WHERE track_id <> ALL (ARRAY[:S1, :S2]::uuid[]))
UNION ALL SELECT 'stems', (SELECT count(*) FROM public.stems WHERE track_id <> ALL (ARRAY[:S1, :S2]::uuid[]))
UNION ALL SELECT 'project_assets', (SELECT count(*) FROM public.project_assets WHERE org_id IS DISTINCT FROM :L::uuid)
UNION ALL SELECT 'project_comments', (SELECT count(*) FROM public.project_comments WHERE org_id IS DISTINCT FROM :L::uuid)
UNION ALL SELECT 'releases', (SELECT count(*) FROM public.releases WHERE org_id <> :L::uuid)
UNION ALL SELECT 'release_items', (SELECT count(*) FROM public.release_items WHERE org_id <> :L::uuid)
UNION ALL SELECT 'song_reviews', (SELECT count(*) FROM public.song_reviews WHERE org_id <> :L::uuid)
UNION ALL SELECT 'tasks', (SELECT count(*) FROM public.tasks WHERE org_id <> :L::uuid)
UNION ALL SELECT 'notifications', (SELECT count(*) FROM public.notifications WHERE org_id IS DISTINCT FROM :L::uuid)
UNION ALL SELECT 'activity_events', (SELECT count(*) FROM public.activity_events WHERE org_id <> :L::uuid)
UNION ALL SELECT 'org_members', (SELECT count(*) FROM public.org_members WHERE org_id <> :L::uuid)
UNION ALL SELECT 'org_invitations', (SELECT count(*) FROM public.org_invitations WHERE org_id <> :L::uuid)
UNION ALL SELECT 'organizations', (SELECT count(*) FROM public.organizations WHERE id <> :L::uuid)
UNION ALL SELECT 'users', (SELECT count(*) FROM auth.users);
GRANT SELECT ON public.snap TO service_role;

-- The cron runs as the service role. It is soft-deleted and past its grace
-- period when the cron reaches it (the cron's own WHERE is covered in Vitest).
UPDATE public.organizations SET deleted_at = now() - interval '31 days' WHERE id = :L;
SET ROLE service_role;
SELECT public.check_eq('the cron deletes exactly one organization row',
  public.rows_changed($$DELETE FROM public.organizations WHERE id = 'b3900000-0000-4000-8000-000000000001' AND deleted_at IS NOT NULL AND deleted_at <= now() - interval '30 days'$$), 1);
RESET ROLE;

SELECT public.check_eq('NO row of the org is left, in any table with an org_id', public.org_rows_anywhere(:L), 0::bigint);
SELECT public.check_eq('… none of its audit events', public.n('public.activity_events', 'org_id = ' || quote_literal(:L::text)), 0::bigint);
SELECT public.check_eq('… none of its members', public.n('public.org_members', 'org_id = ' || quote_literal(:L::text)), 0::bigint);
SELECT public.check_eq('… none of its invitations', public.n('public.org_invitations', 'org_id = ' || quote_literal(:L::text)), 0::bigint);
SELECT public.check_eq('… none of its roster scopes', public.n('public.member_artist_scopes', 'org_id = ' || quote_literal(:L::text)), 0::bigint);
SELECT public.check_eq('… none of its external members', public.n('public.project_members', 'project_id = ' || quote_literal(:LP1::text)), 0::bigint);
SELECT public.check_eq('… none of its contacts', public.n('public.contacts', 'id = ' || quote_literal(:C1::text)), 0::bigint);
SELECT public.check_eq('… none of its projects', public.n('public.projects', 'id IN (' || quote_literal(:LP1::text) || ',' || quote_literal(:LP2::text) || ')'), 0::bigint);
SELECT public.check_eq('… none of its songs', public.n('public.tracks', 'id IN (' || quote_literal(:S1::text) || ',' || quote_literal(:S2::text) || ')'), 0::bigint);
SELECT public.check_eq('… nothing that hung from its projects: tracks', public.n('public.project_tracks', 'project_id IN (' || quote_literal(:LP1::text) || ',' || quote_literal(:LP2::text) || ')'), 0::bigint);
SELECT public.check_eq('… project contacts', public.n('public.project_contacts', 'project_id = ' || quote_literal(:LP1::text)), 0::bigint);
SELECT public.check_eq('… files', public.n('public.project_assets', 'project_id = ' || quote_literal(:LP1::text)), 0::bigint);
SELECT public.check_eq('… comments', public.n('public.project_comments', 'project_id = ' || quote_literal(:LP1::text)), 0::bigint);
SELECT public.check_eq('… nothing that hung from its songs: links', public.n('public.track_links', 'from_track_id IN (' || quote_literal(:S1::text) || ',' || quote_literal(:S2::text) || ')'), 0::bigint);
SELECT public.check_eq('… tags', public.n('public.track_tags', 'track_id = ' || quote_literal(:S1::text)), 0::bigint);
SELECT public.check_eq('… stems', public.n('public.stems', 'track_id = ' || quote_literal(:S1::text)), 0::bigint);
SELECT public.check_eq('… artist consents on its releases', public.n('public.listing_consents', 'release_id = ' || quote_literal(:REL::text)), 0::bigint);
SELECT public.check_eq('… releases and their items', public.n('public.releases', 'id = ' || quote_literal(:REL::text)) + public.n('public.release_items', 'release_id = ' || quote_literal(:REL::text)), 0::bigint);
SELECT public.check_eq('… reviews, tasks and notifications', public.n('public.song_reviews', 'track_id = ' || quote_literal(:S1::text)) + public.n('public.tasks', 'title = ''Clear the sample''') + public.n('public.notifications', 'title = ''Assigned'''), 0::bigint);

-- ── …and nothing that is not the org's ──────────────────────────────────

SELECT public.check_eq('another org: still there, every row',
  public.org_rows_anywhere(:L2) >= 10, true);
SELECT public.check_eq('another org: its artist consent survives', public.n('public.listing_consents', 'org_id = ' || quote_literal(:L2::text)), 1::bigint);
SELECT public.check_eq('another org: its audit event survives', public.n('public.activity_events', 'org_id = ' || quote_literal(:L2::text) || ' AND audit'), 1::bigint);
SELECT public.check_eq('another org: its song, tags, links, stems, review, release, comment and file',
  public.n('public.tracks', 'id = ' || quote_literal(:XS1::text))
  + public.n('public.track_tags', 'track_id = ' || quote_literal(:XS1::text))
  + public.n('public.track_links', 'from_track_id = ' || quote_literal(:XS1::text))
  + public.n('public.stems', 'track_id = ' || quote_literal(:XS1::text))
  + public.n('public.song_reviews', 'track_id = ' || quote_literal(:XS1::text))
  + public.n('public.releases', 'id = ' || quote_literal(:XREL::text))
  + public.n('public.project_comments', 'project_id = ' || quote_literal(:XP1::text))
  + public.n('public.project_assets', 'project_id = ' || quote_literal(:XP1::text)), 8::bigint);
SELECT public.check_eq('the producer: catalogue untouched',
  public.n('public.tracks', 'user_id = ' || quote_literal(:P::text)) + public.n('public.projects', 'user_id = ' || quote_literal(:P::text))
  + public.n('public.project_tracks', 'project_id = ' || quote_literal(:PP1::text)) + public.n('public.track_links', 'user_id = ' || quote_literal(:P::text))
  + public.n('public.project_assets', 'user_id = ' || quote_literal(:P::text)) + public.n('public.project_comments', 'project_id = ' || quote_literal(:PP1::text))
  + public.n('public.contacts', 'id = ' || quote_literal(:CP::text)) + public.n('public.notifications', 'user_id = ' || quote_literal(:P::text)), 9::bigint);
SELECT public.check_eq('the producer’s own org and its audit event survive',
  public.n('public.organizations', 'id = ' || quote_literal(:PO::text)) + public.n('public.activity_events', 'org_id = ' || quote_literal(:PO::text)), 2::bigint);
SELECT public.check_eq('people are not deleted with their org', public.n('auth.users', 'id IN (' || quote_literal(:O::text) || ',' || quote_literal(:M::text) || ',' || quote_literal(:E::text) || ')'), 3::bigint);

-- Table by table: everything that did not belong to L has exactly the count it had.
SELECT public.check_eq('tracks outside L', (SELECT count(*) FROM public.tracks WHERE org_id IS DISTINCT FROM :L::uuid), (SELECT n FROM public.snap WHERE t = 'tracks'));
SELECT public.check_eq('projects outside L', (SELECT count(*) FROM public.projects), (SELECT n FROM public.snap WHERE t = 'projects'));
SELECT public.check_eq('contacts outside L', (SELECT count(*) FROM public.contacts), (SELECT n FROM public.snap WHERE t = 'contacts'));
SELECT public.check_eq('project_tracks outside L', (SELECT count(*) FROM public.project_tracks), (SELECT n FROM public.snap WHERE t = 'project_tracks'));
SELECT public.check_eq('track_links outside L', (SELECT count(*) FROM public.track_links), (SELECT n FROM public.snap WHERE t = 'track_links'));
SELECT public.check_eq('track_tags outside L', (SELECT count(*) FROM public.track_tags), (SELECT n FROM public.snap WHERE t = 'track_tags'));
SELECT public.check_eq('stems outside L', (SELECT count(*) FROM public.stems), (SELECT n FROM public.snap WHERE t = 'stems'));
SELECT public.check_eq('project_assets outside L', (SELECT count(*) FROM public.project_assets), (SELECT n FROM public.snap WHERE t = 'project_assets'));
SELECT public.check_eq('project_comments outside L', (SELECT count(*) FROM public.project_comments), (SELECT n FROM public.snap WHERE t = 'project_comments'));
SELECT public.check_eq('releases outside L', (SELECT count(*) FROM public.releases), (SELECT n FROM public.snap WHERE t = 'releases'));
SELECT public.check_eq('release_items outside L', (SELECT count(*) FROM public.release_items), (SELECT n FROM public.snap WHERE t = 'release_items'));
SELECT public.check_eq('song_reviews outside L', (SELECT count(*) FROM public.song_reviews), (SELECT n FROM public.snap WHERE t = 'song_reviews'));
SELECT public.check_eq('tasks outside L', (SELECT count(*) FROM public.tasks), (SELECT n FROM public.snap WHERE t = 'tasks'));
SELECT public.check_eq('notifications outside L', (SELECT count(*) FROM public.notifications), (SELECT n FROM public.snap WHERE t = 'notifications'));
SELECT public.check_eq('activity_events outside L', (SELECT count(*) FROM public.activity_events), (SELECT n FROM public.snap WHERE t = 'activity_events'));
SELECT public.check_eq('org_members outside L', (SELECT count(*) FROM public.org_members), (SELECT n FROM public.snap WHERE t = 'org_members'));
SELECT public.check_eq('org_invitations outside L', (SELECT count(*) FROM public.org_invitations), (SELECT n FROM public.snap WHERE t = 'org_invitations'));
SELECT public.check_eq('organizations outside L', (SELECT count(*) FROM public.organizations), (SELECT n FROM public.snap WHERE t = 'organizations'));
SELECT public.check_eq('auth.users', (SELECT count(*) FROM auth.users), (SELECT n FROM public.snap WHERE t = 'users'));

-- The cron's WHERE keeps a live org and an org still in its grace period.
UPDATE public.organizations SET deleted_at = now() - interval '3 days' WHERE id = :L2;
SET ROLE service_role;
SELECT public.check_eq('an org inside its grace period is not deleted',
  public.rows_changed($$DELETE FROM public.organizations WHERE id = 'b3900000-0000-4000-8000-000000000002' AND deleted_at IS NOT NULL AND deleted_at <= now() - interval '30 days'$$), 0);
RESET ROLE;
UPDATE public.organizations SET deleted_at = NULL WHERE id = :L2;
SET ROLE service_role;
SELECT public.check_eq('a live org is never deleted by the cron’s statement',
  public.rows_changed($$DELETE FROM public.organizations WHERE id = 'b3900000-0000-4000-8000-000000000002' AND deleted_at IS NOT NULL AND deleted_at <= now() - interval '30 days'$$), 0);
RESET ROLE;
SELECT public.check_eq('… so another org is intact', public.n('public.organizations', 'id = ' || quote_literal(:L2::text)), 1::bigint);
