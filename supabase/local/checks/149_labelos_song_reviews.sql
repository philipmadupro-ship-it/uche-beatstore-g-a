-- Behaviour checks for 149_labelos_song_reviews.sql (LABEL-25), run by
-- scripts/local-db/check.sh (npm run db:local:check) in its own copy of the
-- throwaway database. Every check RAISEs on failure; psql stops at the first.
--
-- What is proven, as `authenticated` with each member's own JWT claims (the
-- way PostgREST reads) — never only as the service role:
--   - two reviewers' reviews of one song coexist (one row per song+reviewer,
--     upsert by that key);
--   - the song's own artist reads EVERY review of their song (D5);
--   - ANOTHER artist of the same label reads none of it; a member limited to
--     some artists reads only their artists' songs; a whole-org member reads
--     the org's;
--   - another org's member, a non-member, the producer and anon read nothing
--     (anon without a permission error);
--   - nothing writes through the API roles (no policy, and 141's service-only
--     trigger), and the integrity trigger keeps a review on a song of its own
--     org and its identity fixed;
--   - the policy's set-based scope (labelos_scoped_tracks) agrees with the
--     per-track helper it replaces (can_see_org_track).
--   - an external project member (LABEL-21, 148: invited to a project, not an
--     org member) reads no review, even of a song in their own project.
--
-- Cast (seed: producer P):
--   label L : owner O; AR (A&R, whole org); SC (A&R scoped to artist C2);
--             ART (roster artist C1 Nova); ART2 (roster artist C2 Kilo)
--   label L2: owner X.   OUT is a member of nothing.
--   L : LP1 = Nova's project (project_contacts), LP2 = Kilo's Inbox,
--       LP3 = a project with no artist. Songs S1 in LP1, S2 in LP2, S3 in LP3.
--   L2: XS1 in XP1.

\set P    '''0b0e1a57-0000-4000-8000-000000000001'''
\set O    '''a1490000-0000-4000-8000-000000000001'''
\set AR   '''a1490000-0000-4000-8000-000000000002'''
\set SC   '''a1490000-0000-4000-8000-000000000003'''
\set ART  '''a1490000-0000-4000-8000-000000000004'''
\set ART2 '''a1490000-0000-4000-8000-000000000005'''
\set X    '''a1490000-0000-4000-8000-000000000006'''
\set OUT  '''a1490000-0000-4000-8000-000000000007'''
\set MK   '''a1490000-0000-4000-8000-000000000008'''
\set EXT  '''a1490000-0000-4000-8000-000000000009'''
\set L    '''b1490000-0000-4000-8000-000000000001'''
\set L2   '''b1490000-0000-4000-8000-000000000002'''
\set C1   '''c1490000-0000-4000-8000-0000000000c1'''
\set C2   '''c1490000-0000-4000-8000-0000000000c2'''
\set CX   '''c1490000-0000-4000-8000-0000000000c3'''
\set LP1  '''d1490000-0000-4000-8000-000000000011'''
\set LP2  '''d1490000-0000-4000-8000-000000000012'''
\set LP3  '''d1490000-0000-4000-8000-000000000013'''
\set XP1  '''d1490000-0000-4000-8000-000000000021'''
\set S1   '''e1490000-0000-4000-8000-000000000001'''
\set S2   '''e1490000-0000-4000-8000-000000000002'''
\set S3   '''e1490000-0000-4000-8000-000000000003'''
\set XS1  '''e1490000-0000-4000-8000-000000000004'''
\set BEAT '''e1490000-0000-4000-8000-000000000005'''
\set PS1  '''e1490000-0000-4000-8000-000000000006'''

INSERT INTO auth.users (id, email) VALUES
  (:O, 'o149@local.test'), (:AR, 'ar149@local.test'), (:SC, 'sc149@local.test'),
  (:ART, 'art149@local.test'), (:ART2, 'art2149@local.test'), (:MK, 'mk149@local.test'), (:EXT, 'ext149@local.test'), (:X, 'x149@local.test'), (:OUT, 'out149@local.test');
