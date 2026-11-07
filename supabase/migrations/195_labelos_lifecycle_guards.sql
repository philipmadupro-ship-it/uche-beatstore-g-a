-- 195_labelos_lifecycle_guards.sql
-- Label OS (LABEL-75, lifecycle decisions): five database guards.
--
-- LABEL OS — NOT APPLIED. Apply at the final merge of the Label OS branch into
-- main. Never part of supabase/apply/pending.sql.
--
--  1. A sole owner's account cannot be deleted. 136's deferred trigger
--     `org_members_keep_an_owner` already refuses the cascade at COMMIT, but with
--     a raw check_violation. A BEFORE DELETE trigger on auth.users now refuses
--     first, in words: "transfer ownership or delete the organization first".
--     Only an organization that still exists counts (a purged org has no member
--     rows left). A second owner makes the account deletable.
--  2. `split_lines`: the API roles lose the table-wide SELECT and keep every
--     column except `signature_asset_id` and `signed_by` (who signed and the
--     signed document). 162 did the same for `split_sheets`; the own-line
--     reader (D2) reads their line through RLS, and RLS is per row.
--     Every server route reads split_lines with the service role.
--  3. `activity_events` cannot be TRUNCATEd (163 guards UPDATE and DELETE row by
--     row; a statement-level TRUNCATE bypasses row triggers).
--  4. `activity_events_member_read` (147) called has_org_cap(org_id, …) per
--     event row. The same two tests are now uncorrelated subqueries over the
--     caller's own memberships, planned once (R-08). Same rows, same result;
--     the scope disjuncts are 147's, unchanged.
--  6. `labelos_platform_create_licensee` (170) inserts `org.created` with audit = true (the backlog makes it audit-class). Rows
--     written before this stay non-audit (163 forbids promotion); the prune already skips them by verb.
--  5. An organization row is deleted only when `deleted_at` is older than the
--     30-day grace period (D10): audit history can then only be erased by the
--     purge. Cascades from the organization's own children are unaffected (this
--     is a trigger ON organizations).
--
-- No function or policy defined by a HIGHER-numbered migration is redefined here
-- (checked: nothing after 147 defines activity_events_member_read; nothing after
-- 155 grants or revokes on split_lines).
--
-- Idempotent: CREATE OR REPLACE, DROP … IF EXISTS first, REVOKE then GRANT.

-- ── 1. sole owner ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.labelos_block_sole_owner_account_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.org_members m
    JOIN public.organizations o ON o.id = m.org_id
    WHERE m.user_id = OLD.id
      AND m.role = 'owner'
      AND NOT EXISTS (
        SELECT 1 FROM public.org_members m2
        WHERE m2.org_id = m.org_id AND m2.role = 'owner' AND m2.user_id <> OLD.id
      )
  ) THEN
    RAISE EXCEPTION 'this account is the only owner of an organization: transfer ownership or delete the organization first'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END;
$$;

ALTER FUNCTION public.labelos_block_sole_owner_account_delete() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_block_sole_owner_account_delete() FROM PUBLIC;

DROP TRIGGER IF EXISTS labelos_block_sole_owner_account_delete ON auth.users;
CREATE TRIGGER labelos_block_sole_owner_account_delete
  BEFORE DELETE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.labelos_block_sole_owner_account_delete();

-- ── 2. split_lines column grant ──────────────────────────────────────────

REVOKE SELECT ON public.split_lines FROM anon, authenticated;
GRANT SELECT (id, split_sheet_id, org_id, track_id, party_id, role, share, position, signed_at, signature_method, created_at)
  ON public.split_lines TO authenticated;
GRANT SELECT (id, split_sheet_id, org_id, track_id, party_id, role, share, position, signed_at, signature_method, created_at)
  ON public.split_lines TO anon;

-- ── 3. activity_events: no TRUNCATE ──────────────────────────────────────

CREATE OR REPLACE FUNCTION public.activity_events_no_truncate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'activity_events: the audit log is never truncated' USING ERRCODE = 'insufficient_privilege';
END;
$$;

ALTER FUNCTION public.activity_events_no_truncate() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.activity_events_no_truncate() FROM PUBLIC;

DROP TRIGGER IF EXISTS activity_events_no_truncate ON public.activity_events;
CREATE TRIGGER activity_events_no_truncate
  BEFORE TRUNCATE ON public.activity_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.activity_events_no_truncate();

-- ── 4. activity_events_member_read without per-row has_org_cap ───────────

DROP POLICY IF EXISTS activity_events_member_read ON public.activity_events;
CREATE POLICY activity_events_member_read ON public.activity_events
  FOR SELECT
  USING (
    org_id IN (
      SELECT cm.org_id
      FROM public.org_members cm
      WHERE cm.user_id = (SELECT auth.uid())
        AND public.has_org_cap(cm.org_id, 'catalog.read')
    )
    AND (
      visibility = 'artist'
      OR org_id IN (
        SELECT im.org_id
        FROM public.org_members im
        WHERE im.user_id = (SELECT auth.uid())
          AND public.has_org_cap(im.org_id, 'business.read.internal')
      )
    )
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

-- ── 5. organizations: delete only past the grace period ──────────────────

CREATE OR REPLACE FUNCTION public.organizations_delete_after_grace()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.deleted_at IS NULL OR OLD.deleted_at > now() - interval '30 days' THEN
    RAISE EXCEPTION 'organization % is deleted only by the purge, 30 days after it was scheduled for deletion', OLD.id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN OLD;
END;
$$;

ALTER FUNCTION public.organizations_delete_after_grace() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.organizations_delete_after_grace() FROM PUBLIC;

DROP TRIGGER IF EXISTS organizations_delete_after_grace ON public.organizations;
CREATE TRIGGER organizations_delete_after_grace
  BEFORE DELETE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.organizations_delete_after_grace();

-- ── 6. console-created orgs: org.created is audit-class ─────────────────
-- Redefines 170's function (nothing after 170 defines it); only the org.created insert changes (audit = true).

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

  -- org.created is audit-class since LABEL-75 (195): kept for the life of the org, never pruned.
  INSERT INTO public.activity_events (org_id, actor_id, verb, subject_type, subject_id, payload, audit, visibility)
  VALUES (v_org.id, p_actor, 'org.created', 'org', v_org.id,
          jsonb_build_object('source', 'platform', 'kind', v_org.kind), true, 'internal');
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
