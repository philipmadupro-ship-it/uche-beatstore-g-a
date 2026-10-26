-- 168_labelos_search_tokenization.sql — LABEL-45: org search tokenization (G8 F2).
--
-- 159's generated `search_tsv` columns fed Postgres' `simple` parser the raw
-- text. Its default parser keeps a file name, a host and an address in one
-- piece: `final_mix.wav` is one token, `a@x.com` is one `email` token. So the
-- word a person types ("mix", "x com") matched nothing inside them.
--
-- The fix is on the index side: `translate(normalize(text, NFKC), '_.-@/',
-- '     ')` turns the five joiners into spaces BEFORE `to_tsvector`, in every searchable column of
-- all six tables (one rule, so a title like "Runnin_Home.v2" and a label
-- "x-ray" behave like a file name). The query side (lib/labelos/org-search.ts)
-- already splits a typed query on the same characters and, from this task on,
-- keeps combining marks (\p{M}) inside a word so Hindi and Thai words stay
-- whole. `normalize(…, NFKC)` is the same normal form the query is read in, so
-- a name stored decomposed (macOS hands over 'Café.wav' as 'Cafe' + U+0301)
-- is indexed as the word a person types. (normalize() is IMMUTABLE, needs a
-- UTF8 database — Supabase's is — and passes ASCII through unchanged.)
--
-- A generated column's expression cannot be altered, so each column is dropped
-- and added again (its GIN index goes with it and is recreated). Nothing else
-- depends on it: no policy, view, trigger or function reads `search_tsv`.
--
-- Same shape as 159 otherwise:
--   * tracks / contacts / projects / project_assets keep the vector NULL for a
--     producer row (org_id IS NULL), so a producer's data is never searchable
--     and costs no index space; releases and parties exist only for orgs;
--   * 'simple', immutable: translate() and to_tsvector('simple'::regconfig, …)
--     are IMMUTABLE, which a generated column requires;
--   * track notes are still NOT indexed (a hit would show the title of a row
--     matched on a private note).
--
-- Replay-safe (db:local:reset applies every migration twice): a column whose
-- generation expression already contains translate() and normalize() is left alone, so the
-- second run neither rewrites the table nor rebuilds the index. If 159 was
-- never applied, this creates the columns itself.
--
-- ADD COLUMN ... GENERATED STORED rewrites the table once and takes an
-- ACCESS EXCLUSIVE lock while it does: apply at the final merge like the rest
-- of Label OS, not under load.

DO $$
DECLARE
  spec record;
  current_expr text;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('tracks',
       $e$CASE WHEN org_id IS NULL THEN NULL
            ELSE to_tsvector('simple'::regconfig, translate(normalize(coalesce(title, ''), NFKC), '_.-@/', '     ')) END$e$,
       ' WHERE org_id IS NOT NULL'),
      ('contacts',
       $e$CASE WHEN org_id IS NULL THEN NULL
            ELSE to_tsvector('simple'::regconfig, translate(normalize(coalesce(name, '') || ' ' || coalesce(email, '') || ' ' || coalesce(label, ''), NFKC), '_.-@/', '     ')) END$e$,
       ' WHERE org_id IS NOT NULL'),
      ('projects',
       $e$CASE WHEN org_id IS NULL THEN NULL
            ELSE to_tsvector('simple'::regconfig, translate(normalize(coalesce(name, '') || ' ' || coalesce(description, ''), NFKC), '_.-@/', '     ')) END$e$,
       ' WHERE org_id IS NOT NULL'),
      ('project_assets',
       $e$CASE WHEN org_id IS NULL THEN NULL
            ELSE to_tsvector('simple'::regconfig, translate(normalize(coalesce(label, '') || ' ' || coalesce(file_name, ''), NFKC), '_.-@/', '     ')) END$e$,
       ' WHERE org_id IS NOT NULL'),
      ('releases',
       $e$to_tsvector('simple'::regconfig, translate(normalize(coalesce(title, '') || ' ' || coalesce(label_name, ''), NFKC), '_.-@/', '     '))$e$,
       ''),
      ('parties',
       $e$to_tsvector('simple'::regconfig, translate(normalize(coalesce(display_name, '') || ' ' || coalesce(legal_name, ''), NFKC), '_.-@/', '     '))$e$,
       '')
    ) AS v(tbl, expr, idx_where)
  LOOP
    SELECT pg_get_expr(d.adbin, d.adrelid) INTO current_expr
      FROM pg_attrdef d
      JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
     WHERE d.adrelid = ('public.' || spec.tbl)::regclass AND a.attname = 'search_tsv';

    IF current_expr IS NULL OR current_expr NOT LIKE '%translate(%' OR current_expr NOT ILIKE '%normalize(%' THEN
      EXECUTE format('ALTER TABLE public.%I DROP COLUMN IF EXISTS search_tsv', spec.tbl);
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN search_tsv tsvector GENERATED ALWAYS AS (%s) STORED', spec.tbl, spec.expr);
    END IF;
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I USING gin (search_tsv)%s',
                   spec.tbl || '_search_tsv_idx', spec.tbl, spec.idx_where);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
