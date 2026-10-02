-- Behaviour checks for 140_labelos_song_fields.sql, run by
-- scripts/local-db/check.sh (npm run db:local:check) in its own copy of the
-- throwaway database. Every check RAISEs on failure; psql stops at the first.
--
-- reset.sh has already applied EVERY migration twice, so the constraint
-- counts below are the replay check (the verify pattern from 133): exactly
-- one relation CHECK on track_links, one stage CHECK and one ISWC CHECK on
-- tracks survive.
--
-- Cast: producer P (seed, creator_profiles row), buyer B (seed); label L with
-- owner O and an A&R member AR holding catalog.read.

\set P   '''0b0e1a57-0000-4000-8000-000000000001'''
\set B   '''0b0e1a57-0000-4000-8000-0000000000b1'''
\set O   '''a1400000-0000-4000-8000-000000000001'''
\set AR  '''a1400000-0000-4000-8000-000000000002'''
\set L   '''b1400000-0000-4000-8000-000000000001'''
\set SONG '''d1400000-0000-4000-8000-000000000001'''
\set BEAT '''d1400000-0000-4000-8000-000000000002'''
\set MST  '''d1400000-0000-4000-8000-000000000003'''
\set DMO  '''d1400000-0000-4000-8000-000000000004'''
\set LOOP '''d1400000-0000-4000-8000-000000000005'''

INSERT INTO auth.users (id, email) VALUES (:O, 'owner140@local.test'), (:AR, 'ar140@local.test');
INSERT INTO public.organizations (id, name, slug, kind, created_by) VALUES (:L, 'Label 140', 'label-140', 'label', :O);
INSERT INTO public.org_members (org_id, user_id, role, functions, scope) VALUES
  (:L, :O, 'owner', '{}', 'org'),
  (:L, :AR, 'member', '{a_and_r}', 'org');

-- The producer's existing material, written before any Label OS code runs.
INSERT INTO public.tracks (id, user_id, title, type, audio_url) VALUES
  (:SONG, :P, 'Track 04', 'song', 'r2://private/song.wav'),
  (:BEAT, :P, 'Midnight', 'beat', 'r2://private/beat.wav'),
  (:MST,  :P, 'Track 04 (master)', 'song', 'r2://private/master.wav'),
  (:DMO,  :P, 'Track 04 (demo)', 'song', 'r2://private/demo.wav'),
  (:LOOP, :P, 'Keys', 'loop', 'r2://private/loop.wav');

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
GRANT EXECUTE ON FUNCTION public.check_eq(text, anyelement, anyelement) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_raises(text, text, text) TO anon, authenticated;

-- ── Shape, after the double replay ─────────────────────────────────────────

