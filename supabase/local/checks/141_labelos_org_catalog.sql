-- Behaviour checks for 141_labelos_org_catalog.sql, run by
-- scripts/local-db/check.sh (npm run db:local:check) in its own copy of the
-- throwaway database. Every check RAISEs on failure; psql stops at the first.
--
-- Cast (seed: producer P with a creator_profiles row, buyer B):
--   label L : owner O; AR (A&R, scope org); MKT (marketing: catalog.read +
--             audio.finished, no working audio); SC (A&R, scope artists, sees
--             C1); ART (roster artist, scoped to C1); FIN (finance: no
--             catalog.read)
--   label L2: owner X; P is an A&R member of L2
--   another producer Q owns producer rows of their own (org_id NULL)
--
-- Producer P's rows (org_id NULL): beat PT1, song PT2 (built on PT1), loop
-- PT3, project PP1 (PT1, PT2) for contact PC1, with a portal, a file, a
-- message, a decision, a comment, a link.
--
-- L's rows:
--   LP1 artist C1 (+ C2 featured): S1 song `selected`, S1M its master, S1D
--       its demo; a file of each kind; a comment on S1, one on S1D, one on
--       the project carrying a share token
--   LP2 Inbox of C2: S2 song in `inbox`
--   LP3 no artist: T3 beat (S1 is built on it)
--   T4 a song in no project
-- L2's rows: XP1 with XT1 (a song uploaded by P: created_by P, and — as every
--   org row since 142 — no user_id).

\set P   '''0b0e1a57-0000-4000-8000-000000000001'''
\set B   '''0b0e1a57-0000-4000-8000-0000000000b1'''
\set O   '''a1410000-0000-4000-8000-000000000001'''
\set AR  '''a1410000-0000-4000-8000-000000000002'''
\set MKT '''a1410000-0000-4000-8000-000000000003'''
\set SC  '''a1410000-0000-4000-8000-000000000004'''
\set ART '''a1410000-0000-4000-8000-000000000005'''
\set FIN '''a1410000-0000-4000-8000-000000000006'''
\set X   '''a1410000-0000-4000-8000-000000000007'''
\set Q   '''a1410000-0000-4000-8000-000000000008'''
\set L   '''b1410000-0000-4000-8000-000000000001'''
\set L2  '''b1410000-0000-4000-8000-000000000002'''
\set PC1 '''c1410000-0000-4000-8000-0000000000a1'''
\set QC1 '''c1410000-0000-4000-8000-0000000000a2'''
\set C1  '''c1410000-0000-4000-8000-0000000000c1'''
\set C2  '''c1410000-0000-4000-8000-0000000000c2'''
\set D1  '''c1410000-0000-4000-8000-0000000000d1'''
\set PP1 '''d1410000-0000-4000-8000-000000000001'''
\set QP1 '''d1410000-0000-4000-8000-000000000002'''
\set LP1 '''d1410000-0000-4000-8000-000000000011'''
\set LP2 '''d1410000-0000-4000-8000-000000000012'''
\set LP3 '''d1410000-0000-4000-8000-000000000013'''
\set XP1 '''d1410000-0000-4000-8000-000000000021'''
\set PT1 '''e1410000-0000-4000-8000-000000000001'''
\set PT2 '''e1410000-0000-4000-8000-000000000002'''
\set PT3 '''e1410000-0000-4000-8000-000000000003'''
\set QT1 '''e1410000-0000-4000-8000-000000000004'''
\set S1  '''e1410000-0000-4000-8000-000000000011'''
\set S1M '''e1410000-0000-4000-8000-000000000012'''
\set S1D '''e1410000-0000-4000-8000-000000000013'''
\set S2  '''e1410000-0000-4000-8000-000000000014'''
\set T3  '''e1410000-0000-4000-8000-000000000015'''
\set T4  '''e1410000-0000-4000-8000-000000000016'''
\set XT1 '''e1410000-0000-4000-8000-000000000021'''

INSERT INTO auth.users (id, email) VALUES
  (:O, 'o141@local.test'), (:AR, 'ar141@local.test'), (:MKT, 'mkt141@local.test'), (:SC, 'sc141@local.test'),
  (:ART, 'art141@local.test'), (:FIN, 'fin141@local.test'), (:X, 'x141@local.test'), (:Q, 'q141@local.test');
INSERT INTO public.organizations (id, name, slug, kind, created_by) VALUES
  (:L, 'Label L', 'label-l-141', 'label', :O),
  (:L2, 'Label L2', 'label-l2-141', 'label', :X);
INSERT INTO public.org_members (org_id, user_id, role, functions, scope) VALUES
  (:L, :O, 'owner', '{}', 'org'),
  (:L, :AR, 'member', '{a_and_r}', 'org'),
  (:L, :MKT, 'member', '{marketing}', 'org'),
  (:L, :SC, 'member', '{a_and_r}', 'artists'),
  (:L, :ART, 'artist', '{}', 'artists'),
  (:L, :FIN, 'member', '{finance}', 'org'),
  (:L2, :X, 'owner', '{}', 'org'),
  (:L2, :P, 'member', '{a_and_r}', 'org');

INSERT INTO public.contacts (id, user_id, org_id, name, email, category) VALUES
  (:PC1, :P, NULL, 'Producer artist', 'pc1-141@local.test', 'artist'),
  (:QC1, :Q, NULL, 'Q artist', 'qc1-141@local.test', 'artist'),
  (:C1, NULL, :L, 'Nova', 'nova141@local.test', 'artist'),
  (:C2, NULL, :L, 'Kilo', 'kilo141@local.test', 'artist'),
  (:D1, NULL, :L2, 'L2 artist', 'd1-141@local.test', 'artist');
INSERT INTO public.member_artist_scopes (org_id, user_id, contact_id) VALUES
  (:L, :SC, :C1), (:L, :ART, :C1);

-- Producer rows (org_id NULL), exactly as the producer app writes them.
INSERT INTO public.tracks (id, user_id, title, type, audio_url) VALUES
  (:PT1, :P, 'P beat', 'beat', 'r2://private/p1'),
  (:PT2, :P, 'P song', 'song', 'r2://private/p2'),
  (:PT3, :P, 'P loop', 'loop', 'r2://private/p3'),
  (:QT1, :Q, 'Q beat', 'beat', 'r2://private/q1');
