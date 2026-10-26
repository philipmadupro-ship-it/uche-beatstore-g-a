-- Behaviour checks for 143_labelos_org_assets.sql, run by
-- scripts/local-db/check.sh (npm run db:local:check) in its own copy of the
-- throwaway database. Every check RAISEs on failure; psql stops at the first.
--
-- Cast (seed: producer P with a creator_profiles row):
--   label L : owner O; AR (A&R, scope org); MKT (marketing: catalogue read,
--             finished audio, no working audio, no contracts); LEG (legal:
--             catalogue read, rights, contracts.read, no working audio);
--             SC (A&R scoped to artist C2 only); ART (roster artist, C1)
--   label L2: owner X
--   P is the producer and no member of either org.
--
-- Rows:
--   P's project PP1 with a lyric sheet (a producer file, user_id P).
--   L's project LP1 (artist C1), written as the service role writes them —
--     no user_id, the uploader in created_by — with one file of each class:
--     artwork, photo, video (visual); session (working); contract,
--     split_sheet (legal, always restricted); a restricted document.
--   L2's project XP1 with an artwork.
--   An org song LS1 in LP1 with a stem file; P's beat PT1 with one.

\set P   '''0b0e1a57-0000-4000-8000-000000000001'''
\set O   '''a1430000-0000-4000-8000-000000000001'''
\set AR  '''a1430000-0000-4000-8000-000000000002'''
\set MKT '''a1430000-0000-4000-8000-000000000003'''
\set LEG '''a1430000-0000-4000-8000-000000000004'''
\set SC  '''a1430000-0000-4000-8000-000000000005'''
\set ART '''a1430000-0000-4000-8000-000000000006'''
\set X   '''a1430000-0000-4000-8000-000000000007'''
\set L   '''b1430000-0000-4000-8000-000000000001'''
\set L2  '''b1430000-0000-4000-8000-000000000002'''
\set C1  '''c1430000-0000-4000-8000-0000000000c1'''
\set C2  '''c1430000-0000-4000-8000-0000000000c2'''
\set PP1 '''d1430000-0000-4000-8000-000000000001'''
\set LP1 '''d1430000-0000-4000-8000-000000000011'''
\set XP1 '''d1430000-0000-4000-8000-000000000021'''
\set PT1 '''e1430000-0000-4000-8000-000000000001'''
\set LS1 '''e1430000-0000-4000-8000-000000000011'''

INSERT INTO auth.users (id, email) VALUES
  (:O, 'o143@local.test'), (:AR, 'ar143@local.test'), (:MKT, 'mkt143@local.test'), (:LEG, 'leg143@local.test'),
  (:SC, 'sc143@local.test'), (:ART, 'art143@local.test'), (:X, 'x143@local.test');
INSERT INTO public.organizations (id, name, slug, kind, created_by) VALUES
  (:L, 'Label L', 'label-l-143', 'label', :O),
  (:L2, 'Label L2', 'label-l2-143', 'label', :X);
INSERT INTO public.org_members (org_id, user_id, role, functions, scope) VALUES
  (:L, :O, 'owner', '{}', 'org'),
  (:L, :AR, 'member', '{a_and_r}', 'org'),
  (:L, :MKT, 'member', '{marketing}', 'org'),
  (:L, :LEG, 'member', '{legal}', 'org'),
  (:L, :SC, 'member', '{a_and_r}', 'artists'),
  (:L, :ART, 'artist', '{}', 'artists'),
  (:L2, :X, 'owner', '{}', 'org');
INSERT INTO public.contacts (id, user_id, org_id, name, email, category) VALUES
  (:C1, NULL, :L, 'Nova', 'nova143@local.test', 'artist'),
  (:C2, NULL, :L, 'Kilo', 'kilo143@local.test', 'artist');
INSERT INTO public.member_artist_scopes (org_id, user_id, contact_id) VALUES
  (:L, :SC, :C2), (:L, :ART, :C1);