INSERT INTO public.organizations (id, name, slug, kind, created_by) VALUES
  (:L, 'Label L', 'label-l-149', 'label', :O),
  (:L2, 'Label L2', 'label-l2-149', 'label', :X);
INSERT INTO public.org_members (org_id, user_id, role, functions, scope) VALUES
  (:L, :O, 'owner', '{}', 'org'),
  (:L, :AR, 'member', '{a_and_r}', 'org'),
  (:L, :SC, 'member', '{a_and_r}', 'artists'),
  (:L, :ART, 'artist', '{}', 'artists'),
  (:L, :ART2, 'artist', '{}', 'artists'),
  (:L, :MK, 'member', '{marketing}', 'org'),
  (:L2, :X, 'owner', '{}', 'org');
INSERT INTO public.contacts (id, user_id, org_id, name, email, category) VALUES
  (:C1, NULL, :L, 'Nova', 'nova149@local.test', 'artist'),
  (:C2, NULL, :L, 'Kilo', 'kilo149@local.test', 'artist'),
  (:CX, NULL, :L2, 'Xen', 'xen149@local.test', 'artist');
INSERT INTO public.member_artist_scopes (org_id, user_id, contact_id) VALUES
  (:L, :SC, :C2), (:L, :ART, :C1), (:L, :ART2, :C2);
INSERT INTO public.projects (id, user_id, org_id, name, inbox_for_contact_id) VALUES
  (:LP1, NULL, :L, 'Nova EP', NULL),
  (:LP2, NULL, :L, 'Inbox · Kilo', :C2),
  (:LP3, NULL, :L, 'Unassigned', NULL),
  (:XP1, NULL, :L2, 'L2 project', NULL);
INSERT INTO public.project_contacts (user_id, project_id, contact_id, role) VALUES (NULL, :LP1, :C1, 'artist');
-- An external project member (LABEL-21, 148): invited to Nova's project, NOT a member of the org.
INSERT INTO public.project_members (org_id, project_id, user_id, role, allow_downloads, invited_by) VALUES
  (:L, :LP1, :EXT, 'editor', true, :O);
INSERT INTO public.tracks (id, user_id, org_id, created_by, title, type, audio_url, song_stage) VALUES
  (:S1, NULL, :L, :AR, 'Nova demo', 'song', 'r2://private/orgs/l/s1', 'in_review'),
  (:S2, NULL, :L, :AR, 'Kilo demo', 'song', 'r2://private/orgs/l/s2', 'inbox'),
  (:S3, NULL, :L, :AR, 'Loose demo', 'song', 'r2://private/orgs/l/s3', 'inbox'),
  (:XS1, NULL, :L2, :X, 'L2 demo', 'song', 'r2://private/orgs/l2/s1', 'inbox'),
  (:BEAT, NULL, :L, :AR, 'A beat', 'beat', 'r2://private/orgs/l/b1', NULL);
INSERT INTO public.tracks (id, user_id, title, type, audio_url) VALUES (:PS1, :P, 'P song', 'song', 'r2://private/p1');
INSERT INTO public.project_tracks (project_id, track_id, position) VALUES
  (:LP1, :S1, 0), (:LP2, :S2, 0), (:LP3, :S3, 0), (:XP1, :XS1, 0);

CREATE TABLE public.chk_lbl (id uuid PRIMARY KEY, name text NOT NULL);
GRANT SELECT ON public.chk_lbl TO anon, authenticated, service_role;
INSERT INTO public.chk_lbl VALUES
  (:S1, 'S1'), (:S2, 'S2'), (:S3, 'S3'), (:XS1, 'XS1'),
  (:O, 'O'), (:AR, 'AR'), (:SC, 'SC'), (:X, 'X');

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
-- The reviews the caller reads, as "song/reviewer", sorted.
CREATE FUNCTION public.visible_reviews() RETURNS text
LANGUAGE sql AS $$
  SELECT coalesce(string_agg(s.name || '/' || r.name, ',' ORDER BY s.name, r.name), '')
  FROM public.song_reviews v
  JOIN public.chk_lbl s ON s.id = v.track_id
  JOIN public.chk_lbl r ON r.id = v.reviewer_id
