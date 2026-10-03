-- Rollback for 143_labelos_org_assets.sql (LABEL-15).
--
-- Lives outside supabase/migrations/ on purpose: scripts/apply-migrations.sh
-- applies every *.sql in that folder. Run by hand only.
--
-- Order matters, as in 141 / 142's rollbacks:
--   1. org files are DELETED while org_id still says which they are — they
--      have no user_id, and NOT NULL cannot come back while they exist. The
--      stored objects (orgs/<org>/assets/… in the private bucket) are left
--      in place; nothing can reach them once the rows are gone;
--   2. refuse if a producer file uses one of 143's kinds or is restricted
--      (the producer routes never write either, so this is a no-op unless
--      someone wrote one by hand) — restoring 127's CHECK would fail anyway;
--   3. the CHECKs go, 127's kind CHECK and NOT NULL come back, the columns go;
--   4. project_assets_same_owner is put back as 141 wrote it, on 127's
--      trigger columns; 141's two project_assets policies are restored;
--   5. track_stem_files loses its guard and service-only trigger.

DELETE FROM public.project_assets WHERE org_id IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.project_assets
    WHERE kind NOT IN ('reference', 'artwork', 'lyrics', 'document', 'audio', 'other')
       OR sensitivity <> 'normal'
  ) THEN
    RAISE EXCEPTION '143 rollback: producer files use a LABEL-15 kind or sensitivity; change them first';
  END IF;
END $$;

DROP POLICY IF EXISTS org_member_read ON public.project_assets;
DROP POLICY IF EXISTS org_member_guard ON public.project_assets;

ALTER TABLE public.project_assets DROP CONSTRAINT IF EXISTS project_assets_org_or_owner;
ALTER TABLE public.project_assets DROP CONSTRAINT IF EXISTS project_assets_sensitivity_check;
ALTER TABLE public.project_assets DROP CONSTRAINT IF EXISTS project_assets_restricted_kinds;
ALTER TABLE public.project_assets DROP CONSTRAINT IF EXISTS project_assets_restricted_not_in_portal;
ALTER TABLE public.project_assets DROP CONSTRAINT IF EXISTS project_assets_kind_check;
ALTER TABLE public.project_assets ADD CONSTRAINT project_assets_kind_check
  CHECK (kind IN ('reference', 'artwork', 'lyrics', 'document', 'audio', 'other'));
ALTER TABLE public.project_assets ALTER COLUMN user_id SET NOT NULL;

DROP TRIGGER IF EXISTS project_assets_same_owner ON public.project_assets;
DROP INDEX IF EXISTS public.idx_project_assets_org;
ALTER TABLE public.project_assets DROP COLUMN IF EXISTS sensitivity;
ALTER TABLE public.project_assets DROP COLUMN IF EXISTS created_by;
ALTER TABLE public.project_assets DROP COLUMN IF EXISTS org_id;

DROP FUNCTION IF EXISTS public.labelos_org_asset_allowed(uuid, text, text);

-- 141 §4's version.
CREATE OR REPLACE FUNCTION public.project_assets_same_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.projects p WHERE p.id = NEW.project_id AND p.org_id IS NOT NULL) THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = NEW.project_id AND p.user_id = NEW.user_id AND p.org_id IS NULL) THEN
    RAISE EXCEPTION 'project_assets: project % is not owned by %', NEW.project_id, NEW.user_id;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER project_assets_same_owner
  BEFORE INSERT OR UPDATE OF user_id, project_id ON public.project_assets
  FOR EACH ROW EXECUTE FUNCTION public.project_assets_same_owner();

-- 141 §3 / §3b's versions.
CREATE POLICY org_member_read ON public.project_assets
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_assets.project_id
        AND p.org_id IS NOT NULL
        AND public.has_org_cap(p.org_id, 'catalog.read')
        AND public.can_see_org_project(p.org_id, p.id)
        AND (project_assets.kind IN ('artwork', 'lyrics') OR public.has_org_cap(p.org_id, 'audio.working'))
    )
  );

CREATE POLICY org_member_guard ON public.project_assets
  AS RESTRICTIVE
  FOR SELECT
  USING (
    NOT public.labelos_is_org_project(project_id)
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_assets.project_id
        AND p.org_id IS NOT NULL
        AND public.has_org_cap(p.org_id, 'catalog.read')
        AND public.can_see_org_project(p.org_id, p.id)
        AND (project_assets.kind IN ('artwork', 'lyrics') OR public.has_org_cap(p.org_id, 'audio.working'))
    )
  );

DROP POLICY IF EXISTS org_member_guard ON public.track_stem_files;
DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.track_stem_files;

NOTIFY pgrst, 'reload schema';
