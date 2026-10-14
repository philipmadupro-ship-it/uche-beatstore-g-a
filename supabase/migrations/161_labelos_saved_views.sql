-- 161_labelos_saved_views.sql
-- Label OS (LABEL-37): saved views — a named, shareable filter DEFINITION over
-- an org's songs or releases (08 §A3.5, 14 LABEL-37).
--
-- LABEL OS — NOT APPLIED. Apply at the final merge of the Label OS branch
-- into main, after 157. Never part of supabase/apply/pending.sql.
--
-- 1. `org_saved_views` — org-only (org_id NOT NULL, ON DELETE CASCADE from
--    `organizations`, so LABEL-39's hard delete removes it with the org and its
--    all-tables sweep in supabase/local/checks/labelos_org_hard_delete.sql
--    covers it by the `org_id` column). No `user_id`: the author is
--    `created_by` (ON DELETE CASCADE — a person's own views go with them).
--      subject     songs | releases
--      name        1–80 characters
--      definition  the versioned filter DEFINITION (lib/labelos/filters.ts):
--                  ids and enums only, never names, never results; a JSON
--                  object of at most 4000 bytes whose `subject` is this row's
--                  and whose `v` is a number. Validated again by the route.
--      shared      false = the author's own; true = every member who can run
--                  the view (the route decides; see 2.)
--
-- 2. NO ACCESS for the API roles — the table is read and written by the
--    service role through /api/org/[orgId]/views. That is the point: a
--    definition carries artist, party and project ids, and a member limited to
--    some artists must not be able to read those ids with their own JWT
--    (PostgREST would hand them the row whole). The route drops what the
--    viewer cannot see and hides a shared view that refers to anything outside
--    their reach, and results are recomputed per viewer on every run, so the
--    database never holds anything that is true only for one viewer. RLS is on
--    with ONE policy that says no (`USING (false)`, so the repo's "every
--    Label OS table has a policy" guard stays strict and the intent is written
--    down), the API roles' privileges are revoked, and 141's service-only
--    trigger refuses a write from them as well — three independent layers,
--    none of them a per-row SECURITY DEFINER call (R-08 has nothing to say
--    about a policy that reads no row).
--
-- 3. One name per author per subject (case-insensitive); two authors may both
--    have a "Needs artwork". The route caps views per author and per org.
--
-- Idempotent. Rollback: supabase/rollback/161_labelos_saved_views.down.sql.

CREATE TABLE IF NOT EXISTS public.org_saved_views (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject     text NOT NULL CHECK (subject IN ('songs', 'releases')),
  name        text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  definition  jsonb NOT NULL,
  shared      boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT org_saved_views_definition_shape CHECK (
    jsonb_typeof(definition) = 'object'
    AND octet_length(definition::text) <= 4000
    AND definition ->> 'subject' = subject
    AND (definition ->> 'v') ~ '^[0-9]{1,4}$'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_org_saved_views_author_name
  ON public.org_saved_views (org_id, subject, created_by, lower(btrim(name)));
CREATE INDEX IF NOT EXISTS idx_org_saved_views_org_subject
  ON public.org_saved_views (org_id, subject, created_at);

ALTER TABLE public.org_saved_views ENABLE ROW LEVEL SECURITY;

-- The author and the organization never change (a view is not moved between orgs or people).
CREATE OR REPLACE FUNCTION public.labelos_saved_views_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.org_id <> OLD.org_id OR NEW.created_by <> OLD.created_by OR NEW.subject <> OLD.subject THEN
    RAISE EXCEPTION 'org_saved_views: the organization, the author and the subject of a view never change'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS org_saved_views_guard ON public.org_saved_views;
CREATE TRIGGER org_saved_views_guard BEFORE UPDATE ON public.org_saved_views
  FOR EACH ROW EXECUTE FUNCTION public.labelos_saved_views_guard();

-- Writes are the service role's (141): the API roles can neither forge nor edit.
DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.org_saved_views;
CREATE TRIGGER labelos_org_rows_service_only BEFORE INSERT OR UPDATE OR DELETE ON public.org_saved_views
  FOR EACH ROW EXECUTE FUNCTION public.labelos_org_rows_service_only('self', 'org_id');

-- Nobody reads or writes through PostgREST, whatever the privileges say.
DROP POLICY IF EXISTS org_saved_views_no_direct_access ON public.org_saved_views;
CREATE POLICY org_saved_views_no_direct_access ON public.org_saved_views
  FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

REVOKE ALL ON public.org_saved_views FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
