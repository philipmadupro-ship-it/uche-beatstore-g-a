-- Rollback for 192_labelos_setup_wizard.sql (LABEL-48).
--
-- Lives outside supabase/migrations/ on purpose: scripts/apply-migrations.sh
-- applies every *.sql in that folder. Run by hand only.
--
-- Puts back 172's audit function and 189's three-argument setup function word
-- for word, and drops the shared validator and the four-argument setup
-- function. Organizations created through the wizard keep their settings; a
-- stored `contract_types` is simply ignored (172's function would refuse to
-- WRITE it again). POST /api/org/setup then fails on the missing four-argument
-- function until 192 is applied again.

DROP FUNCTION IF EXISTS public.labelos_setup_org(uuid, text, text, jsonb);

CREATE OR REPLACE FUNCTION public.labelos_setup_org(
  p_user  uuid,
  p_kind  text,
  p_name  text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_name  text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_org   uuid;
  v_slug  text;
  v_kind  text;
  v_base  text;
  v_try   int := 1;
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

  PERFORM pg_advisory_xact_lock(hashtextextended('labelos.setup_org:' || p_user::text, 0));

  -- Already set up: answer the org this account created.
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
        INSERT INTO public.organizations (name, slug, kind, created_by)
        VALUES (v_name, v_slug, p_kind, p_user)
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

ALTER FUNCTION public.labelos_setup_org(uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_setup_org(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.labelos_setup_org(uuid, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_setup_org(uuid, text, text) TO service_role;

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
  v_key text;
  v_val jsonb;
  v_elem jsonb;
  v_modules constant text[] := ARRAY['contracts', 'finance', 'marketing', 'pr', 'executive', 'artistic', 'store', 'search', 'digest'];
  v_settings jsonb;
BEGIN
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'settings patch must be an object' USING ERRCODE = '22023';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'audit payload must be an object' USING ERRCODE = '22023';
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
    ELSE
      RAISE EXCEPTION 'unknown setting %', v_key USING ERRCODE = '22023';
    END IF;
  END LOOP;

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

DROP FUNCTION IF EXISTS public.labelos_validate_org_settings_patch(jsonb);

NOTIFY pgrst, 'reload schema';
