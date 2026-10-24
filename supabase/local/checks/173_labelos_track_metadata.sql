-- Behaviour checks for 173_labelos_track_metadata.sql (LABEL-53), run by
-- scripts/local-db/check.sh (npm run db:local:check). Every check RAISEs on failure.
--
-- Cast: P a producer (owns a producer track), O the org owner, L a label org
-- with one org recording.
--
-- Proven: the eight columns exist and an org recording takes every field;
-- format CHECKs refuse a bad language and empty or over-long text; a PRODUCER track can set none of the new fields
-- (tracks_org_metadata_only) and still takes its ordinary writes; the
-- compare-and-set token is a plain column the editor owns (an update that
-- does not name it leaves it alone).

\set P  '''a1730000-0000-4000-8000-000000000001'''
\set O  '''a1730000-0000-4000-8000-000000000002'''
\set L  '''b1730000-0000-4000-8000-000000000001'''
\set PT '''c1730000-0000-4000-8000-000000000001'''
\set OT '''c1730000-0000-4000-8000-000000000002'''

INSERT INTO auth.users (id, email) VALUES (:P, 'p173@local.test'), (:O, 'o173@local.test');
INSERT INTO public.organizations (id, name, slug, kind, created_by) VALUES (:L, 'Label 173', 'label-173', 'label', :O);

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

SELECT public.check_eq('the eight columns exist',
  (SELECT count(*)::int FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tracks'
     AND column_name IN ('version_label','language','explicit','genre','recorded_on','p_line','master_owner','metadata_updated_at')), 8);

INSERT INTO public.tracks (id, user_id, title, type, audio_url) VALUES (:PT, :P, 'Producer beat', 'beat', 'r2://x/p.wav');
INSERT INTO public.tracks (id, org_id, created_by, title, type, audio_url, song_stage)
  VALUES (:OT, :L, :O, 'Org song', 'song', 'r2://x/o.wav', 'inbox');

-- An org recording takes every field.
UPDATE public.tracks SET version_label = 'Radio edit', language = 'pt-BR', explicit = false, genre = 'Afrobeats',
  recorded_on = '2026-03-04', p_line = '℗ 2026 Label', master_owner = 'Label 173 Ltd',
  isrc = 'GBAAA2600001', iswc = 'T-034.524.680-1', metadata_updated_at = now() WHERE id = :OT;
SELECT public.check_eq('an org recording keeps the fields',
  (SELECT p_line || '|' || language || '|' || explicit::text FROM public.tracks WHERE id = :OT), '℗ 2026 Label|pt-BR|false');

SELECT public.check_raises('a malformed language is refused', format($q$UPDATE public.tracks SET language = 'English' WHERE id = %L$q$, :OT), 'tracks_metadata_format');
SELECT public.check_raises('an empty version label is refused', format($q$UPDATE public.tracks SET version_label = '' WHERE id = %L$q$, :OT), 'tracks_metadata_format');
SELECT public.check_raises('an over-long P-line is refused', format($q$UPDATE public.tracks SET p_line = repeat('x', 201) WHERE id = %L$q$, :OT), 'tracks_metadata_format');

-- A producer row can set none of them.
SELECT public.check_raises('a producer track cannot take a P-line', format($q$UPDATE public.tracks SET p_line = 'x' WHERE id = %L$q$, :PT), 'tracks_org_metadata_only');
SELECT public.check_raises('nor a language', format($q$UPDATE public.tracks SET language = 'en' WHERE id = %L$q$, :PT), 'tracks_org_metadata_only');
SELECT public.check_raises('nor explicit', format($q$UPDATE public.tracks SET explicit = true WHERE id = %L$q$, :PT), 'tracks_org_metadata_only');
SELECT public.check_raises('nor the CAS token', format($q$UPDATE public.tracks SET metadata_updated_at = now() WHERE id = %L$q$, :PT), 'tracks_org_metadata_only');
UPDATE public.tracks SET title = 'Renamed', bpm = 140 WHERE id = :PT;
SELECT public.check_eq('and still takes its ordinary writes', (SELECT title FROM public.tracks WHERE id = :PT), 'Renamed');

-- The token belongs to the editor: other writes leave it alone.
SELECT metadata_updated_at AS before_ts FROM public.tracks WHERE id = :OT \gset
UPDATE public.tracks SET song_stage = 'in_review' WHERE id = :OT;
SELECT public.check_eq('a stage move does not touch the token',
  (SELECT metadata_updated_at = :'before_ts'::timestamptz FROM public.tracks WHERE id = :OT), true);
