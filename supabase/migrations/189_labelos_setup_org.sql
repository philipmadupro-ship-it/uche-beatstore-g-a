-- 189_labelos_setup_org.sql
-- Label OS (LABEL-48, first slice): self-service organization setup.
--
-- LABEL OS — NOT APPLIED. Apply at the final merge of the Label OS branch
-- into main, after 136–169 (docs/bstudio-label-os/16-execution-runbook.md).
-- Numbered 189 because 162–188 are reserved for the phase 2 tasks (doc 23).
--
-- A new account that is neither the producer nor a member of anything used
-- to land on the buyer account page with no way to an organization. /setup
-- now asks what it is and calls this function through POST /api/org/setup
-- (src/lib/labelos/setup.ts):
--   - 'artist' (the "independent artist / producer" face): the org and the
--     caller as owner. Its one roster artist (named after the org, with the
--     caller's email) is made by 139's AFTER INSERT trigger
--     `labelos_artist_org_self_contact`, inside the same insert (D1);
--   - 'label': the org and the caller as owner.
-- All of it in this one transaction, so a failure leaves nothing half-made.
--
-- One self-served org per account: a caller who already CREATED a live
-- artist or label org gets that org back ({"created": false}), so a double
-- click or a retried request never makes two. The `producer` kind is never
-- self-served (migration 137 owns it). A per-user advisory lock serialises
-- concurrent calls.
--
-- Only service_role may execute it; the route authenticates the session and
-- passes the caller's own id. Like 137, it runs as postgres, so 136's
-- column grants and the absence of an org_members INSERT policy do not apply.
-- The `org.created` activity event is written by the route (recordEvent).
--
-- Idempotent: CREATE OR REPLACE. No table is created or altered.

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

NOTIFY pgrst, 'reload schema';
