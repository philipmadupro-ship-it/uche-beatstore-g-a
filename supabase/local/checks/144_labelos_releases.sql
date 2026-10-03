-- Behaviour checks for 144_labelos_releases.sql, run by
-- scripts/local-db/check.sh (npm run db:local:check) in its own copy of the
-- throwaway database. Every check RAISEs on failure; psql stops at the first.
-- Statements run in autocommit, so the deferred position checks fire at each
-- statement's COMMIT; where a check must SEE that failure, it runs inside a
-- transaction with SET CONSTRAINTS ALL IMMEDIATE.
--
-- Cast (seed: producer P with a creator_profiles row):
--   label L : owner O; AR (A&R, scope org: release.write); MKT (marketing:
--             catalogue read + finished audio, no release.write, no working
--             audio); SC (A&R scoped to artist C2 only); ART (roster artist C1)
--   label L2: owner X
--   P is the producer and no member of either org.
--
-- Rows (org rows as the service role writes them: no user_id):
--   L : artists C1 (Nova), C2 (Kilo). LP1 = Nova's project (project_contacts),
--       LP2 = Kilo's Inbox. In LP1: song S1 with a master M1, a version V1
--       and a demo D1 linked from it; beat B1; song S3 (on no release). In
--       LP2: song S2. Files: LP1 artwork A1, LP1 contract A2, LP2 artwork A3.
--   L2: artist CX, project XP1, song XS1.
--   P : project PP1, contact PC, song PS1.

\set P   '''0b0e1a57-0000-4000-8000-000000000001'''
\set O   '''a1440000-0000-4000-8000-000000000001'''
\set AR  '''a1440000-0000-4000-8000-000000000002'''
\set MKT '''a1440000-0000-4000-8000-000000000003'''
\set SC  '''a1440000-0000-4000-8000-000000000005'''
\set ART '''a1440000-0000-4000-8000-000000000006'''
\set X   '''a1440000-0000-4000-8000-000000000007'''
\set L   '''b1440000-0000-4000-8000-000000000001'''
\set L2  '''b1440000-0000-4000-8000-000000000002'''
\set C1  '''c1440000-0000-4000-8000-0000000000c1'''
\set C2  '''c1440000-0000-4000-8000-0000000000c2'''
\set CX  '''c1440000-0000-4000-8000-0000000000c3'''
\set PC  '''c1440000-0000-4000-8000-0000000000c4'''
\set PP1 '''d1440000-0000-4000-8000-000000000001'''
\set LP1 '''d1440000-0000-4000-8000-000000000011'''
\set LP2 '''d1440000-0000-4000-8000-000000000012'''
\set XP1 '''d1440000-0000-4000-8000-000000000021'''
\set PS1 '''e1440000-0000-4000-8000-000000000001'''
\set S1  '''e1440000-0000-4000-8000-000000000011'''
\set M1  '''e1440000-0000-4000-8000-000000000012'''
\set V1  '''e1440000-0000-4000-8000-000000000013'''
\set D1  '''e1440000-0000-4000-8000-000000000014'''
\set B1  '''e1440000-0000-4000-8000-000000000015'''
\set S3  '''e1440000-0000-4000-8000-000000000016'''
\set S2  '''e1440000-0000-4000-8000-000000000017'''
\set XS1 '''e1440000-0000-4000-8000-000000000021'''
\set A1  '''f1440000-0000-4000-8000-000000000001'''
\set A2  '''f1440000-0000-4000-8000-000000000002'''
\set A3  '''f1440000-0000-4000-8000-000000000003'''
\set R1  '''91440000-0000-4000-8000-000000000001'''
\set R2  '''91440000-0000-4000-8000-000000000002'''
\set RX  '''91440000-0000-4000-8000-000000000003'''

INSERT INTO auth.users (id, email) VALUES
  (:O, 'o144@local.test'), (:AR, 'ar144@local.test'), (:MKT, 'mkt144@local.test'),
  (:SC, 'sc144@local.test'), (:ART, 'art144@local.test'), (:X, 'x144@local.test');
INSERT INTO public.organizations (id, name, slug, kind, created_by) VALUES
  (:L, 'Label L', 'label-l-144', 'label', :O),
  (:L2, 'Label L2', 'label-l2-144', 'label', :X);