UPDATE public.tracks SET beat_track_id = :PT1 WHERE id = :PT2;
INSERT INTO public.projects (id, user_id, name) VALUES (:PP1, :P, 'P project'), (:QP1, :Q, 'Q project');
INSERT INTO public.project_tracks (project_id, track_id, position) VALUES (:PP1, :PT1, 0), (:PP1, :PT2, 1);
INSERT INTO public.project_contacts (user_id, project_id, contact_id) VALUES (:P, :PP1, :PC1);
INSERT INTO public.artist_portals (user_id, contact_id, token) VALUES (:P, :PC1, 'p-portal-141');
INSERT INTO public.project_assets (user_id, project_id, kind, url) VALUES (:P, :PP1, 'artwork', 'r2://private/pa');
INSERT INTO public.song_beats (song_track_id, beat_track_id, user_id) VALUES (:PT2, :PT1, :P);
INSERT INTO public.track_links (from_track_id, to_track_id, user_id, relation) VALUES (:PT1, :PT3, :P, 'loop');
INSERT INTO public.artist_messages (user_id, contact_id, author, body) VALUES (:P, :PC1, 'producer', 'hi');
INSERT INTO public.contact_track_states (user_id, contact_id, track_id, decision) VALUES (:P, :PC1, :PT1, 'interested');
INSERT INTO public.project_comments (project_id, track_id, author_name, body) VALUES (:PP1, :PT1, 'Guest', 'nice');

-- L's rows. Written as the service role would: no user_id (142), the
-- uploader in created_by.
INSERT INTO public.projects (id, user_id, org_id, name, inbox_for_contact_id) VALUES
  (:LP1, NULL, :L, 'Nova EP', NULL),
  (:LP2, NULL, :L, 'Inbox · Kilo', :C2),
  (:LP3, NULL, :L, 'Beat pool', NULL);
INSERT INTO public.tracks (id, user_id, org_id, created_by, title, type, audio_url, song_stage) VALUES
  (:T3, NULL, :L, :O, 'Pool beat', 'beat', 'r2://private/t3', NULL),
  (:S1, NULL, :L, :AR, 'Nova single', 'song', 'r2://private/s1', 'selected'),
  (:S1M, NULL, :L, :AR, 'Nova single (master)', 'song', 'r2://private/s1m', NULL),
  (:S1D, NULL, :L, :AR, 'Nova single (demo)', 'song', 'r2://private/s1d', NULL),
  (:S2, NULL, :L, :O, 'Kilo demo', 'song', 'r2://private/s2', 'inbox'),
  (:T4, NULL, :L, :O, 'Loose song', 'song', 'r2://private/t4', 'inbox');
UPDATE public.tracks SET beat_track_id = :T3 WHERE id = :S1;
INSERT INTO public.project_tracks (project_id, track_id, position) VALUES
  (:LP1, :S1, 0), (:LP1, :S1M, 1), (:LP1, :S1D, 2), (:LP2, :S2, 0), (:LP3, :T3, 0);
INSERT INTO public.project_contacts (user_id, project_id, contact_id, role) VALUES
  (:O, :LP1, :C1, 'artist'), (:O, :LP1, :C2, 'featured');
INSERT INTO public.artist_portals (user_id, contact_id, token) VALUES (:O, :C1, 'l-portal-141');
-- Org files have no user_id since 143 (the uploader is created_by).
INSERT INTO public.project_assets (user_id, created_by, project_id, kind, url) VALUES
  (NULL, :O, :LP1, 'artwork', 'r2://private/la'), (NULL, :O, :LP1, 'lyrics', 'r2://private/ll'),
  (NULL, :O, :LP1, 'document', 'r2://private/ld'), (NULL, :O, :LP1, 'audio', 'r2://private/lau');
INSERT INTO public.song_beats (song_track_id, beat_track_id, user_id) VALUES (:S1, :T3, :O);
INSERT INTO public.track_links (from_track_id, to_track_id, user_id, relation) VALUES
  (:S1, :S1M, NULL, 'master'), (:S1, :S1D, NULL, 'demo');
INSERT INTO public.artist_messages (user_id, contact_id, project_id, author, body) VALUES
  (:O, :C1, NULL, 'producer', 'welcome'),
  (:O, :C1, :LP3, 'producer', 'about the beat pool');
INSERT INTO public.contact_track_states (user_id, contact_id, track_id, project_id, decision) VALUES
  (:O, :C1, :S1M, :LP1, 'selected'), (:O, :C1, :S1D, :LP1, 'interested');
INSERT INTO public.project_shares (project_id, token) VALUES (:LP1, 'l-share-141');
INSERT INTO public.project_comments (project_id, track_id, author_name, body, share_token) VALUES
  (:LP1, :S1, 'A&R', 'on the single', NULL),
  (:LP1, :S1D, 'A&R', 'on the demo', NULL),
  (:LP1, NULL, 'Guest', 'via a share link', 'l-share-141');

-- L2's rows: P uploaded XT1 there (created_by P, no user_id).
INSERT INTO public.projects (id, user_id, org_id, name) VALUES (:XP1, NULL, :L2, 'L2 project');
INSERT INTO public.tracks (id, user_id, org_id, created_by, title, type, audio_url) VALUES
  (:XT1, NULL, :L2, :P, 'L2 song', 'song', 'r2://private/x1');
INSERT INTO public.project_tracks (project_id, track_id) VALUES (:XP1, :XT1);

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
CREATE FUNCTION public.rows_changed(stmt text) RETURNS int
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  EXECUTE stmt;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- What the current role / claims can read, one line per table.
CREATE FUNCTION public.visible() RETURNS text
LANGUAGE sql AS $$
  SELECT concat_ws(' | ',
    'tracks:' || coalesce((SELECT string_agg(title, ',' ORDER BY title) FROM public.tracks), ''),
    'projects:' || coalesce((SELECT string_agg(name, ',' ORDER BY name) FROM public.projects), ''),
    'project_contacts:' || (SELECT count(*) FROM public.project_contacts),
    'artist_portals:' || (SELECT count(*) FROM public.artist_portals),
    'project_assets:' || coalesce((SELECT string_agg(kind, ',' ORDER BY kind) FROM public.project_assets), ''),
    'song_beats:' || (SELECT count(*) FROM public.song_beats),
    'track_links:' || coalesce((SELECT string_agg(relation, ',' ORDER BY relation) FROM public.track_links), ''),
    'artist_messages:' || coalesce((SELECT string_agg(body, ',' ORDER BY body) FROM public.artist_messages), ''),
    'contact_track_states:' || coalesce((SELECT string_agg(decision, ',' ORDER BY decision) FROM public.contact_track_states), ''),
    'project_comments:' || coalesce((SELECT string_agg(body, ',' ORDER BY body) FROM public.project_comments), '')
  )
