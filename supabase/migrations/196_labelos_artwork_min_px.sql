-- 196_labelos_artwork_min_px.sql
-- Label OS (LABEL-76): the owner can set the cover-art minimum size.
--
-- LABEL OS — NOT APPLIED. Apply at the final merge of the Label OS branch
-- into main (docs/bstudio-label-os/16-execution-runbook.md), after 195.
--
-- `organizations.settings.artwork_min_px` has been read since LABEL-52
-- (`OrgReadinessSettingsSchema`: whole pixels 600..10000, anything else reads
-- as 3000) but could only be written by SQL: the settings validator refused
-- every key it did not list. This redefines ONLY that validator,
-- `labelos_validate_org_settings_patch` (192's body, copied unchanged), with
-- one new branch: `artwork_min_px` is a JSON number, whole, 600..10000.
-- Same range as the TypeScript parser; the PATCH route's Zod schema agrees.
-- 172's / 187's / 192's callers all go through it, so the settings screen and
-- the atomic audit function accept the key with no other change. Owner,
-- grants and SECURITY settings are exactly 192's. No table, no policy.
--
-- Idempotent: CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.labelos_validate_org_settings_patch(p_patch jsonb)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $fn$
DECLARE
  v_key text;
  v_val jsonb;
  v_elem jsonb;
  v_modules constant text[] := ARRAY['contracts', 'finance', 'marketing', 'pr', 'executive', 'artistic', 'store', 'search', 'digest'];
  v_contract_types constant text[] := ARRAY['recording', 'distribution', 'licence', 'deal_360', 'producer', 'feature', 'co_publishing', 'management'];
BEGIN
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'settings patch must be an object' USING ERRCODE = '22023';
  END IF;

  FOR v_key, v_val IN SELECT key, value FROM jsonb_each(p_patch) LOOP
    IF v_key IN ('legal_gate', 'marketing_gate') THEN
      IF v_val NOT IN ('"on"'::jsonb, '"off"'::jsonb) THEN
        RAISE EXCEPTION '% must be "on" or "off"', v_key USING ERRCODE = '22023';
      END IF;
    ELSIF v_key = 'require_signed_master_split' THEN
      IF jsonb_typeof(v_val) <> 'boolean' THEN
        RAISE EXCEPTION '% must be a boolean', v_key USING ERRCODE = '22023';
      END IF;
    ELSIF v_key IN ('attention_release_days', 'attention_stalled_days') THEN
      IF jsonb_typeof(v_val) <> 'number' OR (v_val #>> '{}') !~ '^[0-9]{1,3}$'
         OR (v_val #>> '{}')::int NOT BETWEEN 1 AND 365 THEN
        RAISE EXCEPTION '% must be a whole number of days from 1 to 365', v_key USING ERRCODE = '22023';
      END IF;
    ELSIF v_key = 'departments_off' THEN
      IF jsonb_typeof(v_val) <> 'array' THEN
        RAISE EXCEPTION 'departments_off must be an array' USING ERRCODE = '22023';
      END IF;
      FOR v_elem IN SELECT value FROM jsonb_array_elements(v_val) LOOP
        IF jsonb_typeof(v_elem) <> 'string' OR NOT ((v_elem #>> '{}') = ANY (v_modules)) THEN
          RAISE EXCEPTION 'departments_off holds an unknown department' USING ERRCODE = '22023';
        END IF;
      END LOOP;
    ELSIF v_key = 'contract_types' THEN
      IF jsonb_typeof(v_val) <> 'array' THEN
        RAISE EXCEPTION 'contract_types must be an array' USING ERRCODE = '22023';
      END IF;
      FOR v_elem IN SELECT value FROM jsonb_array_elements(v_val) LOOP
        IF jsonb_typeof(v_elem) <> 'string' OR NOT ((v_elem #>> '{}') = ANY (v_contract_types)) THEN
          RAISE EXCEPTION 'contract_types holds an unknown contract type' USING ERRCODE = '22023';
        END IF;
      END LOOP;
    ELSIF v_key = 'artwork_min_px' THEN
      IF jsonb_typeof(v_val) <> 'number' OR (v_val #>> '{}') !~ '^[0-9]{3,5}$'
         OR (v_val #>> '{}')::int NOT BETWEEN 600 AND 10000 THEN
        RAISE EXCEPTION '% must be a whole number of pixels from 600 to 10000', v_key USING ERRCODE = '22023';
      END IF;
    ELSE
      RAISE EXCEPTION 'unknown setting %', v_key USING ERRCODE = '22023';
    END IF;
  END LOOP;
END;
$fn$;

ALTER FUNCTION public.labelos_validate_org_settings_patch(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_validate_org_settings_patch(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_validate_org_settings_patch(jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
