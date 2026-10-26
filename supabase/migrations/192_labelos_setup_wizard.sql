-- 192_labelos_setup_wizard.sql
-- Label OS (LABEL-48): the setup wizard creates the organization WITH its
-- settings in one transaction.
--
-- LABEL OS — NOT APPLIED. Apply at the final merge of the Label OS branch
-- into main, after 189 (docs/bstudio-label-os/16-execution-runbook.md).
-- Numbered 192: 191 is PR #135's, 173–187 belong to other tasks.
--
-- The wizard (/setup) keeps its state in the browser and creates nothing
-- until its last step. That step is ONE call: POST /api/org/setup now carries
-- the choices it collected (gates, departments off, contract types) and
-- `labelos_setup_org` stores them with the organization row, so a setup never
-- leaves an org with the defaults it was meant to replace. Roster artists,
-- invitations, team logins and the first draft release reuse their own routes
-- afterwards; none of their rules is copied here.
--
--  * labelos_validate_org_settings_patch(p_patch) — the ONE copy of the
--    rules for the owner-editable keys of `organizations.settings`, taken out
--    of 172's `labelos_audit_org_settings` so the settings screen and the
--    setup call it cannot disagree. Same rules as 172 plus the new key
--    `contract_types` (LABEL-48: an array of known contract type ids; only the
--    choice is stored, templates are LABEL-57). Raises 22023.
--  * labelos_audit_org_settings is replaced: identical to 172 except that it
--    calls the validator instead of carrying the rules inline.
--  * labelos_setup_org(p_user, p_kind, p_name, p_settings) replaces 189's
--    three-argument function (dropped first so a call is never ambiguous):
--    same behaviour, and the validated settings are written on the INSERT.
--    A caller that already has a self-served org still gets it back
--    ({"created": false}); the settings are ignored then, they are not an
--    edit. `p_settings` defaults to '{}', so the old call shape keeps working.
--
-- No table, no policy, no column. Only service_role executes any of it.
--
-- Idempotent: CREATE OR REPLACE / DROP IF EXISTS.

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
    ELSE
      RAISE EXCEPTION 'unknown setting %', v_key USING ERRCODE = '22023';
    END IF;
  END LOOP;
END;
$fn$;

ALTER FUNCTION public.labelos_validate_org_settings_patch(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_validate_org_settings_patch(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_validate_org_settings_patch(jsonb) TO service_role;

-- ── 172's audit function, now calling the shared validator ───────────────

CREATE OR REPLACE FUNCTION public.labelos_audit_org_settings(
  p_org uuid,
  p_actor uuid,
  p_patch jsonb,
  p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_settings jsonb;
BEGIN
  PERFORM public.labelos_validate_org_settings_patch(p_patch);
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'audit payload must be an object' USING ERRCODE = '22023';
  END IF;

  SELECT o.settings INTO v_settings
  FROM public.organizations o
  WHERE o.id = p_org AND o.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF p_actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.org_members m WHERE m.org_id = p_org AND m.user_id = p_actor AND m.role = 'owner'
  ) THEN
    RETURN jsonb_build_object('error', 'not_owner');
  END IF;

  v_settings := coalesce(v_settings, '{}'::jsonb) || p_patch;
  UPDATE public.organizations SET settings = v_settings WHERE id = p_org;

  PERFORM public.labelos_audit_insert(p_org, p_actor, 'org.settings_changed', 'org', p_org, p_payload);

  RETURN jsonb_build_object('settings', v_settings);
END;
$fn$;

ALTER FUNCTION public.labelos_audit_org_settings(uuid, uuid, jsonb, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_audit_org_settings(uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_audit_org_settings(uuid, uuid, jsonb, jsonb) TO service_role;

-- ── 189's setup function, with the wizard's settings ────────────────────

DROP FUNCTION IF EXISTS public.labelos_setup_org(uuid, text, text);

CREATE OR REPLACE FUNCTION public.labelos_setup_org(
  p_user     uuid,
  p_kind     text,
  p_name     text,
  p_settings jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_name     text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_settings jsonb := coalesce(p_settings, '{}'::jsonb);
  v_org      uuid;
  v_slug     text;
  v_kind     text;
  v_base     text;
  v_try      int := 1;
BEGIN
  IF p_user IS NULL THEN
    RAISE EXCEPTION 'labelos_setup_org: user required' USING ERRCODE = '22023';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('artist', 'label') THEN
    RAISE EXCEPTION 'labelos_setup_org: kind must be artist or label' USING ERRCODE = '22023';
  END IF;
  IF v_name = '' OR length(v_name) > 80 THEN
    RAISE EXCEPTION 'labelos_setup_org: name must be 1 to 80 characters' USING ERRCODE = '22023';
  END IF;
  -- Before the lock and before anything is written: a bad value is a refusal, not a half-made org.
  PERFORM public.labelos_validate_org_settings_patch(v_settings);

  PERFORM pg_advisory_xact_lock(hashtextextended('labelos.setup_org:' || p_user::text, 0));

  -- Already set up: answer the org this account created. Settings are not an edit.
  SELECT o.id, o.slug, o.kind INTO v_org, v_slug, v_kind
  FROM public.organizations o
  WHERE o.created_by = p_user
    AND o.kind IN ('artist', 'label')
    AND o.deleted_at IS NULL
  ORDER BY o.created_at, o.id
  LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('org_id', v_org, 'slug', v_slug, 'kind', v_kind, 'created', false);
  END IF;

  v_base := coalesce(nullif(public.labelos_slugify(v_name), ''), CASE WHEN p_kind = 'label' THEN 'label' ELSE 'artist' END);

  -- organizations.slug is unique across every org (same loop as 137).
  LOOP
    v_slug := CASE WHEN v_try = 1 THEN v_base ELSE left(v_base, 35) || '-' || v_try END;
    IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE slug = v_slug) THEN
      BEGIN
        INSERT INTO public.organizations (name, slug, kind, created_by, settings)
        VALUES (v_name, v_slug, p_kind, p_user, v_settings)
        RETURNING id INTO v_org;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        NULL; -- taken meanwhile: next candidate
      END;
    END IF;
    v_try := v_try + 1;
    IF v_try > 1000 THEN
      RAISE EXCEPTION 'no free organization slug for base %', v_base;
    END IF;
  END LOOP;

  INSERT INTO public.org_members (org_id, user_id, role, scope)
  VALUES (v_org, p_user, 'owner', 'org');

  RETURN jsonb_build_object('org_id', v_org, 'slug', v_slug, 'kind', p_kind, 'created', true);
END;
$fn$;

ALTER FUNCTION public.labelos_setup_org(uuid, text, text, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_setup_org(uuid, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.labelos_setup_org(uuid, text, text, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_setup_org(uuid, text, text, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