INSERT INTO public.org_members (org_id, user_id, role, functions, scope) VALUES
  (:L, :O, 'owner', '{}', 'org'),
  (:L, :AR, 'member', '{a_and_r}', 'org'),
  (:L, :MKT, 'member', '{marketing}', 'org'),
  (:L, :SC, 'member', '{a_and_r}', 'artists'),
  (:L, :ART, 'artist', '{}', 'artists'),
  (:L2, :X, 'owner', '{}', 'org');
INSERT INTO public.contacts (id, user_id, org_id, name, email, category) VALUES
  (:C1, NULL, :L, 'Nova', 'nova144@local.test', 'artist'),
  (:C2, NULL, :L, 'Kilo', 'kilo144@local.test', 'artist'),
  (:CX, NULL, :L2, 'Xen', 'xen144@local.test', 'artist'),
  (:PC, :P, NULL, 'P artist', 'pc144@local.test', 'artist');
INSERT INTO public.member_artist_scopes (org_id, user_id, contact_id) VALUES
  (:L, :SC, :C2), (:L, :ART, :C1);

INSERT INTO public.projects (id, user_id, name) VALUES (:PP1, :P, 'P project');
INSERT INTO public.tracks (id, user_id, title, type, audio_url) VALUES (:PS1, :P, 'P song', 'song', 'r2://private/p1');

INSERT INTO public.projects (id, user_id, org_id, name, inbox_for_contact_id) VALUES
  (:LP1, NULL, :L, 'Nova EP', NULL),
  (:LP2, NULL, :L, 'Inbox · Kilo', :C2),
  (:XP1, NULL, :L2, 'L2 project', NULL);
INSERT INTO public.project_contacts (user_id, project_id, contact_id, role) VALUES (:O, :LP1, :C1, 'artist');
INSERT INTO public.tracks (id, user_id, org_id, created_by, title, type, audio_url, song_stage) VALUES
  (:S1, NULL, :L, :AR, 'Nova single', 'song', 'r2://private/orgs/l/s1', 'inbox'),
  (:M1, NULL, :L, :AR, 'Nova single (master)', 'song', 'r2://private/orgs/l/m1', NULL),
  (:V1, NULL, :L, :AR, 'Nova single (radio)', 'song', 'r2://private/orgs/l/v1', NULL),
  (:D1, NULL, :L, :AR, 'Nova single (demo)', 'song', 'r2://private/orgs/l/d1', NULL),
  (:B1, NULL, :L, :AR, 'Nova beat', 'beat', 'r2://private/orgs/l/b1', NULL),
  (:S3, NULL, :L, :AR, 'Nova B-side', 'song', 'r2://private/orgs/l/s3', 'inbox'),
  (:S2, NULL, :L, :AR, 'Kilo single', 'song', 'r2://private/orgs/l/s2', 'inbox'),
  (:XS1, NULL, :L2, :X, 'Xen single', 'song', 'r2://private/orgs/l2/xs1', 'inbox');
INSERT INTO public.project_tracks (project_id, track_id, position) VALUES
  (:LP1, :S1, 0), (:LP1, :M1, 1), (:LP1, :V1, 2), (:LP1, :D1, 3), (:LP1, :B1, 4), (:LP1, :S3, 5),
  (:LP2, :S2, 0), (:XP1, :XS1, 0);
INSERT INTO public.track_links (from_track_id, to_track_id, user_id, relation) VALUES
  (:S1, :M1, NULL, 'master'), (:S1, :V1, NULL, 'version'), (:S1, :D1, NULL, 'demo');
INSERT INTO public.project_assets (id, user_id, created_by, project_id, kind, sensitivity, url) VALUES
  (:A1, NULL, :O, :LP1, 'artwork', 'normal', 'r2://private/orgs/l/assets/a1'),
  (:A2, NULL, :O, :LP1, 'contract', 'restricted', 'r2://private/orgs/l/assets/a2'),
  (:A3, NULL, :O, :LP2, 'artwork', 'normal', 'r2://private/orgs/l/assets/a3');

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
-- The releases the caller reads (titles), and their items as title:position.
CREATE FUNCTION public.visible_releases() RETURNS text
LANGUAGE sql AS $$
  SELECT coalesce(string_agg(r.title, ',' ORDER BY r.title), '') FROM public.releases r
$$;
CREATE FUNCTION public.visible_items() RETURNS text
LANGUAGE sql AS $$
  SELECT coalesce(string_agg(r.title || ':' || i.position, ',' ORDER BY r.title, i.position), '')
  FROM public.release_items i JOIN public.releases r ON r.id = i.release_id
