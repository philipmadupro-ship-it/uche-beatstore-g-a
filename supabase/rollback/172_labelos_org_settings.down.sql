-- Rollback for 172_labelos_org_settings.sql (LABEL-51).
--
-- Lives outside supabase/migrations/ on purpose: scripts/apply-migrations.sh
-- applies every *.sql in that folder. Run by hand only.
--
-- Drops the settings audit function and restores 143's asset helper. `organizations.settings` keeps whatever
-- the owner saved (release readiness and Needs attention read it unchanged);
-- `departments_off` is then ignored by no one, so remove that key by hand if
-- the rollback is meant to switch departments back on:
--   UPDATE public.organizations SET settings = settings - 'departments_off';

DROP FUNCTION IF EXISTS public.labelos_audit_org_settings(uuid, uuid, jsonb, jsonb);

-- Put back 143's labelos_org_asset_allowed, word for word.
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
GRANT EXECUTE ON FUNCTION public.labelos_org_asset_allowed(uuid, text, text) TO authenticated, anon;

NOTIFY pgrst, 'reload schema';