INSERT INTO public.projects (id, user_id, name) VALUES (:PP1, :P, 'P project');
INSERT INTO public.tracks (id, user_id, title, type, audio_url) VALUES (:PT1, :P, 'P beat', 'beat', 'r2://private/p1');
INSERT INTO public.project_assets (user_id, project_id, kind, url) VALUES (:P, :PP1, 'lyrics', 'r2://private/project-assets/p');
INSERT INTO public.track_stem_files (track_id, user_id, label, url) VALUES (:PT1, :P, 'P drums', 'r2://private/p-drums');

INSERT INTO public.projects (id, user_id, org_id, name) VALUES
  (:LP1, NULL, :L, 'Nova EP'),
  (:XP1, NULL, :L2, 'L2 project');
INSERT INTO public.project_contacts (user_id, project_id, contact_id, role) VALUES (NULL, :LP1, :C1, 'artist');
INSERT INTO public.tracks (id, user_id, org_id, created_by, title, type, audio_url, song_stage) VALUES
  (:LS1, NULL, :L, :AR, 'Nova single', 'song', 'r2://private/orgs/l/tracks/s1', 'inbox');
INSERT INTO public.project_tracks (project_id, track_id, position) VALUES (:LP1, :LS1, 0);
-- track_stem_files.user_id is still NOT NULL (080): the uploader, as 141 wrote
-- org rows of the #44 tables before 142.
INSERT INTO public.track_stem_files (track_id, user_id, label, url) VALUES (:LS1, :AR, 'Nova vocals', 'r2://private/orgs/l/stems/v');

-- Org files: no org_id given — the trigger takes it from the project.
INSERT INTO public.project_assets (user_id, created_by, project_id, kind, sensitivity, url) VALUES
  (NULL, :O, :LP1, 'artwork', 'normal', 'r2://private/orgs/l/assets/a'),
  (NULL, :O, :LP1, 'photo', 'normal', 'r2://private/orgs/l/assets/b'),
  (NULL, :O, :LP1, 'video', 'normal', 'r2://private/orgs/l/assets/c'),
  (NULL, :AR, :LP1, 'session', 'normal', 'r2://private/orgs/l/assets/d'),
  (NULL, :LEG, :LP1, 'contract', 'restricted', 'r2://private/orgs/l/assets/e'),
  (NULL, :LEG, :LP1, 'split_sheet', 'restricted', 'r2://private/orgs/l/assets/f'),
  (NULL, :O, :LP1, 'document', 'restricted', 'r2://private/orgs/l/assets/g'),
  (NULL, :X, :XP1, 'artwork', 'normal', 'r2://private/orgs/l2/assets/a');

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
CREATE FUNCTION public.as_user(p_user text) RETURNS void
LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, false);
$$;
-- The files the caller reads: kind, `*` when restricted, `@L2` for L2's.
CREATE FUNCTION public.visible_files() RETURNS text
LANGUAGE sql AS $$
  SELECT coalesce(string_agg(
    a.kind || CASE WHEN a.sensitivity = 'restricted' THEN '*' ELSE '' END
      || CASE WHEN a.project_id = 'd1430000-0000-4000-8000-000000000021' THEN '@L2' ELSE '' END,
    ',' ORDER BY a.kind, a.project_id), '')
  FROM public.project_assets a
$$;
GRANT EXECUTE ON FUNCTION public.check_eq(text, anyelement, anyelement), public.check_raises(text, text, text),
  public.check_ok(text, text), public.rows_changed(text), public.as_user(text), public.visible_files()
  TO anon, authenticated, service_role;

-- ── Schema ──────────────────────────────────────────────────────────────

SELECT public.check_eq('org files took their org from the project',
  (SELECT count(*) FROM public.project_assets WHERE project_id = :LP1 AND org_id = :L)
    || '/' || (SELECT count(*) FROM public.project_assets WHERE project_id = :XP1 AND org_id = :L2)
    || '/' || (SELECT count(*) FROM public.project_assets WHERE project_id = :PP1 AND org_id IS NULL),
  '7/1/1');
SELECT public.check_eq('a producer file defaults to normal sensitivity',
  (SELECT sensitivity FROM public.project_assets WHERE project_id = :PP1), 'normal');