$$;
GRANT EXECUTE ON FUNCTION public.check_eq(text, anyelement, anyelement), public.check_raises(text, text, text),
  public.rows_changed(text), public.as_user(text), public.visible_reviews()
  TO anon, authenticated, service_role;

-- ── Schema ──────────────────────────────────────────────────────────────

SELECT public.check_eq('RLS is on for song_reviews',
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.song_reviews'::regclass), true);
SELECT public.check_eq('one policy, a SELECT — nothing writes through the API roles',
  (SELECT string_agg(policyname || '=' || permissive || '/' || cmd, ' ') FROM pg_policies WHERE schemaname = 'public' AND tablename = 'song_reviews'),
  'song_reviews_member_read=PERMISSIVE/SELECT');
SELECT public.check_eq('the policy keys on review.comment, org membership and the scoped-tracks set — and calls no per-row helper (R-08)',
  (SELECT qual ~ 'review\.comment' AND qual ~ 'org_members' AND qual ~ 'labelos_scoped_tracks'
          AND qual !~ 'can_see_org_track' AND qual !~ 'can_read_org_track' AND qual !~ 'can_see_org_project'
   FROM pg_policies WHERE tablename = 'song_reviews'), true);
SELECT public.check_eq('no user_id column: a review is an org row',
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'song_reviews' AND column_name = 'user_id'), 0::bigint);

-- ── Writes (as the service role: what /api/org does) ─────────────────────

INSERT INTO public.song_reviews (org_id, track_id, reviewer_id, rating, verdict, note) VALUES
  (:L, :S1, :AR, 4, 'shortlist', 'love the hook'),
  (:L, :S1, :O,  2, 'pass', NULL),
  (:L, :S2, :AR, 5, NULL, NULL),
  (:L, :S2, :SC, NULL, 'hold', 'needs a second verse'),
  (:L, :S3, :AR, 3, 'changes_requested', 'mix is thin'),
  (:L2, :XS1, :X, 1, 'pass', NULL);

SELECT public.check_eq('two reviewers of one song coexist',
  (SELECT count(*) FROM public.song_reviews WHERE track_id = :S1), 2::bigint);
-- The route's upsert: the same reviewer rewrites their own row, never someone else's.
INSERT INTO public.song_reviews (org_id, track_id, reviewer_id, rating, verdict, note)
  VALUES (:L, :S1, :AR, 5, 'shortlist', 'love the hook, still')
  ON CONFLICT (track_id, reviewer_id) DO UPDATE SET rating = EXCLUDED.rating, note = EXCLUDED.note, updated_at = now();
SELECT public.check_eq('upsert rewrites that reviewer''s row in place',
  (SELECT string_agg(reviewer_id::text || '=' || rating, ',' ORDER BY reviewer_id) FROM public.song_reviews WHERE track_id = :S1),
  'a1490000-0000-4000-8000-000000000001=2,a1490000-0000-4000-8000-000000000002=5');

-- ── Integrity ───────────────────────────────────────────────────────────

SELECT public.check_raises('a producer song cannot be reviewed in an org',
  $$INSERT INTO public.song_reviews (org_id, track_id, reviewer_id, rating) VALUES ('b1490000-0000-4000-8000-000000000001', 'e1490000-0000-4000-8000-000000000006', 'a1490000-0000-4000-8000-000000000002', 3)$$,
  'same organization');
SELECT public.check_raises('another org''s song cannot be reviewed under this org',
  $$INSERT INTO public.song_reviews (org_id, track_id, reviewer_id, rating) VALUES ('b1490000-0000-4000-8000-000000000001', 'e1490000-0000-4000-8000-000000000004', 'a1490000-0000-4000-8000-000000000002', 3)$$,
  'same organization');