$$;
-- Every item regardless of RLS, as title:position=song/master (short names).
CREATE FUNCTION public.tracklist(p_release uuid) RETURNS text
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT coalesce(string_agg(i.position || '=' || s.title || '/' || m.title, ' | ' ORDER BY i.position), '')
  FROM public.release_items i
  JOIN public.tracks s ON s.id = i.song_track_id
  JOIN public.tracks m ON m.id = i.master_track_id
  WHERE i.release_id = p_release
$$;
GRANT EXECUTE ON FUNCTION public.check_eq(text, anyelement, anyelement), public.check_raises(text, text, text),
  public.check_ok(text, text), public.rows_changed(text), public.as_user(text), public.visible_releases(),
  public.visible_items(), public.tracklist(uuid)
  TO anon, authenticated, service_role;

-- ── Schema ──────────────────────────────────────────────────────────────

SELECT public.check_eq('RLS is on for both tables',
  (SELECT string_agg(relname || '=' || relrowsecurity, ',' ORDER BY relname) FROM pg_class
   WHERE relnamespace = 'public'::regnamespace AND relname IN ('releases', 'release_items')),
  'release_items=true,releases=true');
SELECT public.check_eq('one SELECT policy each, nothing else',
  (SELECT string_agg(tablename || '.' || policyname || '=' || permissive || '/' || cmd || '/' || array_to_string(roles, '+'), ' ' ORDER BY tablename)
   FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('releases', 'release_items')),
  'release_items.org_member_read=PERMISSIVE/SELECT/authenticated releases.org_member_read=PERMISSIVE/SELECT/authenticated');
SELECT public.check_eq('neither table has a user_id column',
  (SELECT count(*) FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name IN ('releases', 'release_items') AND column_name = 'user_id'), 0::bigint);
SELECT public.check_eq('org_id is NOT NULL on both',
  (SELECT string_agg(table_name || '=' || is_nullable, ',' ORDER BY table_name) FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name IN ('releases', 'release_items') AND column_name = 'org_id'),
  'release_items=NO,releases=NO');
SELECT public.check_eq('the position check is deferred to COMMIT',
  (SELECT tgdeferrable::text || '/' || tginitdeferred::text FROM pg_trigger WHERE tgname = 'release_items_contiguous'),
  'true/true');

-- ── Data rules (as the service role, which every /api/org route uses) ───

SET ROLE service_role;
INSERT INTO public.releases (id, org_id, project_id, contact_id, title, type, artwork_asset_id, created_by) VALUES
  (:R1, :L, :LP1, :C1, 'Nova EP', 'ep', :A1, :AR),
  (:R2, :L, :LP2, :C2, 'Kilo single', 'single', NULL, :AR),
  (:RX, :L2, :XP1, :CX, 'Xen single', 'single', NULL, :X);
INSERT INTO public.release_items (release_id, position, song_track_id, master_track_id) VALUES
  (:R1, 1, :S1, :M1),
  (:R1, 2, :S1, :V1),
  (:R2, 1, :S2, :S2),
  (:RX, 1, :XS1, :XS1);
SELECT public.check_eq('items took their org from the release',
  (SELECT string_agg(DISTINCT (org_id = 'b1440000-0000-4000-8000-000000000001')::text, ',') FROM public.release_items
   WHERE release_id <> '91440000-0000-4000-8000-000000000003'), 'true');

SELECT public.check_raises('a release on a producer project is refused',
  $$INSERT INTO public.releases (org_id, project_id, contact_id, title) VALUES ('b1440000-0000-4000-8000-000000000001', 'd1440000-0000-4000-8000-000000000001', 'c1440000-0000-4000-8000-0000000000c1', 'x')$$,
  'project must be of the release''s organization');
SELECT public.check_raises('… or on another org''s project',
  $$INSERT INTO public.releases (org_id, project_id, contact_id, title) VALUES ('b1440000-0000-4000-8000-000000000001', 'd1440000-0000-4000-8000-000000000021', 'c1440000-0000-4000-8000-0000000000c1', 'x')$$,
  'project must be of the release''s organization');
SELECT public.check_raises('the artist must be a contact of the org (not L2''s)',
  $$INSERT INTO public.releases (org_id, project_id, contact_id, title) VALUES ('b1440000-0000-4000-8000-000000000001', 'd1440000-0000-4000-8000-000000000011', 'c1440000-0000-4000-8000-0000000000c3', 'x')$$,
  'artist must be a contact');