SELECT public.check_eq('the same-owner trigger fires on INSERT and on UPDATE OF user_id, project_id, org_id',
  (SELECT string_agg(c.event_object_column::text, ',' ORDER BY c.event_object_column)
   FROM information_schema.triggered_update_columns c
   WHERE c.event_object_table = 'project_assets' AND c.trigger_name = 'project_assets_same_owner'),
  'org_id,project_id,user_id');
SELECT public.check_eq('project_assets policies: the two 127 owner policies, 143''s read and guard',
  (SELECT string_agg(policyname || '=' || permissive || '/' || cmd, ' ' ORDER BY policyname)
   FROM pg_policies WHERE schemaname = 'public' AND tablename = 'project_assets'),
  'org_member_guard=RESTRICTIVE/SELECT org_member_read=PERMISSIVE/SELECT project_assets_owner_select=PERMISSIVE/SELECT project_assets_owner_write=PERMISSIVE/ALL');
SELECT public.check_eq('track_stem_files policies: the 080 owner policy and the guard',
  (SELECT string_agg(policyname || '=' || permissive || '/' || cmd, ' ' ORDER BY policyname)
   FROM pg_policies WHERE schemaname = 'public' AND tablename = 'track_stem_files'),
  'org_member_guard=RESTRICTIVE/SELECT track_stem_files_owner=PERMISSIVE/ALL');


-- ── Data rules (every role, so asserted as the service role) ────────────

SET ROLE service_role;
SELECT public.check_raises('an org file carrying a user_id is refused',
  $$INSERT INTO public.project_assets (user_id, project_id, kind, url) VALUES ('a1430000-0000-4000-8000-000000000001', 'd1430000-0000-4000-8000-000000000011', 'artwork', 'r2://x')$$,
  'an organization file has no owner');
SELECT public.check_raises('an org_id that is not the project''s org is refused',
  $$INSERT INTO public.project_assets (user_id, org_id, project_id, kind, url) VALUES (NULL, 'b1430000-0000-4000-8000-000000000002', 'd1430000-0000-4000-8000-000000000011', 'artwork', 'r2://x')$$,
  'must be the project''s organization');
SELECT public.check_raises('an org file cannot move to another org''s project',
  $$UPDATE public.project_assets SET project_id = 'd1430000-0000-4000-8000-000000000021' WHERE kind = 'photo'$$,
  'cannot move between organizations');
SELECT public.check_raises('… nor to a producer project',
  $$UPDATE public.project_assets SET project_id = 'd1430000-0000-4000-8000-000000000001' WHERE kind = 'photo'$$,
  'cannot move between organizations');
SELECT public.check_raises('… nor have its org rewritten',
  $$UPDATE public.project_assets SET org_id = 'b1430000-0000-4000-8000-000000000002' WHERE kind = 'photo'$$,
  'must be the project''s organization');
SELECT public.check_raises('a producer file cannot move into an org project',
  $$UPDATE public.project_assets SET project_id = 'd1430000-0000-4000-8000-000000000011' WHERE project_id = 'd1430000-0000-4000-8000-000000000001'$$,
  'cannot move between organizations');
SELECT public.check_raises('a producer file without a user_id is refused',
  $$INSERT INTO public.project_assets (user_id, project_id, kind, url) VALUES (NULL, 'd1430000-0000-4000-8000-000000000001', 'artwork', 'r2://x')$$,
  'is not owned by');
SELECT public.check_raises('a contract is always restricted',
  $$INSERT INTO public.project_assets (user_id, project_id, kind, sensitivity, url) VALUES (NULL, 'd1430000-0000-4000-8000-000000000011', 'contract', 'normal', 'r2://x')$$,
  'project_assets_restricted_kinds');
SELECT public.check_raises('… and so is a split sheet, by default too',
  $$INSERT INTO public.project_assets (user_id, project_id, kind, url) VALUES (NULL, 'd1430000-0000-4000-8000-000000000011', 'split_sheet', 'r2://x')$$,
  'project_assets_restricted_kinds');
SELECT public.check_raises('a restricted file is never in a portal',
  $$UPDATE public.project_assets SET in_portal = true WHERE kind = 'document' AND sensitivity = 'restricted'$$,
  'project_assets_restricted_not_in_portal');
