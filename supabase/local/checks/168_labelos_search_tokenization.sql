-- Behaviour checks for 168_labelos_search_tokenization.sql (LABEL-45), run by
-- scripts/local-db/check.sh (npm run db:local:check) in its own copy of the
-- throwaway database. Every check RAISEs on failure; psql stops at the first.
--
-- What is proved:
--   - the six search_tsv columns are still STORED generated tsvectors with
--     their GIN indexes, now built from translate(…, '_.-@/', '     ');
--   - "mix" finds final_mix.wav and "x & com" finds a@x.com (the words inside
--     a file name and an address), in the six tables' own columns;
--   - Hindi and Thai words (letters + combining marks) still match as a whole
--     word and by prefix;
--   - producer rows (org_id NULL) still have a NULL vector;
--   - re-running the migration is a no-op: the tables are not rewritten
--     (same relfilenode) and the indexes are the same objects;
--   - the planner still serves the route's query from the GIN index;
--   - no policy mentions search_tsv.

\set P  '''0b0e1a57-0000-4000-8000-000000000001'''
\set O  '''a1680000-0000-4000-8000-000000000001'''
\set L  '''b1680000-0000-4000-8000-000000000001'''
\set C1 '''c1680000-0000-4000-8000-0000000000c1'''
\set LP1 '''d1680000-0000-4000-8000-000000000011'''
\set S1 '''e1680000-0000-4000-8000-000000000001'''
\set S2 '''e1680000-0000-4000-8000-000000000002'''
\set S3 '''e1680000-0000-4000-8000-000000000003'''
\set PS1 '''e1680000-0000-4000-8000-000000000006'''
\set F1 '''f1680000-0000-4000-8000-000000000001'''
\set R1 '''aa680000-0000-4000-8000-000000000001'''

CREATE FUNCTION public.check_eq(label text, got anyelement, want anyelement) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'CHECK FAILED: % — got %, want %', label, got, want;
  END IF;
END $$;

INSERT INTO auth.users (id, email) VALUES (:O, 'o168@local.test');
INSERT INTO public.organizations (id, name, slug, kind, created_by) VALUES (:L, 'Label 168', 'label-168', 'label', :O);
INSERT INTO public.contacts (id, user_id, org_id, name, email, category, label) VALUES
  (:C1, NULL, :L, 'Ops Desk', 'a@x.com', 'manager', 'x-ray_records');
INSERT INTO public.contacts (user_id, name, email) VALUES (:P, 'Producer Desk', 'p168@x.com');
INSERT INTO public.projects (id, user_id, org_id, name, description) VALUES
  (:LP1, NULL, :L, 'Night_Shift.v2', 'final-mix notes');
INSERT INTO public.projects (user_id, name, description) VALUES (:P, 'Night_Shift producer', 'final-mix');
INSERT INTO public.tracks (id, user_id, org_id, created_by, title, type, audio_url, song_stage) VALUES
  (:S1, NULL, :L, :O, 'Runnin_Home.demo-2', 'song', 'r2://private/orgs/l/s1', 'inbox'),
  (:S2, NULL, :L, :O, 'हिन्दी गाना', 'song', 'r2://private/orgs/l/s2', 'inbox'),
  (:S3, NULL, :L, :O, 'สวัสดี ชาวโลก', 'song', 'r2://private/orgs/l/s3', 'inbox');
INSERT INTO public.tracks (id, user_id, title, type, audio_url) VALUES (:PS1, :P, 'Runnin_Home producer', 'song', 'r2://private/p1');
INSERT INTO public.project_assets (id, org_id, project_id, kind, sensitivity, label, file_name, url, created_by) VALUES
  (:F1, :L, :LP1, 'artwork', 'normal', '', 'final_mix.wav', 'r2://private/orgs/l/a/f1', :O);
INSERT INTO public.releases (id, org_id, project_id, contact_id, title, label_name, created_by) VALUES
  (:R1, :L, :LP1, :C1, 'Night_Shift-EP', 'x.records', :O);
INSERT INTO public.parties (org_id, display_name, legal_name, created_by) VALUES
  (:L, 'DJ_Kilo', 'Kilian.Adeyemi', :O);

-- ── Schema ──────────────────────────────────────────────────────────────