SELECT public.check_raises('… nor the producer''s',
  $$INSERT INTO public.releases (org_id, project_id, contact_id, title) VALUES ('b1440000-0000-4000-8000-000000000001', 'd1440000-0000-4000-8000-000000000011', 'c1440000-0000-4000-8000-0000000000c4', 'x')$$,
  'artist must be a contact');
SELECT public.check_raises('artwork from another project of the org is refused',
  $$UPDATE public.releases SET artwork_asset_id = 'f1440000-0000-4000-8000-000000000003' WHERE id = '91440000-0000-4000-8000-000000000001'$$,
  'artwork must be an artwork or photo file');
SELECT public.check_raises('a contract is not artwork',
  $$UPDATE public.releases SET artwork_asset_id = 'f1440000-0000-4000-8000-000000000002' WHERE id = '91440000-0000-4000-8000-000000000001'$$,
  'artwork must be an artwork or photo file');
SELECT public.check_raises('a release cannot change project',
  $$UPDATE public.releases SET project_id = 'd1440000-0000-4000-8000-000000000012' WHERE id = '91440000-0000-4000-8000-000000000001'$$,
  'keeps its project');
SELECT public.check_raises('… nor org',
  $$UPDATE public.releases SET org_id = 'b1440000-0000-4000-8000-000000000002' WHERE id = '91440000-0000-4000-8000-000000000001'$$,
  'cannot move between organizations');
SELECT public.check_raises('the UPC CHECK',
  $$UPDATE public.releases SET upc = '12345' WHERE id = '91440000-0000-4000-8000-000000000001'$$,
  'releases_upc_format');
SELECT public.check_ok('a 12-digit UPC',
  $$UPDATE public.releases SET upc = '036000291452' WHERE id = '91440000-0000-4000-8000-000000000001'$$);
SELECT public.check_raises('an unknown type',
  $$UPDATE public.releases SET type = 'boxset' WHERE id = '91440000-0000-4000-8000-000000000001'$$,
  'releases_type_check');
SELECT public.check_raises('a draft cannot be listed on the store (unreleased stays private)',
  $$UPDATE public.releases SET store_listed = true, store_listed_at = now() WHERE id = '91440000-0000-4000-8000-000000000001'$$,
  'releases_store_listed_released');
SELECT public.check_raises('delivered needs delivered_at',
  $$UPDATE public.releases SET state = 'delivered' WHERE id = '91440000-0000-4000-8000-000000000001'$$,
  'releases_delivered_at');

-- Items: song type, master relation.
SELECT public.check_raises('a beat is not a song',
  $$INSERT INTO public.release_items (release_id, position, song_track_id, master_track_id) VALUES ('91440000-0000-4000-8000-000000000001', 3, 'e1440000-0000-4000-8000-000000000015', 'e1440000-0000-4000-8000-000000000015')$$,
  'only a song of the release''s organization');
SELECT public.check_raises('a producer song never goes on an org release',
  $$INSERT INTO public.release_items (release_id, position, song_track_id, master_track_id) VALUES ('91440000-0000-4000-8000-000000000001', 3, 'e1440000-0000-4000-8000-000000000001', 'e1440000-0000-4000-8000-000000000001')$$,
  'only a song of the release''s organization');
SELECT public.check_raises('… nor another org''s song',
  $$INSERT INTO public.release_items (release_id, position, song_track_id, master_track_id) VALUES ('91440000-0000-4000-8000-000000000001', 3, 'e1440000-0000-4000-8000-000000000021', 'e1440000-0000-4000-8000-000000000021')$$,
  'only a song of the release''s organization');
SELECT public.check_raises('a demo is not a master',
  $$INSERT INTO public.release_items (release_id, position, song_track_id, master_track_id) VALUES ('91440000-0000-4000-8000-000000000001', 3, 'e1440000-0000-4000-8000-000000000011', 'e1440000-0000-4000-8000-000000000014')$$,
  'master must be the song itself or linked');
SELECT public.check_raises('an unlinked song is not this song''s master',
  $$INSERT INTO public.release_items (release_id, position, song_track_id, master_track_id) VALUES ('91440000-0000-4000-8000-000000000001', 3, 'e1440000-0000-4000-8000-000000000011', 'e1440000-0000-4000-8000-000000000016')$$,
  'master must be the song itself or linked');
SELECT public.check_raises('an item stays on its release',
  $$UPDATE public.release_items SET release_id = '91440000-0000-4000-8000-000000000002' WHERE song_track_id = 'e1440000-0000-4000-8000-000000000011' AND position = 2$$,
  'stays on its release');