SELECT public.check_raises('a beat is not a song',
  $$INSERT INTO public.song_reviews (org_id, track_id, reviewer_id, rating) VALUES ('b1490000-0000-4000-8000-000000000001', 'e1490000-0000-4000-8000-000000000005', 'a1490000-0000-4000-8000-000000000002', 3)$$,
  'same organization');
SELECT public.check_raises('a review keeps its song',
  $$UPDATE public.song_reviews SET track_id = 'e1490000-0000-4000-8000-000000000002' WHERE track_id = 'e1490000-0000-4000-8000-000000000003'$$,
  'keeps its organization, song and reviewer');
SELECT public.check_raises('a review keeps its reviewer',
  $$UPDATE public.song_reviews SET reviewer_id = 'a1490000-0000-4000-8000-000000000001' WHERE track_id = 'e1490000-0000-4000-8000-000000000003'$$,
  'keeps its organization, song and reviewer');
SELECT public.check_raises('rating 6 is refused',
  $$UPDATE public.song_reviews SET rating = 6 WHERE track_id = 'e1490000-0000-4000-8000-000000000003'$$, 'song_reviews_rating_check');
SELECT public.check_raises('an unknown verdict is refused',
  $$UPDATE public.song_reviews SET verdict = 'love' WHERE track_id = 'e1490000-0000-4000-8000-000000000003'$$, 'song_reviews_verdict_check');
SELECT public.check_raises('an empty review is not a row',
  $$UPDATE public.song_reviews SET rating = NULL, verdict = NULL, note = NULL WHERE track_id = 'e1490000-0000-4000-8000-000000000003'$$, 'song_reviews_not_empty');
SELECT public.check_raises('an over-long note is refused',
  $$UPDATE public.song_reviews SET note = repeat('x', 2001) WHERE track_id = 'e1490000-0000-4000-8000-000000000003'$$, 'song_reviews_note_check');

-- ── Reads, as members, with their own claims ────────────────────────────

SET ROLE authenticated;

SELECT public.as_user(:O);
SELECT public.check_eq('owner (whole org): every review of L, none of L2''s',
  public.visible_reviews(), 'S1/AR,S1/O,S2/AR,S2/SC,S3/AR');

SELECT public.as_user(:AR);
SELECT public.check_eq('A&R, whole org: every review of L',
  public.visible_reviews(), 'S1/AR,S1/O,S2/AR,S2/SC,S3/AR');

SELECT public.as_user(:SC);
SELECT public.check_eq('A&R scoped to Kilo: Kilo''s song only — both reviewers — nothing of Nova''s, nothing of the artist-less project',
  public.visible_reviews(), 'S2/AR,S2/SC');

SELECT public.as_user(:ART);
SELECT public.check_eq('roster artist Nova sees EVERY review of her song (D5): both reviewers, rating, verdict, note',
  public.visible_reviews(), 'S1/AR,S1/O');
SELECT public.check_eq('… with the notes',
  (SELECT string_agg(coalesce(note, '-'), '|' ORDER BY reviewer_id) FROM public.song_reviews WHERE track_id = :S1), '-|love the hook, still');

SELECT public.as_user(:ART2);
SELECT public.check_eq('ANOTHER artist of the same label (Kilo) sees only Kilo''s own song''s reviews',
  public.visible_reviews(), 'S2/AR,S2/SC');
SELECT public.check_eq('… and none of Nova''s song',
  (SELECT count(*) FROM public.song_reviews WHERE track_id = :S1), 0::bigint);
SELECT public.check_eq('… nor of the artist-less project''s song',
  (SELECT count(*) FROM public.song_reviews WHERE track_id = :S3), 0::bigint);

SELECT public.as_user(:MK);
SELECT public.check_eq('marketing (whole org, catalog.read, no review ability) reads no review, though it reads the catalogue',
  public.visible_reviews(), '');
