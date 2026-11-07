-- 197_labelos_setup_org_audit_adopt.sql
-- Label OS, review G12 fixes (M1 + the setup_done gap).
--
-- LABEL OS — NOT APPLIED. Paste after 196 (docs/bstudio-label-os/28-migration-apply-order.md).
--
--  * M1 — `org.created` of a self-served org is written INSIDE
--    `labelos_setup_org`, in the same transaction as the org and its owner
--    row. It is audit-class since 195, and the route used to write it after the
--    call (best effort), so a failure there left an org with no creation
--    record. The route no longer writes it. The "already set up" answer writes
--    nothing.
--  * setup_done — an operator-created licensee (170: `created_by` NULL, an
--    `org_entitlements` row with `setup_done = false`) is ADOPTED by its owner
--    when they run the wizard: instead of creating a second org, the function
--    finds the one org the caller owns that has no creator and an unfinished
--    setup, merges the wizard's settings into it, sets `setup_done = true`
--    and records `org.settings_changed` (audit) with `source: 'setup'`. The
--    operator's org name is kept. It answers {"created": false, "adopted": true}.
--    A self-served org has no entitlement row, so it needs no flag. An owner of an
--    operator-created org that is ALREADY set up gets that org back (created false),
--    never a second one.
--
-- DEPLOY ORDER: apply 197 BEFORE the code that ships with it. If the code runs
-- against the old function, (a) org.created is silently not written at all (the
-- route no longer writes it and 192's function does not either), and (b) the
-- redirect of an unfinished owner to /setup plus the old function creates a
-- SECOND org for them.
--
-- Same four-argument signature, owner and grants as 192; only the body differs.
-- Idempotent: CREATE OR REPLACE.

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

  -- ORDER MATTERS: the self-served check above comes first, so a user who already has a self-served org is
  -- answered with that org and an unfinished operator org they also own is not adopted (accepted edge case).
  -- An operator-created licensee the caller owns and has not set up yet: adopt it, do not make a second org.
  SELECT o.id, o.slug, o.kind INTO v_org, v_slug, v_kind
  FROM public.organizations o
  JOIN public.org_members m ON m.org_id = o.id AND m.user_id = p_user AND m.role = 'owner'
  JOIN public.org_entitlements e ON e.org_id = o.id AND e.setup_done = false
  WHERE o.created_by IS NULL
    AND o.kind IN ('artist', 'label')
    AND o.deleted_at IS NULL
  ORDER BY o.created_at, o.id
  LIMIT 1
  FOR UPDATE OF o, e;
  IF FOUND THEN
    UPDATE public.organizations
    SET settings = coalesce(settings, '{}'::jsonb) || v_settings
    WHERE id = v_org;
    UPDATE public.org_entitlements SET setup_done = true WHERE org_id = v_org;
    PERFORM public.labelos_audit_insert(v_org, p_user, 'org.settings_changed', 'org', v_org,
      jsonb_build_object('source', 'setup', 'adopted', true,
        'settings', (SELECT coalesce(jsonb_agg(k ORDER BY k), '[]'::jsonb) FROM jsonb_object_keys(v_settings) AS k)));
    RETURN jsonb_build_object('org_id', v_org, 'slug', v_slug, 'kind', v_kind, 'created', false, 'adopted', true);
  END IF;

  -- An operator-created licensee the caller owns that is already set up: answer it (a repeat or a double submit), never a second org.
  SELECT o.id, o.slug, o.kind INTO v_org, v_slug, v_kind
  FROM public.organizations o
  JOIN public.org_members m ON m.org_id = o.id AND m.user_id = p_user AND m.role = 'owner'
  JOIN public.org_entitlements e ON e.org_id = o.id
  WHERE o.created_by IS NULL
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

  -- Audit-class since 195: written in this transaction, so an org never exists without its creation record.
  PERFORM public.labelos_audit_insert(v_org, p_user, 'org.created', 'org', v_org,
    jsonb_build_object('kind', p_kind, 'source', 'setup',
      'settings', (SELECT coalesce(jsonb_agg(k ORDER BY k), '[]'::jsonb) FROM jsonb_object_keys(v_settings) AS k)));

  RETURN jsonb_build_object('org_id', v_org, 'slug', v_slug, 'kind', p_kind, 'created', true);
END;
$fn$;

ALTER FUNCTION public.labelos_setup_org(uuid, text, text, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_setup_org(uuid, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.labelos_setup_org(uuid, text, text, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_setup_org(uuid, text, text, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