SELECT public.check_raises('an item''s org is its release''s',
  $$UPDATE public.release_items SET org_id = 'b1440000-0000-4000-8000-000000000002' WHERE song_track_id = 'e1440000-0000-4000-8000-000000000011' AND position = 2$$,
  'must be the release''s organization');

-- Positions: contiguous at COMMIT.
BEGIN;
SET CONSTRAINTS ALL IMMEDIATE;
SELECT public.check_raises('a gap is refused',
  $$INSERT INTO public.release_items (release_id, position, song_track_id, master_track_id) VALUES ('91440000-0000-4000-8000-000000000001', 4, 'e1440000-0000-4000-8000-000000000011', 'e1440000-0000-4000-8000-000000000011')$$,
  '1..n with no gap');
SELECT public.check_raises('a duplicate position is refused',
  $$INSERT INTO public.release_items (release_id, position, song_track_id, master_track_id) VALUES ('91440000-0000-4000-8000-000000000001', 2, 'e1440000-0000-4000-8000-000000000011', 'e1440000-0000-4000-8000-000000000011')$$,
  'release_items_position_key|1..n with no gap');
SELECT public.check_raises('deleting the first item without closing the gap is refused',
  $$DELETE FROM public.release_items WHERE release_id = '91440000-0000-4000-8000-000000000001' AND position = 1$$,
  '1..n with no gap');
SELECT public.check_raises('a zero position is refused',
  $$UPDATE public.release_items SET position = 0 WHERE release_id = '91440000-0000-4000-8000-000000000002'$$,
  'release_items_position_positive');
COMMIT;
SELECT public.check_ok('appending at n + 1 is fine',
  $$INSERT INTO public.release_items (release_id, position, song_track_id, master_track_id, version_title) VALUES ('91440000-0000-4000-8000-000000000001', 3, 'e1440000-0000-4000-8000-000000000011', 'e1440000-0000-4000-8000-000000000011', 'Album mix')$$);
SELECT public.check_eq('R1 tracklist',
  public.tracklist(:R1), '1=Nova single/Nova single (master) | 2=Nova single/Nova single (radio) | 3=Nova single/Nova single');

-- The two tracklist functions.
SELECT public.labelos_release_items_reorder(:L, :R1, ARRAY(
  SELECT id FROM public.release_items WHERE release_id = :R1 ORDER BY position DESC));
SELECT public.check_eq('reorder reversed the tracklist and kept it contiguous',
  public.tracklist(:R1), '1=Nova single/Nova single | 2=Nova single/Nova single (radio) | 3=Nova single/Nova single (master)');
SELECT public.check_raises('a reorder that leaves an item out is refused',
  $$SELECT public.labelos_release_items_reorder('b1440000-0000-4000-8000-000000000001', '91440000-0000-4000-8000-000000000001',
      ARRAY(SELECT id FROM public.release_items WHERE release_id = '91440000-0000-4000-8000-000000000001' AND position < 3))$$,
  'every item of the release exactly once');
SELECT public.check_raises('… or names one twice',
  $$SELECT public.labelos_release_items_reorder('b1440000-0000-4000-8000-000000000001', '91440000-0000-4000-8000-000000000001',
      ARRAY(SELECT id FROM public.release_items WHERE release_id = '91440000-0000-4000-8000-000000000001' AND position < 3)
      || ARRAY(SELECT id FROM public.release_items WHERE release_id = '91440000-0000-4000-8000-000000000001' AND position = 1))$$,
  'every item of the release exactly once');
SELECT public.check_raises('… or an item of another release',
  $$SELECT public.labelos_release_items_reorder('b1440000-0000-4000-8000-000000000001', '91440000-0000-4000-8000-000000000001',
      ARRAY(SELECT id FROM public.release_items WHERE release_id = '91440000-0000-4000-8000-000000000001' AND position < 3)
      || ARRAY(SELECT id FROM public.release_items WHERE release_id = '91440000-0000-4000-8000-000000000002'))$$,
  'every item of the release exactly once');
SELECT public.check_raises('a reorder through the wrong org is refused',
  $$SELECT public.labelos_release_items_reorder('b1440000-0000-4000-8000-000000000002', '91440000-0000-4000-8000-000000000001',
      ARRAY(SELECT id FROM public.release_items WHERE release_id = '91440000-0000-4000-8000-000000000001'))$$,
  'not found');
SELECT public.check_eq('removing through the wrong org changes nothing',
  public.labelos_release_item_remove(:L2, :R1, (SELECT id FROM public.release_items WHERE release_id = :R1 AND position = 2)), false);
