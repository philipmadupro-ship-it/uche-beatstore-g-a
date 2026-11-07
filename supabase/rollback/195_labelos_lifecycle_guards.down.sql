-- Rollback for 195_labelos_lifecycle_guards.sql (LABEL-75).
--
-- Lives outside supabase/migrations/ on purpose: scripts/apply-migrations.sh applies every *.sql in that folder. Run by
-- hand only. Puts back 147's per-row policy and 155's table-wide SELECT on split_lines (162 changed split_sheets only).

DROP TRIGGER IF EXISTS organizations_delete_after_grace ON public.organizations;
DROP FUNCTION IF EXISTS public.organizations_delete_after_grace();

DROP POLICY IF EXISTS activity_events_member_read ON public.activity_events;
CREATE POLICY activity_events_member_read ON public.activity_events
  FOR SELECT
  USING (
    (SELECT public.has_org_cap(org_id, 'catalog.read'))
    AND (visibility = 'artist' OR (SELECT public.has_org_cap(org_id, 'business.read.internal')))
    AND (
      org_id IN (
        SELECT om.org_id
        FROM public.org_members om
        WHERE om.user_id = (SELECT auth.uid())
          AND om.scope = 'org'
          AND om.role <> 'artist'
      )
      OR (
        artist_id IS NOT NULL
        AND (org_id, artist_id) IN (
          SELECT s.org_id, s.contact_id
          FROM public.member_artist_scopes s
          WHERE s.user_id = (SELECT auth.uid())
        )
      )
      OR (
        artist_id IS NULL
        AND project_id IS NOT NULL
        AND (org_id, project_id) IN (SELECT sp.org_id, sp.project_id FROM public.labelos_scoped_projects() sp)
      )
    )
  );

DROP TRIGGER IF EXISTS activity_events_no_truncate ON public.activity_events;
DROP FUNCTION IF EXISTS public.activity_events_no_truncate();

GRANT SELECT ON public.split_lines TO authenticated, anon;

DROP TRIGGER IF EXISTS labelos_block_sole_owner_account_delete ON auth.users;
DROP FUNCTION IF EXISTS public.labelos_block_sole_owner_account_delete();

-- Puts back 170's licensee function (org.created as an everyday event).
CREATE OR REPLACE FUNCTION public.labelos_platform_create_licensee(
  p_actor uuid,
  p_name text,
  p_slug text,
  p_kind text,
  p_modules text[],
  p_max_seats int,
  p_max_artists int,
  p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_org public.organizations%ROWTYPE;
BEGIN
  IF p_actor IS NULL OR NOT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = p_actor) THEN
    RETURN jsonb_build_object('error', 'not_operator');
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('artist', 'label') THEN
    RAISE EXCEPTION 'a licensee is an artist or a label org' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.organizations WHERE slug = p_slug) THEN
    RETURN jsonb_build_object('error', 'slug_taken');
  END IF;

  -- created_by stays NULL: the operator is not a member, and 139's trigger
  -- would otherwise give an artist org's own artist contact the operator's email.
  BEGIN
    INSERT INTO public.organizations (name, slug, kind, created_by)
    VALUES (p_name, p_slug, p_kind, NULL)
    RETURNING * INTO v_org;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('error', 'slug_taken');
  END;

  INSERT INTO public.org_entitlements (org_id, modules, max_seats, max_artists, setup_done, granted_by, granted_at)
  VALUES (v_org.id, coalesce(p_modules, '{}'), p_max_seats, p_max_artists, false, p_actor, now());

  -- org.created is an everyday event (recordEvent's class), like every other org's.
  INSERT INTO public.activity_events (org_id, actor_id, verb, subject_type, subject_id, payload, audit, visibility)
  VALUES (v_org.id, p_actor, 'org.created', 'org', v_org.id,
          jsonb_build_object('source', 'platform', 'kind', v_org.kind), false, 'internal');
  PERFORM public.labelos_audit_insert(v_org.id, p_actor, 'org.entitlements_changed', 'org', v_org.id, p_payload);

  RETURN jsonb_build_object('org', jsonb_build_object(
    'id', v_org.id, 'name', v_org.name, 'slug', v_org.slug, 'kind', v_org.kind, 'created_at', v_org.created_at
  ));
END;
$fn$;

ALTER FUNCTION public.labelos_platform_create_licensee(uuid, text, text, text, text[], int, int, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_platform_create_licensee(uuid, text, text, text, text[], int, int, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_platform_create_licensee(uuid, text, text, text, text[], int, int, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
