-- Behaviour checks for 165_labelos_playlist_tracks_same_owner.sql (LABEL-44),
-- run by scripts/local-db/check.sh in its own copy of the throwaway database.
-- Every check RAISEs on failure; psql stops at the first.
--
-- Cast:
--   P1  a producer: playlist PL1, tracks T1 / T1b      P2  another producer: track T2
--   L   a label org: org song TO (no owner, 142)
-- Proven, as service_role (every server route), authenticated (the producer's
-- own JWT through 097's owner_via_playlist) and anon: a playlist takes only
-- its owner's own producer tracks; the producer's own add / reorder / remove
-- work exactly as before.

\set P1  '''a1650000-0000-4000-8000-000000000001'''
\set P2  '''a1650000-0000-4000-8000-000000000002'''
\set L   '''b1650000-0000-4000-8000-000000000001'''
\set PL1 '''c1650000-0000-4000-8000-000000000001'''
\set T1  '''e1650000-0000-4000-8000-000000000001'''
\set T1b '''e1650000-0000-4000-8000-000000000002'''
\set T2  '''e1650000-0000-4000-8000-000000000003'''
\set TO  '''e1650000-0000-4000-8000-000000000004'''

INSERT INTO auth.users (id, email) VALUES (:P1, 'p1-165@local.test'), (:P2, 'p2-165@local.test');
INSERT INTO public.organizations (id, name, slug, kind, created_by) VALUES (:L, 'Label 165', 'label-165', 'label', :P1);
INSERT INTO public.playlists (id, user_id, name) VALUES (:PL1, :P1, 'Outreach');
INSERT INTO public.tracks (id, user_id, title, type, audio_url) VALUES
  (:T1,  :P1, 'Mine',       'beat', 'r2://private/p1/t1'),
  (:T1b, :P1, 'Mine too',   'beat', 'r2://private/p1/t1b'),
  (:T2,  :P2, 'Not mine',   'beat', 'r2://private/p2/t2');
INSERT INTO public.tracks (id, user_id, org_id, created_by, title, type, audio_url, song_stage)
  VALUES (:TO, NULL, :L, :P1, 'Org song', 'song', 'r2://private/orgs/l/s', 'inbox');

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
GRANT EXECUTE ON FUNCTION public.check_eq(text, anyelement, anyelement), public.check_raises(text, text, text), public.as_user(text)
  TO anon, authenticated, service_role;

SELECT public.check_eq('the trigger is there, BEFORE INSERT OR UPDATE OF playlist_id, track_id',
  (SELECT pg_get_triggerdef(oid) ~ 'BEFORE INSERT OR UPDATE OF playlist_id, track_id ON public.playlist_tracks'
   FROM pg_trigger WHERE tgname = 'playlist_tracks_same_owner' AND tgrelid = 'public.playlist_tracks'::regclass),
  true);

-- ── service_role: every server route writes as it ─────────────────────────
SET ROLE service_role;

INSERT INTO public.playlist_tracks (playlist_id, track_id, position) VALUES (:PL1, :T1, 1);
SELECT public.check_eq('the owner’s own track joins the playlist',
  (SELECT count(*)::int FROM public.playlist_tracks WHERE playlist_id = :PL1), 1);

SELECT public.check_raises('another producer’s track is refused',
  format('INSERT INTO public.playlist_tracks (playlist_id, track_id, position) VALUES (%L, %L, 2)', :PL1, :T2),
  'must have the same owner');
SELECT public.check_raises('an organization’s song is refused (G3: it would reach the public store)',
  format('INSERT INTO public.playlist_tracks (playlist_id, track_id, position) VALUES (%L, %L, 2)', :PL1, :TO),
  'must have the same owner');
SELECT public.check_raises('moving a row onto another producer’s track is refused',
  format('UPDATE public.playlist_tracks SET track_id = %L WHERE playlist_id = %L AND track_id = %L', :T2, :PL1, :T1),
  'must have the same owner');
SELECT public.check_raises('moving a row onto an org song is refused',
  format('UPDATE public.playlist_tracks SET track_id = %L WHERE playlist_id = %L AND track_id = %L', :TO, :PL1, :T1),
  'must have the same owner');

-- Reorder (position only) and remove are untouched.
UPDATE public.playlist_tracks SET position = 5 WHERE playlist_id = :PL1 AND track_id = :T1;
SELECT public.check_eq('a reorder is not a re-check', (SELECT position FROM public.playlist_tracks WHERE playlist_id = :PL1 AND track_id = :T1), 5);
DELETE FROM public.playlist_tracks WHERE playlist_id = :PL1 AND track_id = :T1;
SELECT public.check_eq('remove works', (SELECT count(*)::int FROM public.playlist_tracks WHERE playlist_id = :PL1), 0);
RESET ROLE;

-- ── authenticated: the producer on their own JWT ──────────────────────────
SET ROLE authenticated;
SELECT public.as_user(:P1);
INSERT INTO public.playlist_tracks (playlist_id, track_id, position) VALUES (:PL1, :T1, 1), (:PL1, :T1b, 2);
SELECT public.check_eq('the producer adds their own tracks on their own JWT',
  (SELECT count(*)::int FROM public.playlist_tracks WHERE playlist_id = :PL1), 2);
UPDATE public.playlist_tracks SET position = 3 - position WHERE playlist_id = :PL1;
SELECT public.check_eq('and reorders them', (SELECT position FROM public.playlist_tracks WHERE playlist_id = :PL1 AND track_id = :T1), 2);
SELECT public.check_raises('their own playlist still refuses another producer’s track',
  format('INSERT INTO public.playlist_tracks (playlist_id, track_id, position) VALUES (%L, %L, 3)', :PL1, :T2),
  'must have the same owner');
SELECT public.check_raises('and an org song',
  format('INSERT INTO public.playlist_tracks (playlist_id, track_id, position) VALUES (%L, %L, 3)', :PL1, :TO),
  'must have the same owner');

SELECT public.as_user(:P2);
SELECT public.check_raises('another producer cannot write into P1’s playlist at all (097, unchanged)',
  format('INSERT INTO public.playlist_tracks (playlist_id, track_id, position) VALUES (%L, %L, 3)', :PL1, :T2),
  'row-level security|same owner');
RESET ROLE;

SET ROLE anon;
SELECT public.check_raises('anon writes nothing',
  format('INSERT INTO public.playlist_tracks (playlist_id, track_id, position) VALUES (%L, %L, 3)', :PL1, :T1),
  'permission denied|row-level security|same owner');
RESET ROLE;

-- ── Rows written before 165 are not re-checked; this query lists them ─────
ALTER TABLE public.playlist_tracks DISABLE TRIGGER playlist_tracks_same_owner;
INSERT INTO public.playlist_tracks (playlist_id, track_id, position) VALUES (:PL1, :TO, 9);
ALTER TABLE public.playlist_tracks ENABLE TRIGGER playlist_tracks_same_owner;
SELECT public.check_eq('the audit query finds a pre-165 cross-owner row',
  (SELECT count(*)::int
   FROM public.playlist_tracks pt
   JOIN public.playlists p ON p.id = pt.playlist_id
   JOIN public.tracks t ON t.id = pt.track_id
   WHERE t.org_id IS NOT NULL OR t.user_id IS DISTINCT FROM p.user_id),
  1);