$$;

-- Producer rows (org_id IS NULL on the row or its parent) the caller reads.
CREATE FUNCTION public.visible_producer_rows() RETURNS text
LANGUAGE sql AS $$
  SELECT concat_ws(',',
    (SELECT count(*) FROM public.tracks WHERE org_id IS NULL),
    (SELECT count(*) FROM public.projects WHERE org_id IS NULL),
    (SELECT count(*) FROM public.project_contacts pc WHERE pc.project_id IN ('d1410000-0000-4000-8000-000000000001', 'd1410000-0000-4000-8000-000000000002')),
    (SELECT count(*) FROM public.artist_portals WHERE token = 'p-portal-141'),
    (SELECT count(*) FROM public.project_assets WHERE project_id = 'd1410000-0000-4000-8000-000000000001'),
    (SELECT count(*) FROM public.song_beats WHERE song_track_id = 'e1410000-0000-4000-8000-000000000002'),
    (SELECT count(*) FROM public.track_links WHERE from_track_id = 'e1410000-0000-4000-8000-000000000001'),
    (SELECT count(*) FROM public.artist_messages WHERE body = 'hi'),
    (SELECT count(*) FROM public.contact_track_states WHERE track_id = 'e1410000-0000-4000-8000-000000000001'),
    (SELECT count(*) FROM public.project_comments WHERE body = 'nice')
  )
$$;

CREATE FUNCTION public.as_user(p_user text) RETURNS void
LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, false);
$$;

GRANT EXECUTE ON FUNCTION public.check_eq(text, anyelement, anyelement), public.check_raises(text, text, text),
  public.check_ok(text, text), public.rows_changed(text), public.visible(), public.visible_producer_rows(),
  public.as_user(text) TO anon, authenticated, service_role;

-- ── R-04: additive SELECT policies only, producer policies untouched ─────

SELECT public.check_eq('every org_member_read policy is SELECT-only, for authenticated, and names org_id IS NOT NULL',
  (SELECT string_agg(tablename || '=' || cmd || '/' || array_to_string(roles, ',') || '/' || (qual ~ 'org_id IS NOT NULL')::text
                     || '/' || (with_check IS NULL)::text, ' ' ORDER BY tablename)
   FROM pg_policies WHERE schemaname = 'public' AND policyname = 'org_member_read'
     AND tablename IN ('tracks', 'projects', 'project_contacts', 'artist_portals', 'project_assets', 'song_beats',
                       'track_links', 'artist_messages', 'contact_track_states', 'project_comments')),
  'artist_messages=SELECT/authenticated/true/true artist_portals=SELECT/authenticated/true/true '
  'contact_track_states=SELECT/authenticated/true/true project_assets=SELECT/authenticated/true/true '
  'project_comments=SELECT/authenticated/true/true project_contacts=SELECT/authenticated/true/true '
  'projects=SELECT/authenticated/true/true song_beats=SELECT/authenticated/true/true '
  'track_links=SELECT/authenticated/true/true tracks=SELECT/authenticated/true/true');