SELECT public.check_eq('removing the middle item',
  public.labelos_release_item_remove(:L, :R1, (SELECT id FROM public.release_items WHERE release_id = :R1 AND position = 2)), true);
SELECT public.check_eq('… closes the gap',
  public.tracklist(:R1), '1=Nova single/Nova single | 2=Nova single/Nova single (master)');
SELECT public.check_eq('removing the first item',
  public.labelos_release_item_remove(:L, :R1, (SELECT id FROM public.release_items WHERE release_id = :R1 AND position = 1)), true);
SELECT public.check_eq('… leaves one item at position 1',
  public.tracklist(:R1), '1=Nova single/Nova single (master)');
SELECT public.check_eq('an unknown item is not removed',
  public.labelos_release_item_remove(:L, :R1, 'e1440000-0000-4000-8000-000000000099'), false);
INSERT INTO public.release_items (release_id, position, song_track_id, master_track_id) VALUES (:R1, 2, :S1, :V1);

-- Guards that keep the rules true afterwards.
SELECT public.check_raises('the release artwork cannot become a contract',
  $$UPDATE public.project_assets SET kind = 'document' WHERE id = 'f1440000-0000-4000-8000-000000000001'$$,
  'is a release''s artwork');
SELECT public.check_raises('… nor move to another project',
  $$UPDATE public.project_assets SET project_id = 'd1440000-0000-4000-8000-000000000012' WHERE id = 'f1440000-0000-4000-8000-000000000001'$$,
  'is a release''s artwork');
SELECT public.check_ok('… but may become a photo',
  $$UPDATE public.project_assets SET kind = 'photo' WHERE id = 'f1440000-0000-4000-8000-000000000001'$$);
SELECT public.check_raises('a song on a release stays a song',
  $$UPDATE public.tracks SET type = 'beat' WHERE id = 'e1440000-0000-4000-8000-000000000011'$$,
  'stays a song');
SELECT public.check_raises('the link that makes M1 a master cannot be removed',
  $$DELETE FROM public.track_links WHERE from_track_id = 'e1440000-0000-4000-8000-000000000011' AND to_track_id = 'e1440000-0000-4000-8000-000000000012'$$,
  'makes a track a release master');
SELECT public.check_raises('… nor turned into a demo',
  $$UPDATE public.track_links SET relation = 'demo' WHERE from_track_id = 'e1440000-0000-4000-8000-000000000011' AND to_track_id = 'e1440000-0000-4000-8000-000000000012'$$,
  'makes a track a release master');
SELECT public.check_ok('… but may become an instrumental link',
  $$UPDATE public.track_links SET relation = 'instrumental' WHERE from_track_id = 'e1440000-0000-4000-8000-000000000011' AND to_track_id = 'e1440000-0000-4000-8000-000000000012'$$);
UPDATE public.track_links SET relation = 'master' WHERE from_track_id = :S1 AND to_track_id = :M1;
SELECT public.check_ok('the demo link (no release uses it) is removed as before',
  $$DELETE FROM public.track_links WHERE from_track_id = 'e1440000-0000-4000-8000-000000000011' AND to_track_id = 'e1440000-0000-4000-8000-000000000014'$$);
SELECT public.check_raises('a track that is a release master cannot be deleted',
  $$DELETE FROM public.tracks WHERE id = 'e1440000-0000-4000-8000-000000000012'$$,
  'makes a track a release master|release_items');
RESET ROLE;

-- ── Ownerless org links (project_contacts) ──────────────────────────────

SET ROLE service_role;
SELECT public.check_ok('an org project links its artist with no owner',
  $$INSERT INTO public.project_contacts (user_id, project_id, contact_id, role) VALUES (NULL, 'd1440000-0000-4000-8000-000000000012', 'c1440000-0000-4000-8000-0000000000c2', 'artist')$$);
SELECT public.check_raises('a producer link without an owner is refused, as before',
  $$INSERT INTO public.project_contacts (user_id, project_id, contact_id) VALUES (NULL, 'd1440000-0000-4000-8000-000000000001', 'c1440000-0000-4000-8000-0000000000c4')$$,
  'is not owned by');
SELECT public.check_ok('a producer link with its owner is fine, as before',
  $$INSERT INTO public.project_contacts (user_id, project_id, contact_id) VALUES ('0b0e1a57-0000-4000-8000-000000000001', 'd1440000-0000-4000-8000-000000000001', 'c1440000-0000-4000-8000-0000000000c4')$$);
