-- 143_labelos_org_assets.sql
-- Label OS (LABEL-15): org files on `project_assets` (17 R2). No new table.
--
-- LABEL OS — NOT APPLIED. Apply at the final merge of the Label OS branch
-- into main, after 142 (docs/bstudio-label-os/16-execution-runbook.md).
--
-- Expand only. Every existing row is a producer row (org_id NULL, user_id
-- set, sensitivity 'normal', one of the six 127 kinds), so every CHECK below
-- validates on production and the producer's project files, portal Files tab
-- and Notify counts read exactly what they read before (they all filter on
-- user_id, which an org file does not have).
--
--   1. Columns: project_assets.org_id (FK, fixed by trigger from the project,
--      never set by hand), created_by (the uploader — org rows have no owner,
--      the rule 139 / 142 set), sensitivity ('normal' | 'restricted', default
--      'normal').
--   2. Org rows have no owner: user_id DROP NOT NULL +
--      CHECK project_assets_org_or_owner ((org_id IS NULL) = (user_id IS NOT NULL)).
--   3. Kinds: the 127 CHECK is widened with photo, video, contract,
--      split_sheet, session (dropped + re-added, so a replay leaves one).
--      contract and split_sheet are always restricted
--      (project_assets_restricted_kinds), and a restricted file is never in
--      a portal (project_assets_restricted_not_in_portal) — a portal is a
--      bearer link, and contracts.read is checked per person.
--   4. The 127/141 same-owner trigger now also DERIVES org_id from the
--      project: an org project's file gets its org and must have no user_id;
--      a producer project's file keeps the 127 rule (same owner, producer
--      project). A file never moves between orgs, nor between an org and the
--      producer. It fires on INSERT and UPDATE OF user_id, project_id, org_id.
--   5. Reads: `labelos_org_asset_allowed(org, kind, sensitivity)` (SECURITY
--      DEFINER, the SQL twin of src/lib/labelos/org-assets.ts, held equal by
--      org-assets.test.ts) replaces 141's "artwork / lyrics, else
--      audio.working" in project_assets' org_member_read and org_member_guard:
--        visual (artwork, lyrics, photo, video) — catalog.read;
--        legal (contract, split_sheet)          — catalog.read (+ restricted);
--        anything else (working material)        — + audio.working;
--        restricted                              — + contracts.read.
--      Both policies keep 141's shape (EXISTS on the org project, scope via
--      can_see_org_project). Still SELECT only; org writes stay service-role
--      (141's labelos_org_rows_service_only on project_assets is unchanged).
--   6. Carried from LABEL-13 (#69): `track_stem_files` (080) gets 141 §3b's
--      RESTRICTIVE org_member_guard (an org track's stem files are hidden from
--      every API role) and §3c's service-only write trigger, before any org
--      surface lists stem files.
--
-- Proven as anon / authenticated / service_role in
-- supabase/local/checks/143_labelos_org_assets.sql.
--
-- Idempotent: IF NOT EXISTS, CREATE OR REPLACE, DROP ... IF EXISTS first,
-- CHECKs dropped and re-added.

-- ── 1. Columns ──────────────────────────────────────────────────────────

ALTER TABLE public.project_assets
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.project_assets
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.project_assets
  ADD COLUMN IF NOT EXISTS sensitivity text NOT NULL DEFAULT 'normal';

CREATE INDEX IF NOT EXISTS idx_project_assets_org
  ON public.project_assets (org_id, project_id, position)
  WHERE org_id IS NOT NULL;

-- ── 2 + 3. Ownerless org rows, kinds, sensitivity ───────────────────────

ALTER TABLE public.project_assets ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.project_assets DROP CONSTRAINT IF EXISTS project_assets_org_or_owner;
ALTER TABLE public.project_assets ADD CONSTRAINT project_assets_org_or_owner
  CHECK ((org_id IS NULL) = (user_id IS NOT NULL));

ALTER TABLE public.project_assets DROP CONSTRAINT IF EXISTS project_assets_kind_check;
ALTER TABLE public.project_assets ADD CONSTRAINT project_assets_kind_check
  CHECK (kind IN ('reference', 'artwork', 'lyrics', 'document', 'audio', 'other', 'photo', 'video', 'contract', 'split_sheet', 'session'));

ALTER TABLE public.project_assets DROP CONSTRAINT IF EXISTS project_assets_sensitivity_check;
ALTER TABLE public.project_assets ADD CONSTRAINT project_assets_sensitivity_check
  CHECK (sensitivity IN ('normal', 'restricted'));

ALTER TABLE public.project_assets DROP CONSTRAINT IF EXISTS project_assets_restricted_kinds;
ALTER TABLE public.project_assets ADD CONSTRAINT project_assets_restricted_kinds
  CHECK (kind NOT IN ('contract', 'split_sheet') OR sensitivity = 'restricted');

ALTER TABLE public.project_assets DROP CONSTRAINT IF EXISTS project_assets_restricted_not_in_portal;
ALTER TABLE public.project_assets ADD CONSTRAINT project_assets_restricted_not_in_portal
  CHECK (sensitivity = 'normal' OR NOT in_portal);

-- ── 4. Same owner, or same org (and then no owner) ──────────────────────

CREATE OR REPLACE FUNCTION public.project_assets_same_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid;
  v_owner uuid;
BEGIN
  SELECT p.org_id, p.user_id INTO v_org, v_owner FROM public.projects p WHERE p.id = NEW.project_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'project_assets: project % is not owned by %', NEW.project_id, NEW.user_id;
  END IF;
  IF TG_OP = 'UPDATE' AND v_org IS DISTINCT FROM OLD.org_id THEN
    RAISE EXCEPTION 'project_assets: a file cannot move between organizations'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.org_id IS NOT NULL AND NEW.org_id IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'project_assets: org_id must be the project''s organization'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.org_id := v_org;
  IF v_org IS NOT NULL THEN
    IF NEW.user_id IS NOT NULL THEN
      RAISE EXCEPTION 'project_assets: an organization file has no owner'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.user_id IS NULL OR v_owner IS DISTINCT FROM NEW.user_id THEN
    RAISE EXCEPTION 'project_assets: project % is not owned by %', NEW.project_id, NEW.user_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS project_assets_same_owner ON public.project_assets;
CREATE TRIGGER project_assets_same_owner
  BEFORE INSERT OR UPDATE OF user_id, project_id, org_id ON public.project_assets
  FOR EACH ROW EXECUTE FUNCTION public.project_assets_same_owner();

-- ── 5. Who reads an org file ────────────────────────────────────────────
-- Kind classes and sensitivity only; catalog.read and the project scope stay
-- in the policies (as 141 wrote them). auth.uid() is still the caller.

CREATE OR REPLACE FUNCTION public.labelos_org_asset_allowed(p_org uuid, p_kind text, p_sensitivity text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_visual text[] := ARRAY['artwork', 'lyrics', 'photo', 'video'];
  v_legal text[] := ARRAY['contract', 'split_sheet'];
BEGIN
  IF p_org IS NULL OR NOT public.has_org_cap(p_org, 'catalog.read') THEN
    RETURN false;
  END IF;
  IF NOT (p_kind = ANY (v_visual) OR p_kind = ANY (v_legal))
     AND NOT public.has_org_cap(p_org, 'audio.working') THEN
    RETURN false;
  END IF;
  IF p_sensitivity IS DISTINCT FROM 'normal' AND NOT public.has_org_cap(p_org, 'contracts.read') THEN
    RETURN false;
  END IF;
  RETURN true;
END;
$$;

ALTER FUNCTION public.labelos_org_asset_allowed(uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_org_asset_allowed(uuid, text, text) FROM PUBLIC;
-- anon too: the RESTRICTIVE guard applies to every role and Postgres does
-- not promise to short-circuit its OR. Without a session it is always false.
GRANT EXECUTE ON FUNCTION public.labelos_org_asset_allowed(uuid, text, text) TO authenticated, anon;

DROP POLICY IF EXISTS org_member_read ON public.project_assets;
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
        AND public.labelos_org_asset_allowed(p.org_id, project_assets.kind, project_assets.sensitivity)
    )
  );

DROP POLICY IF EXISTS org_member_guard ON public.project_assets;
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
        AND public.labelos_org_asset_allowed(p.org_id, project_assets.kind, project_assets.sensitivity)
    )
  );

-- ── 6. track_stem_files (carried from LABEL-13) ─────────────────────────

DROP POLICY IF EXISTS org_member_guard ON public.track_stem_files;
CREATE POLICY org_member_guard ON public.track_stem_files
  AS RESTRICTIVE FOR SELECT
  USING (NOT public.labelos_is_org_track(track_id));

DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.track_stem_files;
CREATE TRIGGER labelos_org_rows_service_only BEFORE INSERT OR UPDATE OR DELETE ON public.track_stem_files
  FOR EACH ROW EXECUTE FUNCTION public.labelos_org_rows_service_only('track', 'track_id');

NOTIFY pgrst, 'reload schema';