-- (track_stem_files' guard arrived with 143, carried from LABEL-13.)
SELECT public.check_eq('the only other new policies are the RESTRICTIVE SELECT guards, on every table an owner policy could reach an org row through',
  (SELECT string_agg(tablename || '=' || permissive || '/' || cmd, ' ' ORDER BY tablename)
   FROM pg_policies WHERE schemaname = 'public' AND (permissive <> 'PERMISSIVE' OR policyname = 'org_member_guard')),
  'artist_messages=RESTRICTIVE/SELECT artist_portals=RESTRICTIVE/SELECT contact_track_states=RESTRICTIVE/SELECT '
  'play_head_pings=RESTRICTIVE/SELECT project_access_links=RESTRICTIVE/SELECT project_assets=RESTRICTIVE/SELECT '
  'project_comments=RESTRICTIVE/SELECT project_contacts=RESTRICTIVE/SELECT project_folder_items=RESTRICTIVE/SELECT '
  'project_shares=RESTRICTIVE/SELECT project_tags=RESTRICTIVE/SELECT project_tracks=RESTRICTIVE/SELECT '
  'projects=RESTRICTIVE/SELECT song_beats=RESTRICTIVE/SELECT store_free_downloads=RESTRICTIVE/SELECT '
  'track_collaborators=RESTRICTIVE/SELECT track_licenses=RESTRICTIVE/SELECT track_links=RESTRICTIVE/SELECT '
  'track_stem_files=RESTRICTIVE/SELECT track_versions=RESTRICTIVE/SELECT tracks=RESTRICTIVE/SELECT');
SELECT public.check_eq('the service-only write trigger sits on every table the producer can write an org row through',
  (SELECT string_agg(c.relname, ',' ORDER BY c.relname) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
   WHERE t.tgname = 'labelos_org_rows_service_only' AND NOT t.tgisinternal),
  'artist_messages,artist_portals,contact_track_states,project_assets,project_comments,project_contacts,'
  'project_folder_items,project_shares,project_tags,project_tracks,projects,'
  -- release_items, releases: 144's own org tables (LABEL-16)
  'release_items,releases,song_beats,track_collaborators,'
  'track_licenses,track_links,track_stem_files,track_versions,tracks');
SELECT public.check_eq('every permissive policy on these tables is the producer''s from before 141, or org_member_read',
  (SELECT string_agg(DISTINCT policyname, ',' ORDER BY policyname)
   FROM pg_policies WHERE schemaname = 'public' AND permissive = 'PERMISSIVE'
     AND tablename IN ('tracks', 'projects', 'project_contacts', 'artist_portals', 'project_assets', 'song_beats',
                       'track_links', 'artist_messages', 'contact_track_states', 'project_comments')),
  'artist_messages_owner_select,artist_messages_owner_write,artist_portals_owner_select,artist_portals_owner_write,'
  'contact_track_states_owner_select,contact_track_states_owner_write,org_member_read,owner_only,owner_via_project,'
  'project_assets_owner_select,project_assets_owner_write,project_contacts_owner_select,project_contacts_owner_write,'
  'song_beats_owner_select,song_beats_owner_write,track_links_owner_select,track_links_owner_write');
SELECT public.check_eq('tracks owner_only is still 119''s',
  (SELECT cmd || '|' || qual || '|' || with_check FROM pg_policies WHERE tablename = 'tracks' AND policyname = 'owner_only'),
  'ALL|(( SELECT auth.uid() AS uid) = user_id)|((( SELECT auth.uid() AS uid) = user_id) AND ( SELECT is_producer() AS is_producer))');
SELECT public.check_eq('projects owner_only is still 119''s',
  (SELECT cmd || '|' || qual || '|' || with_check FROM pg_policies WHERE tablename = 'projects' AND policyname = 'owner_only'),
  'ALL|(( SELECT auth.uid() AS uid) = user_id)|((( SELECT auth.uid() AS uid) = user_id) AND ( SELECT is_producer() AS is_producer))');

-- ── Who reads what ──────────────────────────────────────────────────────

SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
SELECT public.check_eq('anon reads nothing',
  public.visible(),
  'tracks: | projects: | project_contacts:0 | artist_portals:0 | project_assets: | song_beats:0 | track_links: | artist_messages: | contact_track_states: | project_comments:');
SELECT public.check_eq('anon: the helpers say no', public.can_read_org_track(:L, :S1) OR public.can_see_org_project(:L, :LP1), false);
RESET ROLE;

SET ROLE authenticated;
SELECT public.as_user(:B);
SELECT public.check_eq('a buyer (no membership) reads nothing',
  public.visible(),
  'tracks: | projects: | project_contacts:0 | artist_portals:0 | project_assets: | song_beats:0 | track_links: | artist_messages: | contact_track_states: | project_comments:');
RESET ROLE;

-- The producer: their own rows exactly as before, plus the L2 rows their
-- membership there gives them; nothing of L, nothing of Q.
SET ROLE authenticated;
SELECT public.as_user(:P);
SELECT public.check_eq('producer: own rows only (org_id IS NULL), every table',
  public.visible_producer_rows(), '3,1,1,1,1,1,1,1,1,1');
SELECT public.check_eq('producer: own rows + L2 (member there), nothing of L or Q',
  public.visible(),
  'tracks:L2 song,P beat,P loop,P song | projects:L2 project,P project | project_contacts:1 | artist_portals:1 | '
  'project_assets:artwork | song_beats:1 | track_links:loop | artist_messages:hi | contact_track_states:interested | project_comments:nice');
SELECT public.check_eq('producer: Q''s producer rows stay invisible', (SELECT count(*) FROM public.tracks WHERE user_id = 'a1410000-0000-4000-8000-000000000008'), 0::bigint);
SELECT public.check_eq('producer can still write their own rows (owner_only untouched)',
  public.rows_changed($$UPDATE public.tracks SET title = 'P beat' WHERE id = 'e1410000-0000-4000-8000-000000000001'$$), 1);
SELECT public.check_raises('producer cannot move their own track into an org',
  $$UPDATE public.tracks SET org_id = 'b1410000-0000-4000-8000-000000000002' WHERE id = 'e1410000-0000-4000-8000-000000000001'$$,
  'organization cannot change|written through /api/org only');
SELECT public.check_eq('producer cannot write an L2 project (no org write policy)',
  public.rows_changed($$UPDATE public.projects SET name = 'x' WHERE id = 'd1410000-0000-4000-8000-000000000021'$$), 0);
RESET ROLE;

SET ROLE authenticated;
SELECT public.as_user(:O);
SELECT public.check_eq('L owner: every L row, nothing of the producer, Q or L2',
  public.visible(),
  'tracks:Kilo demo,Loose song,Nova single,Nova single (demo),Nova single (master),Pool beat | '
  'projects:Beat pool,Inbox · Kilo,Nova EP | project_contacts:2 | artist_portals:1 | project_assets:artwork,audio,document,lyrics | '
  'song_beats:1 | track_links:demo,master | artist_messages:about the beat pool,welcome | contact_track_states:interested,selected | '
  'project_comments:on the demo,on the single,via a share link');
SELECT public.check_eq('L owner: no row with org_id IS NULL', public.visible_producer_rows(), '0,0,0,0,0,0,0,0,0,0');
RESET ROLE;

SET ROLE authenticated;
SELECT public.as_user(:AR);
SELECT public.check_eq('A&R (whole org, working audio): every L row',
  public.visible(),
  'tracks:Kilo demo,Loose song,Nova single,Nova single (demo),Nova single (master),Pool beat | '
  'projects:Beat pool,Inbox · Kilo,Nova EP | project_contacts:2 | artist_portals:1 | project_assets:artwork,audio,document,lyrics | '
  'song_beats:1 | track_links:demo,master | artist_messages:about the beat pool,welcome | contact_track_states:interested,selected | '
  'project_comments:on the demo,on the single,via a share link');
SELECT public.check_eq('A&R: no producer row', public.visible_producer_rows(), '0,0,0,0,0,0,0,0,0,0');
SELECT public.check_eq('A&R cannot write an org track through RLS',
  public.rows_changed($$DELETE FROM public.tracks WHERE org_id = 'b1410000-0000-4000-8000-000000000001'$$), 0);
RESET ROLE;

-- D4: marketing hears finished music only — the selected single and its
-- master. Never the demo, the inbox song, the beat or anything built from
-- working material; no portal token (its audio is working); only artwork /
-- lyrics files; no comment on a working track or naming a share token.
SET ROLE authenticated;
SELECT public.as_user(:MKT);
SELECT public.check_eq('marketing: finished material only',
  public.visible(),
  'tracks:Nova single,Nova single (master) | projects:Beat pool,Inbox · Kilo,Nova EP | project_contacts:2 | artist_portals:0 | '
  'project_assets:artwork,lyrics | song_beats:0 | track_links:master | artist_messages:about the beat pool,welcome | '
  'contact_track_states:selected | project_comments:on the single');
SELECT public.check_eq('marketing: can_read_org_track on the demo is false', public.can_read_org_track(:L, :S1D), false);
RESET ROLE;

-- Artist scope: SC sees C1's project (LP1) and what is in it, nothing else.
SET ROLE authenticated;
SELECT public.as_user(:SC);
SELECT public.check_eq('artists-scoped A&R: only C1''s project and its material',
  public.visible(),
  'tracks:Nova single,Nova single (demo),Nova single (master) | projects:Nova EP | project_contacts:1 | artist_portals:1 | '
  'project_assets:artwork,audio,document,lyrics | song_beats:0 | track_links:demo,master | artist_messages:welcome | '
  'contact_track_states:interested,selected | project_comments:on the demo,on the single,via a share link');
SELECT public.check_eq('scoped: the Inbox of an out-of-scope artist is hidden', public.can_see_org_project(:L, :LP2), false);
SELECT public.check_eq('scoped: a track in no project is hidden', public.can_see_org_track(:L, :T4), false);
RESET ROLE;

-- Scope changes take effect at once.
INSERT INTO public.member_artist_scopes (org_id, user_id, contact_id) VALUES (:L, :SC, :C2);
SET ROLE authenticated;
SELECT public.as_user(:SC);
SELECT public.check_eq('scope widened to C2: the Inbox and its song appear',
  (SELECT string_agg(name, ',' ORDER BY name) FROM public.projects) || ' / ' || (SELECT count(*) FROM public.tracks WHERE title = 'Kilo demo'),
  'Inbox · Kilo,Nova EP / 1');
RESET ROLE;
DELETE FROM public.member_artist_scopes WHERE user_id = :SC;
SET ROLE authenticated;
SELECT public.as_user(:SC);
SELECT public.check_eq('scoped member with zero contacts reads nothing',
  public.visible(),
  'tracks: | projects: | project_contacts:0 | artist_portals:0 | project_assets: | song_beats:0 | track_links: | artist_messages: | contact_track_states: | project_comments:');
RESET ROLE;

-- D5: the roster artist sees everything about their own songs (working
-- audio included), but holds no share.external, so never a portal token
-- and never a comment carrying a share token.
SET ROLE authenticated;
SELECT public.as_user(:ART);
SELECT public.check_eq('roster artist: their own project and songs, no portal token',
  public.visible(),
  'tracks:Nova single,Nova single (demo),Nova single (master) | projects:Nova EP | project_contacts:1 | artist_portals:0 | '
  'project_assets:artwork,audio,document,lyrics | song_beats:0 | track_links:demo,master | artist_messages:welcome | '
  'contact_track_states:interested,selected | project_comments:on the demo,on the single');
RESET ROLE;
-- Role artist is scoped by ROLE, whatever the scope column says.
ALTER TABLE public.org_members DROP CONSTRAINT org_members_artist_is_scoped;
UPDATE public.org_members SET scope = 'org' WHERE user_id = :ART;
SET ROLE authenticated;
SELECT public.as_user(:ART);
SELECT public.check_eq('a roster artist stays scoped even with scope = org',
  (SELECT string_agg(name, ',' ORDER BY name) FROM public.projects), 'Nova EP');
RESET ROLE;
UPDATE public.org_members SET scope = 'artists' WHERE user_id = :ART;
ALTER TABLE public.org_members ADD CONSTRAINT org_members_artist_is_scoped CHECK (role <> 'artist' OR scope = 'artists');

SET ROLE authenticated;
SELECT public.as_user(:FIN);
SELECT public.check_eq('a member without catalog.read reads nothing',
  public.visible(),
  'tracks: | projects: | project_contacts:0 | artist_portals:0 | project_assets: | song_beats:0 | track_links: | artist_messages: | contact_track_states: | project_comments:');
RESET ROLE;

SET ROLE authenticated;
SELECT public.as_user(:X);
SELECT public.check_eq('L2 owner: L2 rows only — not L, not the producer''s even where P uploaded',
  public.visible(),
  'tracks:L2 song | projects:L2 project | project_contacts:0 | artist_portals:0 | project_assets: | song_beats:0 | track_links: | '
  'artist_messages: | contact_track_states: | project_comments:');
SELECT public.check_eq('L2 owner: can_see_org_project with a mismatched org is false', public.can_see_org_project(:L2, :LP1), false);
SELECT public.check_eq('L2 owner: can_read_org_track on a producer track is false', public.can_read_org_track(:L2, :PT1), false);
RESET ROLE;

-- Per-member tweak: marketing given audio.working reads working material.
UPDATE public.org_members SET cap_grants = '{audio.working}' WHERE user_id = :MKT;
SET ROLE authenticated;
SELECT public.as_user(:MKT);
SELECT public.check_eq('marketing with an audio.working grant: the demo appears',
  (SELECT count(*) FROM public.tracks WHERE title = 'Nova single (demo)'), 1::bigint);
RESET ROLE;
UPDATE public.org_members SET cap_grants = '{}' WHERE user_id = :MKT;

-- Class follows the links: a working link onto the master makes it working.
INSERT INTO public.track_links (from_track_id, to_track_id, user_id, relation) VALUES (:S2, :S1M, NULL, 'version');
SET ROLE authenticated;
SELECT public.as_user(:MKT);
SELECT public.check_eq('a master that is also linked as working material is hidden from marketing',
  (SELECT string_agg(title, ',' ORDER BY title) FROM public.tracks), 'Nova single');
RESET ROLE;
DELETE FROM public.track_links WHERE from_track_id = :S2;

-- The guards: writing a row is not a read grant. AR "uploaded" a demo and a
-- file. Since 142 an org track and its links carry no user_id at all (AR is
-- only its created_by), and since 143 an org file neither, so no owner
-- policy can match them; the guards still decide everything else.
UPDATE public.tracks SET created_by = :AR WHERE id = :S1D;
UPDATE public.project_assets SET created_by = :AR WHERE kind = 'document' AND project_id = :LP1;
SET ROLE authenticated;
SELECT public.as_user(:AR);
SELECT public.check_eq('AR, still in L, reads what they wrote', (SELECT count(*) FROM public.tracks WHERE id = :S1D), 1::bigint);
RESET ROLE;
UPDATE public.org_members SET scope = 'artists' WHERE user_id = :AR AND org_id = :L;
SET ROLE authenticated;
SELECT public.as_user(:AR);
SELECT public.check_eq('AR narrowed to no artist: their own demo is hidden, as are its link and file',
  (SELECT count(*) FROM public.tracks WHERE id = :S1D) || '/' || (SELECT count(*) FROM public.track_links WHERE to_track_id = :S1D)
    || '/' || (SELECT count(*) FROM public.project_assets WHERE kind = 'document'),
  '0/0/0');
RESET ROLE;
DELETE FROM public.org_members WHERE user_id = :AR AND org_id = :L;
SET ROLE authenticated;
SELECT public.as_user(:AR);
SELECT public.check_eq('AR removed from L: nothing of L, not even the rows that still carry their user_id',
  public.visible(),
  'tracks: | projects: | project_contacts:0 | artist_portals:0 | project_assets: | song_beats:0 | track_links: | artist_messages: | contact_track_states: | project_comments:');
SELECT public.check_eq('AR removed: cannot delete their old org row either (it is not visible)',
  public.rows_changed($$DELETE FROM public.tracks WHERE id = 'e1410000-0000-4000-8000-000000000013'$$), 0);
RESET ROLE;
INSERT INTO public.org_members (org_id, user_id, role, functions, scope) VALUES (:L, :AR, 'member', '{a_and_r}', 'org');

-- Soft-deleting L hides it from its own owner.
UPDATE public.organizations SET deleted_at = now() WHERE id = :L;
SET ROLE authenticated;
SELECT public.as_user(:O);
SELECT public.check_eq('soft-deleted org: its owner reads nothing of it',
  public.visible(),
  'tracks: | projects: | project_contacts:0 | artist_portals:0 | project_assets: | song_beats:0 | track_links: | artist_messages: | contact_track_states: | project_comments:');
RESET ROLE;
UPDATE public.organizations SET deleted_at = NULL WHERE id = :L;

-- ── Writes: org rows only through the service role ──────────────────────
-- P is the producer (owner_only's WITH CHECK passes for them) and an A&R
-- member of L2; P uploaded XT1 in L2 (created_by P). XP2 is an L2 project P
-- created, with a share and a comment carrying its token. Since 142 neither
-- carries P's user_id, so the owner policies cannot reach them at all: the
-- "author" checks below hold trivially and are kept as a guard on that.
INSERT INTO public.projects (id, user_id, org_id, name) VALUES ('d1410000-0000-4000-8000-000000000022', NULL, :L2, 'P''s L2 project');
INSERT INTO public.project_shares (project_id, token) VALUES ('d1410000-0000-4000-8000-000000000022', 'x-share-141');
INSERT INTO public.project_comments (project_id, author_name, body, share_token) VALUES
  ('d1410000-0000-4000-8000-000000000022', 'Guest', 'x share comment', 'x-share-141');
SET ROLE authenticated;
SELECT public.as_user(:P);
SELECT public.check_raises('the producer cannot insert a track into an org they are not in',
  $$INSERT INTO public.tracks (user_id, org_id, title, type, audio_url) VALUES ('0b0e1a57-0000-4000-8000-000000000001', 'b1410000-0000-4000-8000-000000000001', 'injected', 'song', 'r2://x')$$,
  'written through /api/org only');
SELECT public.check_raises('… nor into an org they are in',
  $$INSERT INTO public.projects (user_id, org_id, name) VALUES ('0b0e1a57-0000-4000-8000-000000000001', 'b1410000-0000-4000-8000-000000000002', 'injected')$$,
  'written through /api/org only');
SELECT public.check_eq('the author (created_by) cannot update their org track through PostgREST',
  public.rows_changed($$UPDATE public.tracks SET song_stage = 'selected' WHERE id = 'e1410000-0000-4000-8000-000000000021'$$), 0);
SELECT public.check_eq('the author (created_by) cannot delete their org track through PostgREST',
  public.rows_changed($$DELETE FROM public.tracks WHERE id = 'e1410000-0000-4000-8000-000000000021'$$), 0);
SELECT public.check_raises('linking an org project to an artist (widening scope) is refused',
  $$INSERT INTO public.project_contacts (user_id, project_id, contact_id) VALUES ('0b0e1a57-0000-4000-8000-000000000001', 'd1410000-0000-4000-8000-000000000022', 'c1410000-0000-4000-8000-0000000000d1')$$,
  'written through /api/org only');
SELECT public.check_raises('the author cannot add a share to their org project',
  $$INSERT INTO public.project_shares (project_id, token) VALUES ('d1410000-0000-4000-8000-000000000022', 'sneaky-141')$$,
  'written through /api/org only');
SELECT public.check_raises('… nor a track to it',
  $$INSERT INTO public.project_tracks (project_id, track_id) VALUES ('d1410000-0000-4000-8000-000000000022', 'e1410000-0000-4000-8000-000000000001')$$,
  'written through /api/org only');
SELECT public.check_eq('the author reads no share (bearer token) of their org project',
  (SELECT count(*) FROM public.project_shares WHERE project_id = 'd1410000-0000-4000-8000-000000000022'), 0::bigint);
SELECT public.check_eq('… nor its track list (no org read path on project_tracks)',
  (SELECT count(*) FROM public.project_tracks WHERE project_id = 'd1410000-0000-4000-8000-000000000021'), 0::bigint);
SELECT public.check_ok('producer rows stay writable through RLS',
  $$INSERT INTO public.project_tracks (project_id, track_id, position) VALUES ('d1410000-0000-4000-8000-000000000001', 'e1410000-0000-4000-8000-000000000003', 2)$$);
RESET ROLE;
-- Without share.external, the share-token comment on P's org project is
-- hidden (no owner policy can match it: the project has no user_id).
UPDATE public.org_members SET cap_revokes = '{share.external}' WHERE org_id = :L2 AND user_id = :P;
SET ROLE authenticated;
SELECT public.as_user(:P);
SELECT public.check_eq('the author without share.external does not read the share-token comment',
  (SELECT count(*) FROM public.project_comments WHERE body = 'x share comment'), 0::bigint);
RESET ROLE;
UPDATE public.org_members SET cap_revokes = '{}' WHERE org_id = :L2 AND user_id = :P;
SET ROLE authenticated;
SELECT public.as_user(:P);
SELECT public.check_eq('with share.external back, it is readable again', (SELECT count(*) FROM public.project_comments WHERE body = 'x share comment'), 1::bigint);
RESET ROLE;
SELECT public.check_ok('the service role (here postgres) still writes org rows',
  $$UPDATE public.tracks SET title = 'L2 song' WHERE id = 'e1410000-0000-4000-8000-000000000021'$$);

-- ── Triggers: the owner case is unchanged; the org case is same-org only ─

-- Different owner, no org → still refused, with the old messages.
SELECT public.check_raises('project_contacts: different owner, no org',
  $$INSERT INTO public.project_contacts (user_id, project_id, contact_id) VALUES ('0b0e1a57-0000-4000-8000-000000000001', 'd1410000-0000-4000-8000-000000000001', 'c1410000-0000-4000-8000-0000000000a2')$$,
  'project_contacts: contact .* is not owned by');
SELECT public.check_raises('project_contacts: another owner''s project',
  $$INSERT INTO public.project_contacts (user_id, project_id, contact_id) VALUES ('0b0e1a57-0000-4000-8000-000000000001', 'd1410000-0000-4000-8000-000000000002', 'c1410000-0000-4000-8000-0000000000a1')$$,
  'project_contacts: project .* is not owned by');
SELECT public.check_raises('contact_track_states: different owner, no org',
  $$INSERT INTO public.contact_track_states (user_id, contact_id, track_id) VALUES ('0b0e1a57-0000-4000-8000-000000000001', 'c1410000-0000-4000-8000-0000000000a1', 'e1410000-0000-4000-8000-000000000004')$$,
  'contact_track_states: track .* is not owned by');
SELECT public.check_raises('tracks.beat_track_id: different owner, no org',
  $$UPDATE public.tracks SET beat_track_id = 'e1410000-0000-4000-8000-000000000004' WHERE id = 'e1410000-0000-4000-8000-000000000002'$$,
  'is not owned by the song''s owner');
SELECT public.check_raises('artist_portals: different owner, no org',
  $$INSERT INTO public.artist_portals (user_id, contact_id, token) VALUES ('0b0e1a57-0000-4000-8000-000000000001', 'c1410000-0000-4000-8000-0000000000a2', 'zz-141')$$,
  'artist_portals: contact .* is not owned by');
SELECT public.check_raises('project_assets: different owner, no org',
  $$INSERT INTO public.project_assets (user_id, project_id, url) VALUES ('0b0e1a57-0000-4000-8000-000000000001', 'd1410000-0000-4000-8000-000000000002', 'r2://x')$$,
  'project_assets: project .* is not owned by');
SELECT public.check_raises('project_comments: different owner, no org',
  $$INSERT INTO public.project_comments (project_id, author_name, body, contact_id) VALUES ('d1410000-0000-4000-8000-000000000001', 'x', 'x', 'c1410000-0000-4000-8000-0000000000a2')$$,
  'does not belong to the owner of project');
SELECT public.check_raises('artist_messages: different owner, no org',
  $$INSERT INTO public.artist_messages (user_id, contact_id, project_id, author, body) VALUES ('0b0e1a57-0000-4000-8000-000000000001', 'c1410000-0000-4000-8000-0000000000a1', 'd1410000-0000-4000-8000-000000000002', 'producer', 'x')$$,
  'artist_messages: project .* is not owned by');
SELECT public.check_raises('song_beats: different owner, no org',
  $$INSERT INTO public.song_beats (song_track_id, beat_track_id, user_id) VALUES ('e1410000-0000-4000-8000-000000000002', 'e1410000-0000-4000-8000-000000000004', '0b0e1a57-0000-4000-8000-000000000001')$$,
  'song_beats: beat .* is not owned by');
SELECT public.check_raises('track_links: different owner, no org',
  $$INSERT INTO public.track_links (from_track_id, to_track_id, user_id, relation) VALUES ('e1410000-0000-4000-8000-000000000001', 'e1410000-0000-4000-8000-000000000004', '0b0e1a57-0000-4000-8000-000000000001', 'loop')$$,
  'track_links: both tracks must be owned by');

-- Same owner on both sides is no longer enough when one side is an org
-- row: P uploaded XT1 into L2, P's producer song may not be built on it.
SELECT public.check_raises('tracks.beat_track_id: a producer song on the same user''s org track',
  $$UPDATE public.tracks SET beat_track_id = 'e1410000-0000-4000-8000-000000000021' WHERE id = 'e1410000-0000-4000-8000-000000000002'$$,
  'is not owned by the song''s owner');
SELECT public.check_raises('song_beats: a producer song on the same user''s org track',
  $$INSERT INTO public.song_beats (song_track_id, beat_track_id, user_id) VALUES ('e1410000-0000-4000-8000-000000000002', 'e1410000-0000-4000-8000-000000000021', '0b0e1a57-0000-4000-8000-000000000001')$$,
  'song_beats: beat .* is not owned by');
SELECT public.check_raises('track_links: a producer track to the same user''s org track',
  $$INSERT INTO public.track_links (from_track_id, to_track_id, user_id, relation) VALUES ('e1410000-0000-4000-8000-000000000001', 'e1410000-0000-4000-8000-000000000021', '0b0e1a57-0000-4000-8000-000000000001', 'loop')$$,
  'track_links: both tracks must be owned by');

-- Org case: cross-org and org↔producer joins are refused.
SELECT public.check_raises('project_contacts: an L project with an L2 contact',
  $$INSERT INTO public.project_contacts (user_id, project_id, contact_id) VALUES ('a1410000-0000-4000-8000-000000000001', 'd1410000-0000-4000-8000-000000000011', 'c1410000-0000-4000-8000-0000000000d1')$$,
  'is not owned by');
SELECT public.check_raises('project_contacts: an L project with a producer contact',
  $$INSERT INTO public.project_contacts (user_id, project_id, contact_id) VALUES ('0b0e1a57-0000-4000-8000-000000000001', 'd1410000-0000-4000-8000-000000000011', 'c1410000-0000-4000-8000-0000000000a1')$$,
  'is not owned by');
SELECT public.check_raises('project_contacts: a producer project with an L contact',
  $$INSERT INTO public.project_contacts (user_id, project_id, contact_id) VALUES ('0b0e1a57-0000-4000-8000-000000000001', 'd1410000-0000-4000-8000-000000000001', 'c1410000-0000-4000-8000-0000000000c2')$$,
  'is not owned by');
SELECT public.check_raises('song_beats: an L song on an L2 beat',
  $$INSERT INTO public.song_beats (song_track_id, beat_track_id, user_id) VALUES ('e1410000-0000-4000-8000-000000000014', 'e1410000-0000-4000-8000-000000000021', '0b0e1a57-0000-4000-8000-000000000001')$$,
  'is not owned by');
SELECT public.check_raises('track_links: L → producer',
  $$INSERT INTO public.track_links (from_track_id, to_track_id, user_id, relation) VALUES ('e1410000-0000-4000-8000-000000000011', 'e1410000-0000-4000-8000-000000000001', 'a1410000-0000-4000-8000-000000000001', 'loop')$$,
  'both tracks must be owned by');
SELECT public.check_raises('tracks.beat_track_id: an L song on an L2 beat',
  $$UPDATE public.tracks SET beat_track_id = 'e1410000-0000-4000-8000-000000000021' WHERE id = 'e1410000-0000-4000-8000-000000000014'$$,
  'is not owned by the song''s owner');
SELECT public.check_raises('contact_track_states: an L contact on an L2 track',
  $$INSERT INTO public.contact_track_states (user_id, contact_id, track_id) VALUES ('a1410000-0000-4000-8000-000000000001', 'c1410000-0000-4000-8000-0000000000c1', 'e1410000-0000-4000-8000-000000000021')$$,
  'is not owned by');
SELECT public.check_raises('contact_track_states: an L pair in an L2 project',
  $$INSERT INTO public.contact_track_states (user_id, contact_id, track_id, project_id) VALUES ('a1410000-0000-4000-8000-000000000001', 'c1410000-0000-4000-8000-0000000000c2', 'e1410000-0000-4000-8000-000000000014', 'd1410000-0000-4000-8000-000000000021')$$,
  'is not owned by');
SELECT public.check_raises('artist_messages: an L contact about an L2 project',
  $$INSERT INTO public.artist_messages (user_id, contact_id, project_id, author, body) VALUES ('a1410000-0000-4000-8000-000000000001', 'c1410000-0000-4000-8000-0000000000c1', 'd1410000-0000-4000-8000-000000000021', 'producer', 'x')$$,
  'is not owned by');
SELECT public.check_raises('project_comments: an L2 contact''s thread on an L project',
  $$INSERT INTO public.project_comments (project_id, author_name, body, contact_id) VALUES ('d1410000-0000-4000-8000-000000000011', 'x', 'x', 'c1410000-0000-4000-8000-0000000000d1')$$,
  'does not belong to the owner of project');

-- Org case accepted (the setup above already wrote one of each); a few more.
SELECT public.check_ok('song_beats: an L song on an L beat',
  $$INSERT INTO public.song_beats (song_track_id, beat_track_id, user_id, position) VALUES ('e1410000-0000-4000-8000-000000000014', 'e1410000-0000-4000-8000-000000000015', 'a1410000-0000-4000-8000-000000000002', 0)$$);
SELECT public.check_ok('project_comments: an L contact''s thread on an L project',
  $$INSERT INTO public.project_comments (project_id, author_name, body, contact_id) VALUES ('d1410000-0000-4000-8000-000000000011', 'Nova', 'x', 'c1410000-0000-4000-8000-0000000000c1')$$);
SELECT public.check_ok('tracks.beat_track_id: an L song on an L beat',
  $$UPDATE public.tracks SET beat_track_id = 'e1410000-0000-4000-8000-000000000015' WHERE id = 'e1410000-0000-4000-8000-000000000014'$$);
SELECT public.check_ok('producer rows still link as before',
  $$INSERT INTO public.track_links (from_track_id, to_track_id, user_id, relation) VALUES ('e1410000-0000-4000-8000-000000000002', 'e1410000-0000-4000-8000-000000000003', '0b0e1a57-0000-4000-8000-000000000001', 'loop')$$);

-- ── Columns ─────────────────────────────────────────────────────────────

SELECT public.check_raises('an org track cannot leave its org',
  $$UPDATE public.tracks SET org_id = NULL WHERE id = 'e1410000-0000-4000-8000-000000000011'$$, 'organization cannot change');
SELECT public.check_raises('an org project cannot move to another org',
  $$UPDATE public.projects SET org_id = 'b1410000-0000-4000-8000-000000000002' WHERE id = 'd1410000-0000-4000-8000-000000000011'$$, 'organization cannot change');
SELECT public.check_raises('one Inbox per artist',
  $$INSERT INTO public.projects (user_id, org_id, name, inbox_for_contact_id) VALUES (NULL, 'b1410000-0000-4000-8000-000000000001', 'dup', 'c1410000-0000-4000-8000-0000000000c2')$$,
  'projects_inbox_for_contact_uniq');
SELECT public.check_raises('an Inbox for another org''s contact is refused',
  $$INSERT INTO public.projects (user_id, org_id, name, inbox_for_contact_id) VALUES (NULL, 'b1410000-0000-4000-8000-000000000001', 'x', 'c1410000-0000-4000-8000-0000000000d1')$$,
  'not a contact of the project''s organization');
SELECT public.check_raises('a producer project cannot be an Inbox',
  $$UPDATE public.projects SET inbox_for_contact_id = 'c1410000-0000-4000-8000-0000000000a1' WHERE id = 'd1410000-0000-4000-8000-000000000001'$$,
  'not a contact of the project''s organization');
SELECT public.check_ok('ISRC with hyphens',
  $$UPDATE public.tracks SET isrc = 'GB-ABC-26-00001' WHERE id = 'e1410000-0000-4000-8000-000000000012'$$);
SELECT public.check_ok('ISRC without hyphens',
  $$UPDATE public.tracks SET isrc = 'USAB12600002' WHERE id = 'e1410000-0000-4000-8000-000000000011'$$);
SELECT public.check_raises('a malformed ISRC is refused',
  $$UPDATE public.tracks SET isrc = 'not-an-isrc' WHERE id = 'e1410000-0000-4000-8000-000000000012'$$, 'tracks_isrc_format');
SELECT public.check_eq('no existing row was given an org (no backfill)',
  (SELECT count(*) FROM public.tracks WHERE org_id IS NOT NULL AND id::text NOT LIKE 'e1410000-%'), 0::bigint);