RESET ROLE;
SET ROLE authenticated;
SELECT public.as_user(:P);
SELECT public.check_eq('the producer reads their own link and never an ownerless org link',
  (SELECT string_agg(project_id::text, ',') FROM public.project_contacts), 'd1440000-0000-4000-8000-000000000001');
RESET ROLE;

-- ── "On a release" makes a mix finished (06 §2.3) ───────────────────────

SELECT public.check_eq('S1 (inbox, on a draft release) is finished',
  public.labelos_track_is_finished(:S1), true);
SELECT public.check_eq('S3 (inbox, on no release) is not',
  public.labelos_track_is_finished(:S3), false);
SELECT public.check_eq('M1 is finished as S1''s master, as before',
  public.labelos_track_is_finished(:M1), true);
SELECT public.check_eq('V1 (a version, chosen as an item''s master) is still working material',
  public.labelos_track_is_finished(:V1), false);
SELECT public.check_eq('S2 is finished while R2 is a draft',
  public.labelos_track_is_finished(:S2), true);
UPDATE public.releases SET state = 'cancelled' WHERE id = :R2;
SELECT public.check_eq('… and not once R2 is cancelled',
  public.labelos_track_is_finished(:S2), false);
UPDATE public.releases SET state = 'draft' WHERE id = :R2;
SELECT public.check_eq('a producer song is never finished by this rule',
  public.labelos_track_is_finished(:PS1), false);

-- ── Reads, as members (catalog.read + project scope) ────────────────────

SET ROLE authenticated;
SELECT public.as_user(:O);
SELECT public.check_eq('owner of L: both of L''s releases, nothing of L2', public.visible_releases(), 'Kilo single,Nova EP');
SELECT public.check_eq('… and their items', public.visible_items(), 'Kilo single:1,Nova EP:1,Nova EP:2');
SELECT public.as_user(:AR);
SELECT public.check_eq('A&R (release.write)', public.visible_releases(), 'Kilo single,Nova EP');
SELECT public.check_eq('A&R holds release.write', public.has_org_cap(:L, 'release.write'), true);
SELECT public.as_user(:MKT);
SELECT public.check_eq('marketing (read-only on releases) reads them too', public.visible_releases(), 'Kilo single,Nova EP');
SELECT public.check_eq('… without release.write', public.has_org_cap(:L, 'release.write'), false);
SELECT public.check_eq('marketing now reads S1''s row (a mix on a release is finished), not S3''s',
  (SELECT string_agg(title, ',' ORDER BY title) FROM public.tracks WHERE id IN (
    'e1440000-0000-4000-8000-000000000011', 'e1440000-0000-4000-8000-000000000016')),
  'Nova single');
SELECT public.as_user(:SC);
SELECT public.check_eq('A&R scoped to Kilo: only Kilo''s release', public.visible_releases(), 'Kilo single');
SELECT public.check_eq('… and only its items', public.visible_items(), 'Kilo single:1');
SELECT public.as_user(:ART);
SELECT public.check_eq('roster artist Nova: only Nova''s release', public.visible_releases(), 'Nova EP');
SELECT public.as_user(:X);
SELECT public.check_eq('L2''s owner: only L2''s release', public.visible_releases(), 'Xen single');
SELECT public.check_eq('… and its item', public.visible_items(), 'Xen single:1');
SELECT public.as_user(:P);
SELECT public.check_eq('the producer (no member): nothing', public.visible_releases(), '');
SELECT public.check_eq('… and still reads their own song, as before',
  (SELECT string_agg(title, ',') FROM public.tracks WHERE user_id = '0b0e1a57-0000-4000-8000-000000000001'::uuid AND title LIKE 'P %'),
  'P song');
RESET ROLE;
SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
SELECT public.check_eq('anon: no release', public.visible_releases(), '');
SELECT public.check_eq('anon: no item', public.visible_items(), '');
RESET ROLE;

-- Removing a member: nothing afterwards.
DELETE FROM public.org_members WHERE user_id = :MKT AND org_id = :L;
SET ROLE authenticated;
SELECT public.as_user(:MKT);
SELECT public.check_eq('marketing removed from L: no release', public.visible_releases(), '');
RESET ROLE;

-- ── Writes through the API roles: none ──────────────────────────────────

