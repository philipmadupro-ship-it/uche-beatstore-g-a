-- Rollback for 197_labelos_setup_org_audit_adopt.sql.
--
-- Lives outside supabase/migrations/ on purpose: run by hand only.
--
-- Puts back 192's labelos_setup_org word for word: no org.created inside the
-- function (the route must then write it again) and no adoption. Orgs adopted
-- or created meanwhile keep their rows and events.

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