SELECT public.check_eq('all six tables carry a stored generated search_tsv built with translate()',
  (SELECT count(*) FROM pg_attribute a
     JOIN pg_class c ON c.oid = a.attrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE n.nspname = 'public' AND a.attname = 'search_tsv' AND a.attgenerated = 's' AND a.atttypid = 'tsvector'::regtype
      AND pg_get_expr(d.adbin, d.adrelid) LIKE '%translate(%' AND pg_get_expr(d.adbin, d.adrelid) ILIKE '%normalize(%'
      AND c.relname IN ('tracks', 'contacts', 'projects', 'project_assets', 'releases', 'parties')), 6::bigint);
SELECT public.check_eq('six GIN indexes on search_tsv',
  (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname LIKE '%\_search\_tsv\_idx' AND indexdef LIKE '%USING gin (search_tsv)%'), 6::bigint);
SELECT public.check_eq('the four producer-shared tables keep their partial index',
  (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname IN ('tracks_search_tsv_idx', 'contacts_search_tsv_idx', 'projects_search_tsv_idx', 'project_assets_search_tsv_idx')
     AND indexdef LIKE '%org_id IS NOT NULL%'), 4::bigint);

-- ── Words inside file names and addresses ────────────────────────────────

SELECT public.check_eq('"mix" finds final_mix.wav', (SELECT string_agg(file_name, ',') FROM public.project_assets WHERE search_tsv @@ to_tsquery('simple', 'mix:*')), 'final_mix.wav');
SELECT public.check_eq('"final & mix & wav" finds it too', (SELECT count(*) FROM public.project_assets WHERE search_tsv @@ to_tsquery('simple', 'final:* & mix:* & wav:*')), 1::bigint);
SELECT public.check_eq('"x & com" finds a@x.com', (SELECT string_agg(name, ',') FROM public.contacts WHERE search_tsv @@ to_tsquery('simple', 'x:* & com:*')), 'Ops Desk');
SELECT public.check_eq('the address local part is a word', (SELECT count(*) FROM public.contacts WHERE search_tsv @@ to_tsquery('simple', 'a:* & x:*')), 1::bigint);
SELECT public.check_eq('...and so is a label split on _ and -', (SELECT count(*) FROM public.contacts WHERE search_tsv @@ to_tsquery('simple', 'ray:* & records:*')), 1::bigint);
SELECT public.check_eq('track title: "home" and "demo" inside Runnin_Home.demo-2',
  (SELECT count(*) FROM public.tracks WHERE search_tsv @@ to_tsquery('simple', 'home:* & demo:* & 2')), 1::bigint);
SELECT public.check_eq('project name and description words',
  (SELECT count(*) FROM public.projects WHERE search_tsv @@ to_tsquery('simple', 'shift:* & v2:* & final:* & mix:*')), 1::bigint);
SELECT public.check_eq('release title and label name', (SELECT count(*) FROM public.releases WHERE search_tsv @@ to_tsquery('simple', 'shift:* & ep:* & records:*')), 1::bigint);
SELECT public.check_eq('party display and legal name', (SELECT count(*) FROM public.parties WHERE search_tsv @@ to_tsquery('simple', 'kilo:* & adeyemi:*')), 1::bigint);
SELECT public.check_eq('still no stemming: "run" is not "runnin"', (SELECT count(*) FROM public.tracks WHERE search_tsv @@ to_tsquery('simple', 'run')), 0::bigint);

-- ── Hindi and Thai ───────────────────────────────────────────────────────

SELECT public.check_eq('Hindi word, whole', (SELECT id FROM public.tracks WHERE search_tsv @@ to_tsquery('simple', 'हिन्दी')), :S2::uuid);
SELECT public.check_eq('Hindi word, by prefix', (SELECT id FROM public.tracks WHERE search_tsv @@ to_tsquery('simple', 'हिन्:*')), :S2::uuid);
SELECT public.check_eq('Hindi second word', (SELECT id FROM public.tracks WHERE search_tsv @@ to_tsquery('simple', 'गाना:*')), :S2::uuid);
SELECT public.check_eq('Thai word, whole', (SELECT id FROM public.tracks WHERE search_tsv @@ to_tsquery('simple', 'สวัสดี')), :S3::uuid);
SELECT public.check_eq('Thai word, by prefix', (SELECT id FROM public.tracks WHERE search_tsv @@ to_tsquery('simple', 'สวัส:*')), :S3::uuid);