SELECT public.check_eq('… although it does hold catalog.read: the gate is the review ability, not a broken scope',
  public.has_org_cap(:L, 'catalog.read') AND NOT public.has_org_cap(:L, 'review.comment'), true);

SELECT public.as_user(:EXT);
SELECT public.check_eq('an external project member (editor on Nova''s project, no org membership) reads no review — not even of the song in their project',
  public.visible_reviews(), '');
SELECT public.check_eq('… and the song in their project is S1, so the gate is the policy, not an empty project',
  (SELECT count(*) FROM public.project_members WHERE user_id = :EXT AND project_id = :LP1), 1::bigint);

SELECT public.as_user(:X);
SELECT public.check_eq('L2''s owner: only L2''s review', public.visible_reviews(), 'XS1/X');

SELECT public.as_user(:OUT);
SELECT public.check_eq('a user in no org: nothing', public.visible_reviews(), '');
SELECT public.as_user(:P);
SELECT public.check_eq('the producer, member of neither: nothing', public.visible_reviews(), '');

-- Nothing writes through the API roles.
SELECT public.as_user(:AR);
SELECT public.check_raises('a member cannot insert a review through the API roles',
  $$INSERT INTO public.song_reviews (org_id, track_id, reviewer_id, rating) VALUES ('b1490000-0000-4000-8000-000000000001', 'e1490000-0000-4000-8000-000000000001', 'a1490000-0000-4000-8000-000000000002', 1)$$,
  'written through /api/org only|row-level security|permission denied');
SELECT public.check_eq('… nor update their own (no write policy: the statement matches no row)',
  public.rows_changed($$UPDATE public.song_reviews SET rating = 1 WHERE reviewer_id = 'a1490000-0000-4000-8000-000000000002'$$), 0);
SELECT public.check_eq('… nor delete one',
  public.rows_changed($$DELETE FROM public.song_reviews WHERE reviewer_id = 'a1490000-0000-4000-8000-000000000002'$$), 0);
RESET ROLE;

SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
SELECT public.check_eq('anon: nothing, and no permission error', public.visible_reviews(), '');
RESET ROLE;

SELECT public.check_eq('the failed writes changed nothing', (SELECT count(*) FROM public.song_reviews), 6::bigint);

-- ── The set-based scope agrees with the per-track helper it replaces ────

SET ROLE authenticated;
SELECT public.as_user(:SC);
SELECT public.check_eq('scoped A&R: labelos_scoped_tracks() == the songs can_see_org_track admits',
  (SELECT string_agg(t.id::text, ',' ORDER BY t.id) FROM public.tracks t WHERE t.org_id = :L AND public.can_see_org_track(t.org_id, t.id)),
  (SELECT string_agg(st.track_id::text, ',' ORDER BY st.track_id) FROM public.labelos_scoped_tracks() st));
SELECT public.as_user(:ART);
SELECT public.check_eq('roster artist: labelos_scoped_tracks() == can_see_org_track (her song only)',
  (SELECT string_agg(t.id::text, ',' ORDER BY t.id) FROM public.tracks t WHERE t.org_id = :L AND public.can_see_org_track(t.org_id, t.id)),
  (SELECT string_agg(st.track_id::text, ',' ORDER BY st.track_id) FROM public.labelos_scoped_tracks() st));
SELECT public.as_user(:O);
SELECT public.check_eq('a whole-org owner has no scope rows, so the set is empty (the whole-org disjunct covers them)',
  (SELECT count(*) FROM public.labelos_scoped_tracks()), 0::bigint);
RESET ROLE;

-- ── Cascades ────────────────────────────────────────────────────────────

DELETE FROM public.tracks WHERE id = :S3;
SELECT public.check_eq('deleting a song deletes its reviews',
  (SELECT count(*) FROM public.song_reviews WHERE track_id = :S3), 0::bigint);