SELECT public.check_raises('an unknown sensitivity is refused',
  $$INSERT INTO public.project_assets (user_id, project_id, kind, sensitivity, url) VALUES (NULL, 'd1430000-0000-4000-8000-000000000011', 'artwork', 'secret', 'r2://x')$$,
  'project_assets_sensitivity_check');
SELECT public.check_raises('an unknown kind is refused',
  $$INSERT INTO public.project_assets (user_id, project_id, kind, url) VALUES (NULL, 'd1430000-0000-4000-8000-000000000011', 'script', 'r2://x')$$,
  'project_assets_kind_check');
SELECT public.check_ok('the new kinds are accepted (session, normal)',
  $$INSERT INTO public.project_assets (user_id, project_id, kind, url, label) VALUES (NULL, 'd1430000-0000-4000-8000-000000000011', 'session', 'r2://y', 'tmp')$$);
DELETE FROM public.project_assets WHERE label = 'tmp';
SELECT public.check_ok('a label, position or sensitivity edit of an org file is fine',
  $$UPDATE public.project_assets SET label = 'Cover', position = 3 WHERE kind = 'artwork' AND project_id = 'd1430000-0000-4000-8000-000000000011'$$);
RESET ROLE;

-- ── Reads: sensitivity × role (06 §2.4, D4) ─────────────────────────────

SET ROLE authenticated;
SELECT public.as_user(:O);
SELECT public.check_eq('owner: every file of L, nothing of L2 or the producer',
  public.visible_files(), 'artwork,contract*,document*,photo,session,split_sheet*,video');
SELECT public.as_user(:AR);
SELECT public.check_eq('A&R: all the music and working material, no legal',
  public.visible_files(), 'artwork,photo,session,video');
SELECT public.as_user(:MKT);
SELECT public.check_eq('marketing: finished material only — no session, no contracts',
  public.visible_files(), 'artwork,photo,video');
SELECT public.as_user(:LEG);
SELECT public.check_eq('legal: contracts and split sheets; not working material, so not the restricted document either',
  public.visible_files(), 'artwork,contract*,photo,split_sheet*,video');
SELECT public.as_user(:SC);
SELECT public.check_eq('A&R scoped to another artist: nothing of C1''s project',
  public.visible_files(), '');
SELECT public.as_user(:ART);
SELECT public.check_eq('roster artist C1: their project''s files, never the restricted ones',
  public.visible_files(), 'artwork,photo,session,video');
SELECT public.as_user(:X);
SELECT public.check_eq('L2''s owner: only L2''s file',
  public.visible_files(), 'artwork@L2');
SELECT public.as_user(:P);
SELECT public.check_eq('the producer (no member): their own file only, as before',
  public.visible_files(), 'lyrics');
RESET ROLE;
SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
SELECT public.check_eq('anon: nothing', public.visible_files(), '');
SELECT public.check_eq('anon: the class helper answers false even for artwork',
  public.labelos_org_asset_allowed('b1430000-0000-4000-8000-000000000001', 'artwork', 'normal'), false);
RESET ROLE;

-- A tweak cannot hand a roster artist contracts (NEVER_GRANTABLE, 136).
UPDATE public.org_members SET cap_grants = '{contracts.read}' WHERE user_id = :ART AND org_id = :L;
SET ROLE authenticated;
SELECT public.as_user(:ART);
SELECT public.check_eq('a contracts.read grant on a roster artist changes nothing',
  public.visible_files(), 'artwork,photo,session,video');
RESET ROLE;
UPDATE public.org_members SET cap_grants = '{}' WHERE user_id = :ART AND org_id = :L;

-- Revoking contracts.read from legal hides the restricted files at once.
UPDATE public.org_members SET cap_revokes = '{contracts.read}' WHERE user_id = :LEG AND org_id = :L;
SET ROLE authenticated;
SELECT public.as_user(:LEG);
SELECT public.check_eq('legal without contracts.read: no restricted file',
  public.visible_files(), 'artwork,photo,video');
RESET ROLE;
UPDATE public.org_members SET cap_revokes = '{}' WHERE user_id = :LEG AND org_id = :L;