-- ── The index and the query read the same normal form ────────────────────
-- macOS hands over file names decomposed: 'Cafe' + U+0301. The route searches
-- the composed 'café'.

INSERT INTO public.project_assets (org_id, project_id, kind, sensitivity, label, file_name, url, created_by) VALUES
  (:L, :LP1, 'artwork', 'normal', '', 'Cafe' || chr(769) || '_Mix.wav', 'r2://private/orgs/l/a/f2', :O);
SELECT public.check_eq('a decomposed name is found by its composed word',
  (SELECT count(*) FROM public.project_assets WHERE search_tsv @@ to_tsquery('simple', 'café:* & mix:*')), 1::bigint);

-- ── Producer rows are still never searchable ─────────────────────────────

SELECT public.check_eq('producer track: NULL vector', (SELECT search_tsv IS NULL FROM public.tracks WHERE id = :PS1), true);
SELECT public.check_eq('producer contact: NULL vector', (SELECT search_tsv IS NULL FROM public.contacts WHERE user_id = :P), true);
SELECT public.check_eq('producer project: NULL vector', (SELECT search_tsv IS NULL FROM public.projects WHERE user_id = :P), true);
SELECT public.check_eq('"home" finds the org track and never the producer one',
  (SELECT string_agg(title, ',') FROM public.tracks WHERE search_tsv @@ to_tsquery('simple', 'home:*')), 'Runnin_Home.demo-2');

-- ── The vector follows its row ───────────────────────────────────────────

UPDATE public.project_assets SET file_name = 'master_v3.flac' WHERE id = :F1;
SELECT public.check_eq('renamed file: old word gone', (SELECT count(*) FROM public.project_assets WHERE search_tsv @@ to_tsquery('simple', 'final:*')), 0::bigint);
SELECT public.check_eq('renamed file: new word found', (SELECT count(*) FROM public.project_assets WHERE search_tsv @@ to_tsquery('simple', 'master:* & flac:*')), 1::bigint);

-- ── Replay: the second run changes nothing ───────────────────────────────
-- (db:local:reset already applies every migration twice; this proves it does
--  not rewrite the six tables or rebuild their indexes.)

CREATE TEMP TABLE before_replay AS
SELECT c.relname, c.relfilenode,
       (SELECT i.relfilenode FROM pg_class i WHERE i.relname = c.relname || '_search_tsv_idx') AS idx_filenode
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relname IN ('tracks', 'contacts', 'projects', 'project_assets', 'releases', 'parties');
\ir ../../migrations/168_labelos_search_tokenization.sql
SELECT public.check_eq('replay: no table was rewritten and no index rebuilt',
  (SELECT count(*) FROM before_replay b
     JOIN pg_class c ON c.relname = b.relname AND c.relnamespace = 'public'::regnamespace
     JOIN pg_class i ON i.relname = b.relname || '_search_tsv_idx' AND i.relnamespace = 'public'::regnamespace
    WHERE c.relfilenode = b.relfilenode AND i.relfilenode = b.idx_filenode), 6::bigint);

-- ── No policy was touched ────────────────────────────────────────────────

SELECT public.check_eq('no policy mentions search_tsv',
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND (qual ILIKE '%search_tsv%' OR with_check ILIKE '%search_tsv%')), 0::bigint);

-- ── The planner still uses the index for the route's query ───────────────

CREATE FUNCTION public.plan_of(stmt text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE r record; out text := '';
BEGIN
  FOR r IN EXECUTE 'EXPLAIN ' || stmt LOOP out := out || ' ' || r."QUERY PLAN"; END LOOP;
  RETURN out;
END $$;

INSERT INTO public.tracks (user_id, org_id, created_by, title, type, audio_url, song_stage)
SELECT NULL, :L, :O, 'Bulk_song ' || i, 'song', 'r2://private/orgs/l/bulk' || i, 'inbox' FROM generate_series(1, 3000) i;
ANALYZE public.tracks;
SELECT public.check_eq('tracks: the route query (ordered, paged) uses the GIN index',
  public.plan_of($q$SELECT id FROM public.tracks WHERE org_id = 'b1680000-0000-4000-8000-000000000001' AND search_tsv @@ to_tsquery('simple', 'runn:*') ORDER BY title, id LIMIT 40$q$) LIKE '%tracks_search_tsv_idx%', true);
