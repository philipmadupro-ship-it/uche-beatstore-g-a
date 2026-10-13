-- Behaviour checks for 159_labelos_org_search.sql (LABEL-36), run by
-- scripts/local-db/check.sh (npm run db:local:check) in its own copy of the
-- throwaway database. Every check RAISEs on failure; psql stops at the first.
--
-- What is proven:
--   - the six generated columns exist and are STORED generated tsvectors;
--   - a producer row (org_id NULL) of tracks / contacts / projects /
--     project_assets has a NULL vector, so no query can match it;
--   - an org row matches on its words, 'simple' keeps them unstemmed
--     ("Runnin" is not "Run"), a prefix query (`runn:*`) finds it, and a
--     vector follows its row on UPDATE;
--   - no policy changed: the search columns add none, and the producer
--     tables keep their policy count;
--   - every index is a GIN on search_tsv and the planner uses it for the
--     query the route sends (org filter + @@), proved with EXPLAIN.

\set P  '''0b0e1a57-0000-4000-8000-000000000001'''
\set O  '''a1590000-0000-4000-8000-000000000001'''
\set L  '''b1590000-0000-4000-8000-000000000001'''
\set C1 '''c1590000-0000-4000-8000-0000000000c1'''
\set LP1 '''d1590000-0000-4000-8000-000000000011'''
\set S1 '''e1590000-0000-4000-8000-000000000001'''
\set PS1 '''e1590000-0000-4000-8000-000000000006'''
\set F1 '''f1590000-0000-4000-8000-000000000001'''
\set R1 '''aa590000-0000-4000-8000-000000000001'''

CREATE FUNCTION public.check_eq(label text, got anyelement, want anyelement) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'CHECK FAILED: % — got %, want %', label, got, want;
  END IF;
END $$;

INSERT INTO auth.users (id, email) VALUES (:O, 'o159@local.test');
INSERT INTO public.organizations (id, name, slug, kind, created_by) VALUES (:L, 'Label 159', 'label-159', 'label', :O);
INSERT INTO public.contacts (id, user_id, org_id, name, email, category, label) VALUES
  (:C1, NULL, :L, 'Nova Runnin', 'nova159@local.test', 'artist', 'Moon Records');
INSERT INTO public.contacts (user_id, name, email) VALUES (:P, 'Runnin producer contact', 'p159@local.test');
INSERT INTO public.projects (id, user_id, org_id, name, description) VALUES
  (:LP1, NULL, :L, 'Nova EP', 'late night sessions');
INSERT INTO public.projects (user_id, name, description) VALUES (:P, 'Runnin producer project', 'late night');
INSERT INTO public.tracks (id, user_id, org_id, created_by, title, type, audio_url, song_stage) VALUES
  (:S1, NULL, :L, :O, 'Runnin Home', 'song', 'r2://private/orgs/l/s1', 'inbox');
INSERT INTO public.tracks (id, user_id, title, type, audio_url) VALUES (:PS1, :P, 'Runnin producer song', 'song', 'r2://private/p1');
INSERT INTO public.project_assets (id, org_id, project_id, kind, sensitivity, label, file_name, url, created_by) VALUES
  (:F1, :L, :LP1, 'artwork', 'normal', 'Mood board', 'moodboard.png', 'r2://private/orgs/l/a/f1', :O);
INSERT INTO public.releases (id, org_id, project_id, contact_id, title, label_name, created_by) VALUES
  (:R1, :L, :LP1, :C1, 'Runnin Home EP', 'Moon Records', :O);
INSERT INTO public.parties (org_id, display_name, legal_name, created_by) VALUES
  (:L, 'DJ Kilo', 'Kilian Adeyemi', :O);

-- ── Schema ──────────────────────────────────────────────────────────────

SELECT public.check_eq('all six tables carry a stored generated search_tsv',
  (SELECT count(*) FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND a.attname = 'search_tsv' AND a.attgenerated = 's' AND a.atttypid = 'tsvector'::regtype
      AND c.relname IN ('tracks', 'contacts', 'projects', 'project_assets', 'releases', 'parties')), 6::bigint);
SELECT public.check_eq('six GIN indexes on search_tsv',
  (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname LIKE '%\_search\_tsv\_idx' AND indexdef LIKE '%USING gin (search_tsv)%'), 6::bigint);

-- ── Producer rows are never searchable ───────────────────────────────────

