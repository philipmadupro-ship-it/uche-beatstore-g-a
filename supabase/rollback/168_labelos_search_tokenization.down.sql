-- Rollback for 168_labelos_search_tokenization.sql (LABEL-45).
--
-- Lives outside supabase/migrations/ on purpose: scripts/apply-migrations.sh
-- applies every *.sql in that folder. Run by hand only.
--
-- Puts the six generated search columns back to 159's definition (the raw text,
-- no translate()). The vectors hold no data of their own, so nothing is lost;
-- words inside file names and addresses stop matching again. If 159 is rolled
-- back as well, run this one first.

DO $$
DECLARE
  spec record;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('tracks',
       $e$CASE WHEN org_id IS NULL THEN NULL ELSE to_tsvector('simple'::regconfig, coalesce(title, '')) END$e$,
       ' WHERE org_id IS NOT NULL'),
      ('contacts',
       $e$CASE WHEN org_id IS NULL THEN NULL
            ELSE to_tsvector('simple'::regconfig, coalesce(name, '') || ' ' || coalesce(email, '') || ' ' || coalesce(label, '')) END$e$,
       ' WHERE org_id IS NOT NULL'),
      ('projects',
       $e$CASE WHEN org_id IS NULL THEN NULL
            ELSE to_tsvector('simple'::regconfig, coalesce(name, '') || ' ' || coalesce(description, '')) END$e$,
       ' WHERE org_id IS NOT NULL'),
      ('project_assets',
       $e$CASE WHEN org_id IS NULL THEN NULL
            ELSE to_tsvector('simple'::regconfig, coalesce(label, '') || ' ' || coalesce(file_name, '')) END$e$,
       ' WHERE org_id IS NOT NULL'),
      ('releases',
       $e$to_tsvector('simple'::regconfig, coalesce(title, '') || ' ' || coalesce(label_name, ''))$e$,
       ''),
      ('parties',
       $e$to_tsvector('simple'::regconfig, coalesce(display_name, '') || ' ' || coalesce(legal_name, ''))$e$,
       '')
    ) AS v(tbl, expr, idx_where)
  LOOP
    EXECUTE format('ALTER TABLE public.%I DROP COLUMN IF EXISTS search_tsv', spec.tbl);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN search_tsv tsvector GENERATED ALWAYS AS (%s) STORED', spec.tbl, spec.expr);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I USING gin (search_tsv)%s',
                   spec.tbl || '_search_tsv_idx', spec.tbl, spec.idx_where);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