-- Leaving the org: the uploader of the contract (LEG is its created_by)
-- reads nothing of it afterwards.
DELETE FROM public.org_members WHERE user_id = :LEG AND org_id = :L;
SET ROLE authenticated;
SELECT public.as_user(:LEG);
SELECT public.check_eq('legal removed from L: nothing, not even what they uploaded', public.visible_files(), '');
RESET ROLE;
INSERT INTO public.org_members (org_id, user_id, role, functions, scope) VALUES (:L, :LEG, 'member', '{legal}', 'org');

-- ── Writes through the API roles ────────────────────────────────────────

SET ROLE authenticated;
SELECT public.as_user(:P);
SELECT public.check_ok('the producer adds a file to their own project, as before',
  $$INSERT INTO public.project_assets (user_id, project_id, kind, url, label) VALUES ('0b0e1a57-0000-4000-8000-000000000001', 'd1430000-0000-4000-8000-000000000001', 'artwork', 'r2://private/project-assets/p2', 'P cover')$$);
SELECT public.check_eq('… renames it',
  public.rows_changed($$UPDATE public.project_assets SET label = 'P cover 2' WHERE label = 'P cover'$$), 1);
SELECT public.check_eq('… and deletes it',
  public.rows_changed($$DELETE FROM public.project_assets WHERE label = 'P cover 2'$$), 1);
SELECT public.check_raises('the producer cannot put a file on an org project',
  $$INSERT INTO public.project_assets (user_id, project_id, kind, url) VALUES ('0b0e1a57-0000-4000-8000-000000000001', 'd1430000-0000-4000-8000-000000000011', 'artwork', 'r2://x')$$,
  'written through /api/org only|row-level security|has no owner');
SELECT public.as_user(:O);
SELECT public.check_raises('the org owner cannot write an org file through PostgREST',
  $$INSERT INTO public.project_assets (user_id, project_id, kind, url) VALUES (NULL, 'd1430000-0000-4000-8000-000000000011', 'artwork', 'r2://x')$$,
  'written through /api/org only|row-level security');
SELECT public.check_eq('… nor change one (no write policy matches an ownerless row)',
  public.rows_changed($$UPDATE public.project_assets SET label = 'hijacked' WHERE kind = 'document'$$), 0);
SELECT public.check_eq('… nor delete one (not theirs under any write policy)',
  public.rows_changed($$DELETE FROM public.project_assets WHERE kind = 'contract'$$), 0);
RESET ROLE;
SELECT public.check_eq('every org file is still there',
  (SELECT count(*) FROM public.project_assets WHERE org_id IS NOT NULL), 8::bigint);

-- ── track_stem_files (carried from LABEL-13) ────────────────────────────

SET ROLE authenticated;
SELECT public.as_user(:AR);
SELECT public.check_eq('an org track''s stem file is hidden, even from the member whose user_id it carries',
  (SELECT count(*) FROM public.track_stem_files), 0::bigint);
SELECT public.check_raises('… and cannot be written through PostgREST',
  $$INSERT INTO public.track_stem_files (track_id, user_id, label, url) VALUES ('e1430000-0000-4000-8000-000000000011', 'a1430000-0000-4000-8000-000000000002', 'x', 'r2://x')$$,
  'written through /api/org only');
SELECT public.check_eq('… nor deleted',
  public.rows_changed($$DELETE FROM public.track_stem_files WHERE label = 'Nova vocals'$$), 0);
SELECT public.as_user(:P);
SELECT public.check_eq('the producer reads their own stem files, as before',
  (SELECT string_agg(label, ',') FROM public.track_stem_files), 'P drums');
SELECT public.check_ok('… and adds one',
  $$INSERT INTO public.track_stem_files (track_id, user_id, label, url) VALUES ('e1430000-0000-4000-8000-000000000001', '0b0e1a57-0000-4000-8000-000000000001', 'P bass', 'r2://private/p-bass')$$);
RESET ROLE;
SELECT public.check_eq('the org stem file is untouched',
  (SELECT count(*) FROM public.track_stem_files WHERE track_id = :LS1), 1::bigint);