SELECT public.check_eq('producer track: NULL vector', (SELECT search_tsv IS NULL FROM public.tracks WHERE id = :PS1), true);
SELECT public.check_eq('producer contact: NULL vector', (SELECT search_tsv IS NULL FROM public.contacts WHERE user_id = :P AND name LIKE 'Runnin%'), true);
SELECT public.check_eq('producer project: NULL vector', (SELECT search_tsv IS NULL FROM public.projects WHERE user_id = :P AND name LIKE 'Runnin%'), true);
SELECT public.check_eq('the word "runnin" finds the org track and never the producer track',
  (SELECT string_agg(title, ',' ORDER BY title) FROM public.tracks WHERE search_tsv @@ to_tsquery('simple', 'runnin')), 'Runnin Home');
SELECT public.check_eq('...the org contact only',
  (SELECT string_agg(name, ',') FROM public.contacts WHERE search_tsv @@ to_tsquery('simple', 'runnin')), 'Nova Runnin');
SELECT public.check_eq('...the org project only (description words too)',
  (SELECT string_agg(name, ',') FROM public.projects WHERE search_tsv @@ to_tsquery('simple', 'late & night')), 'Nova EP');

-- ── 'simple': no stemming; prefixes work ─────────────────────────────────

SELECT public.check_eq('"run" is not "runnin" (no stemming)',
  (SELECT count(*) FROM public.tracks WHERE search_tsv @@ to_tsquery('simple', 'run')), 0::bigint);
SELECT public.check_eq('prefix runn:* finds it',
  (SELECT count(*) FROM public.tracks WHERE search_tsv @@ to_tsquery('simple', 'runn:*')), 1::bigint);
SELECT public.check_eq('file name words', (SELECT count(*) FROM public.project_assets WHERE search_tsv @@ to_tsquery('simple', 'mood:*')), 1::bigint);
SELECT public.check_eq('release title and label name', (SELECT count(*) FROM public.releases WHERE search_tsv @@ to_tsquery('simple', 'moon & runnin')), 1::bigint);
SELECT public.check_eq('party legal name', (SELECT count(*) FROM public.parties WHERE search_tsv @@ to_tsquery('simple', 'adeyemi')), 1::bigint);

-- ── The vector follows its row ───────────────────────────────────────────

UPDATE public.tracks SET title = 'Different Name' WHERE id = :S1;
SELECT public.check_eq('renamed: old word gone', (SELECT count(*) FROM public.tracks WHERE search_tsv @@ to_tsquery('simple', 'runnin')), 0::bigint);
SELECT public.check_eq('renamed: new word found', (SELECT count(*) FROM public.tracks WHERE search_tsv @@ to_tsquery('simple', 'different')), 1::bigint);
UPDATE public.tracks SET title = 'Runnin Home' WHERE id = :S1;

-- ── No policy was added by 159 ───────────────────────────────────────────

SELECT public.check_eq('tracks keeps its policies (none mention search_tsv)',
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND (qual ILIKE '%search_tsv%' OR with_check ILIKE '%search_tsv%')), 0::bigint);

-- ── The planner uses the index for the route's query ─────────────────────
-- (A tiny table prefers a seq scan, so ask the planner not to for the proof;
--  what is proved is that the partial index CAN serve `org_id = X AND @@`.)

CREATE FUNCTION public.plan_of(stmt text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE r record; out text := '';
BEGIN
  FOR r IN EXECUTE 'EXPLAIN ' || stmt LOOP out := out || ' ' || r."QUERY PLAN"; END LOOP;
  RETURN out;
END $$;

-- A catalogue-sized org: 3000 songs in one org, so the org filter alone is not selective.
INSERT INTO public.tracks (user_id, org_id, created_by, title, type, audio_url, song_stage)
SELECT NULL, :L, :O, 'Bulk song ' || i, 'song', 'r2://private/orgs/l/bulk' || i, 'inbox' FROM generate_series(1, 3000) i;
ANALYZE public.tracks;
SELECT public.check_eq('tracks: the route query uses the GIN index',
  public.plan_of($q$SELECT id FROM public.tracks WHERE org_id = 'b1590000-0000-4000-8000-000000000001' AND search_tsv @@ to_tsquery('simple', 'runn:*') LIMIT 20$q$) LIKE '%tracks_search_tsv_idx%', true);
