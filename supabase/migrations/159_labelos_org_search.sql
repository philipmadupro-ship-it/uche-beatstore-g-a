-- 159_labelos_org_search.sql — LABEL-36: org full-text search (08 §A3).
--
-- Expand only: ONE generated, STORED tsvector column per searchable table, each
-- with a GIN index. No policy, trigger, grant or function changes — the search
-- route reads with the service role and applies the member's artist scope and
-- D4 itself (lib/labelos/org-search*.ts), so nothing here widens a read.
--
--   tracks         search_tsv  title                      (songs and every other org track)
--   contacts       search_tsv  name, email, label
--   projects       search_tsv  name, description
--   project_assets search_tsv  label, file_name
--   releases       search_tsv  title, label_name
--   parties        search_tsv  display_name, legal_name
--
-- Configuration `simple` (08 §A3): titles and names are never stemmed, so
-- "Runnin" matches "Runnin". Track notes are deliberately NOT indexed: the
-- route would show the title of a hit whose match was a private note.
--
-- The four tables a producer also owns (tracks, contacts, projects,
-- project_assets) compute the vector ONLY for org rows (org_id IS NOT NULL);
-- a producer row's vector is NULL, so no tsquery can ever match it and the
-- producer's data costs no index space. `releases` and `parties` exist only
-- for orgs.
--
-- Immutable on purpose: `to_tsvector('simple'::regconfig, text)` is IMMUTABLE
-- (the one-argument form is not), which a generated column requires.
--
-- ADD COLUMN ... GENERATED STORED rewrites the table once. Idempotent: every
-- statement is IF NOT EXISTS, and a re-run changes nothing.

ALTER TABLE public.tracks ADD COLUMN IF NOT EXISTS search_tsv tsvector
  GENERATED ALWAYS AS (
    CASE WHEN org_id IS NULL THEN NULL
         ELSE to_tsvector('simple'::regconfig, coalesce(title, '')) END
  ) STORED;
CREATE INDEX IF NOT EXISTS tracks_search_tsv_idx ON public.tracks USING gin (search_tsv)
  WHERE org_id IS NOT NULL;

ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS search_tsv tsvector
  GENERATED ALWAYS AS (
    CASE WHEN org_id IS NULL THEN NULL
         ELSE to_tsvector('simple'::regconfig, coalesce(name, '') || ' ' || coalesce(email, '') || ' ' || coalesce(label, '')) END
  ) STORED;
CREATE INDEX IF NOT EXISTS contacts_search_tsv_idx ON public.contacts USING gin (search_tsv)
  WHERE org_id IS NOT NULL;

ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS search_tsv tsvector
  GENERATED ALWAYS AS (
    CASE WHEN org_id IS NULL THEN NULL
         ELSE to_tsvector('simple'::regconfig, coalesce(name, '') || ' ' || coalesce(description, '')) END
  ) STORED;
CREATE INDEX IF NOT EXISTS projects_search_tsv_idx ON public.projects USING gin (search_tsv)
  WHERE org_id IS NOT NULL;

ALTER TABLE public.project_assets ADD COLUMN IF NOT EXISTS search_tsv tsvector
  GENERATED ALWAYS AS (
    CASE WHEN org_id IS NULL THEN NULL
         ELSE to_tsvector('simple'::regconfig, coalesce(label, '') || ' ' || coalesce(file_name, '')) END
  ) STORED;
CREATE INDEX IF NOT EXISTS project_assets_search_tsv_idx ON public.project_assets USING gin (search_tsv)
  WHERE org_id IS NOT NULL;

ALTER TABLE public.releases ADD COLUMN IF NOT EXISTS search_tsv tsvector
  GENERATED ALWAYS AS (
    to_tsvector('simple'::regconfig, coalesce(title, '') || ' ' || coalesce(label_name, ''))
  ) STORED;
CREATE INDEX IF NOT EXISTS releases_search_tsv_idx ON public.releases USING gin (search_tsv);

ALTER TABLE public.parties ADD COLUMN IF NOT EXISTS search_tsv tsvector
  GENERATED ALWAYS AS (
    to_tsvector('simple'::regconfig, coalesce(display_name, '') || ' ' || coalesce(legal_name, ''))
  ) STORED;
CREATE INDEX IF NOT EXISTS parties_search_tsv_idx ON public.parties USING gin (search_tsv);

NOTIFY pgrst, 'reload schema';