SELECT public.check_eq('exactly one relation CHECK on track_links survives the replay',
  (SELECT count(*) FROM pg_constraint
   WHERE conrelid = 'public.track_links'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%topline%'),
  1::bigint);
SELECT public.check_eq('it is track_links_relation_check and names master and demo',
  (SELECT count(*) FROM pg_constraint
   WHERE conrelid = 'public.track_links'::regclass AND conname = 'track_links_relation_check'
     AND pg_get_constraintdef(oid) LIKE '%''master''%' AND pg_get_constraintdef(oid) LIKE '%''demo''%'
     AND pg_get_constraintdef(oid) LIKE '%''instrumental''%' AND pg_get_constraintdef(oid) LIKE '%''version''%'),
  1::bigint);
SELECT public.check_eq('track_links_not_self is still there',
  (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.track_links'::regclass AND conname = 'track_links_not_self'),
  1::bigint);
SELECT public.check_eq('exactly one song_stage CHECK on tracks',
  (SELECT count(*) FROM pg_constraint
   WHERE conrelid = 'public.tracks'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%song_stage%'),
  1::bigint);
SELECT public.check_eq('exactly one iswc CHECK on tracks',
  (SELECT count(*) FROM pg_constraint
   WHERE conrelid = 'public.tracks'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%iswc%'),
  1::bigint);
SELECT public.check_eq('tracks_type_check (133) is untouched: still one, still six types',
  (SELECT count(*) FROM pg_constraint
   WHERE conrelid = 'public.tracks'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%instrumental%'
     AND pg_get_constraintdef(oid) LIKE '%topline%'),
  1::bigint);
SELECT public.check_eq('song_stage and iswc are nullable text with no default',
  (SELECT string_agg(column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '-'), ',' ORDER BY column_name)
   FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'tracks' AND column_name IN ('song_stage', 'iswc')),
  'iswc:text:YES:-,song_stage:text:YES:-');
SELECT public.check_eq('existing producer tracks read NULL for both new columns',
  (SELECT count(*) FROM public.tracks WHERE user_id = :P AND (song_stage IS NOT NULL OR iswc IS NOT NULL)),
  0::bigint);

-- ── No new read path: tracks / track_links policies keep their 133/097 shape ──

SELECT public.check_eq('no policy on tracks or track_links mentions an org',
  (SELECT count(*) FROM pg_policies
   WHERE schemaname = 'public' AND tablename IN ('tracks', 'track_links')
     AND (coalesce(qual, '') ~* 'org' OR coalesce(with_check, '') ~* 'org')),
  0::bigint);
SELECT public.check_eq('track_links keeps exactly its two owner policies',
  (SELECT string_agg(policyname, ',' ORDER BY policyname) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'track_links'),
  'track_links_owner_select,track_links_owner_write');

-- ── The producer, through RLS ───────────────────────────────────────────────

SET ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"0b0e1a57-0000-4000-8000-000000000001","role":"authenticated"}', false);

-- Old relations still link, exactly as before.
INSERT INTO public.track_links (from_track_id, to_track_id, user_id, relation) VALUES
  (:BEAT, :LOOP, :P, 'loop');
-- The new two are valid relations at the database level.
INSERT INTO public.track_links (from_track_id, to_track_id, user_id, relation) VALUES
  (:SONG, :MST, :P, 'master'),
  (:SONG, :DMO, :P, 'demo');
SELECT public.check_eq('producer reads all three links',
  (SELECT string_agg(relation, ',' ORDER BY relation) FROM public.track_links WHERE user_id = :P),
  'demo,loop,master');
SELECT public.check_raises('an unknown relation is still refused',
  format('INSERT INTO public.track_links (from_track_id, to_track_id, user_id, relation) VALUES (%L, %L, %L, %L)',
    :SONG, :LOOP, :P, 'stem'),
  'track_links_relation_check');
SELECT public.check_raises('relinking a pair still upserts one relation (PK unchanged)',
  format('INSERT INTO public.track_links (from_track_id, to_track_id, user_id, relation) VALUES (%L, %L, %L, %L)',
    :SONG, :MST, :P, 'version'),
  'duplicate key');

UPDATE public.tracks SET song_stage = 'inbox' WHERE id = :SONG;
UPDATE public.tracks SET song_stage = 'selected' WHERE id = :SONG;
SELECT public.check_eq('song_stage takes a W3 stage', (SELECT song_stage FROM public.tracks WHERE id = :SONG), 'selected');
SELECT public.check_raises('released is derived, never stored',
  format('UPDATE public.tracks SET song_stage = %L WHERE id = %L', 'released', :SONG), 'tracks_song_stage_check');
SELECT public.check_raises('approved is not a stage (it is a gate word)',
  format('UPDATE public.tracks SET song_stage = %L WHERE id = %L', 'approved', :SONG), 'tracks_song_stage_check');
UPDATE public.tracks SET song_stage = NULL WHERE id = :SONG;

UPDATE public.tracks SET iswc = 'T-345.246.800-1' WHERE id = :SONG;
UPDATE public.tracks SET iswc = 'T3452468001' WHERE id = :SONG;
SELECT public.check_eq('iswc takes the 05 §7 format, dotted or compact', (SELECT iswc FROM public.tracks WHERE id = :SONG), 'T3452468001');
SELECT public.check_raises('a malformed iswc is refused',
  format('UPDATE public.tracks SET iswc = %L WHERE id = %L', 'T-12345', :SONG), 'tracks_iswc_format');
SELECT public.check_raises('an ISRC in the ISWC column is refused',
  format('UPDATE public.tracks SET iswc = %L WHERE id = %L', 'USRC17607839', :SONG), 'tracks_iswc_format');
RESET ROLE;

-- ── Nobody else gains a read path ───────────────────────────────────────────

SET ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"a1400000-0000-4000-8000-000000000002","role":"authenticated"}', false);
SELECT public.check_eq('a label member with catalog.read sees none of the producer''s tracks',
  (SELECT count(*) FROM public.tracks WHERE user_id = '0b0e1a57-0000-4000-8000-000000000001'), 0::bigint);
SELECT public.check_eq('… nor the producer''s master / demo links',
  (SELECT count(*) FROM public.track_links), 0::bigint);
RESET ROLE;

SET ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"0b0e1a57-0000-4000-8000-0000000000b1","role":"authenticated"}', false);
SELECT public.check_eq('a buyer sees no links', (SELECT count(*) FROM public.track_links), 0::bigint);
SELECT public.check_raises('a buyer cannot write a master link (owner + is_producer, unchanged)',
  format('INSERT INTO public.track_links (from_track_id, to_track_id, user_id, relation) VALUES (%L, %L, %L, %L)',
    :SONG, :BEAT, :B, 'master'),
  'row-level security|must be owned');
RESET ROLE;

SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
SELECT public.check_eq('anon sees no links', (SELECT count(*) FROM public.track_links), 0::bigint);
RESET ROLE;

DROP FUNCTION public.check_eq(text, anyelement, anyelement);
DROP FUNCTION public.check_raises(text, text, text);