SET ROLE authenticated;
SELECT public.as_user(:O);
SELECT public.check_raises('the org owner cannot create a release through PostgREST',
  $$INSERT INTO public.releases (org_id, project_id, contact_id, title) VALUES ('b1440000-0000-4000-8000-000000000001', 'd1440000-0000-4000-8000-000000000011', 'c1440000-0000-4000-8000-0000000000c1', 'x')$$,
  'written through /api/org only|row-level security');
SELECT public.check_eq('… nor change one', public.rows_changed($$UPDATE public.releases SET title = 'hijacked'$$), 0);
SELECT public.check_eq('… nor delete one', public.rows_changed($$DELETE FROM public.releases$$), 0);
SELECT public.check_raises('… nor add an item',
  $$INSERT INTO public.release_items (release_id, position, song_track_id, master_track_id) VALUES ('91440000-0000-4000-8000-000000000001', 3, 'e1440000-0000-4000-8000-000000000011', 'e1440000-0000-4000-8000-000000000011')$$,
  'written through /api/org only|row-level security');
SELECT public.check_eq('… nor move or remove one',
  public.rows_changed($$UPDATE public.release_items SET explicit = true$$) + public.rows_changed($$DELETE FROM public.release_items$$), 0);
SELECT public.check_raises('… nor call the tracklist functions',
  $$SELECT public.labelos_release_items_reorder('b1440000-0000-4000-8000-000000000001', '91440000-0000-4000-8000-000000000001', '{}'::uuid[])$$,
  'permission denied');
SELECT public.check_raises('… either of them',
  $$SELECT public.labelos_release_item_remove('b1440000-0000-4000-8000-000000000001', '91440000-0000-4000-8000-000000000001', 'e1440000-0000-4000-8000-000000000011')$$,
  'permission denied');
RESET ROLE;
SET ROLE anon;
SELECT public.check_raises('anon cannot call them either',
  $$SELECT public.labelos_release_item_remove('b1440000-0000-4000-8000-000000000001', '91440000-0000-4000-8000-000000000001', 'e1440000-0000-4000-8000-000000000011')$$,
  'permission denied');
RESET ROLE;

-- ── The producer is unchanged ───────────────────────────────────────────

SET ROLE authenticated;
SELECT public.as_user(:P);
SELECT public.check_ok('the producer retypes their own song',
  $$UPDATE public.tracks SET type = 'beat' WHERE id = 'e1440000-0000-4000-8000-000000000001'$$);
SELECT public.check_ok('… and links and unlinks their own tracks',
  $$INSERT INTO public.tracks (id, user_id, title, type, audio_url) VALUES ('e1440000-0000-4000-8000-000000000002', '0b0e1a57-0000-4000-8000-000000000001', 'P loop', 'loop', 'r2://private/p2')$$);
SELECT public.check_ok('… link',
  $$INSERT INTO public.track_links (from_track_id, to_track_id, user_id, relation) VALUES ('e1440000-0000-4000-8000-000000000001', 'e1440000-0000-4000-8000-000000000002', '0b0e1a57-0000-4000-8000-000000000001', 'loop')$$);
SELECT public.check_eq('… unlink',
  public.rows_changed($$DELETE FROM public.track_links WHERE from_track_id = 'e1440000-0000-4000-8000-000000000001'$$), 1);
RESET ROLE;

-- ── Deleting ────────────────────────────────────────────────────────────

SET ROLE service_role;
SELECT public.check_eq('deleting a release',
  public.rows_changed($$DELETE FROM public.releases WHERE id = '91440000-0000-4000-8000-000000000001'$$), 1);
SELECT public.check_eq('… takes its items with it',
  (SELECT count(*) FROM public.release_items WHERE release_id = '91440000-0000-4000-8000-000000000001'), 0::bigint);
SELECT public.check_eq('… and leaves its project and files', (SELECT count(*) FROM public.project_assets WHERE project_id = 'd1440000-0000-4000-8000-000000000011'), 2::bigint);
SELECT public.check_ok('with the release gone, the master link can be removed',
  $$DELETE FROM public.track_links WHERE from_track_id = 'e1440000-0000-4000-8000-000000000011' AND to_track_id = 'e1440000-0000-4000-8000-000000000012'$$);
RESET ROLE;
-- Deleting an org removes its releases, items, tracks and links in one go
-- (the guards let a cascade through).
SELECT public.check_ok('deleting L2 cascades through its release',
  $$DELETE FROM public.organizations WHERE id = 'b1440000-0000-4000-8000-000000000002'$$);
SELECT public.check_eq('… which is gone', (SELECT count(*) FROM public.releases WHERE id = '91440000-0000-4000-8000-000000000003'), 0::bigint);
