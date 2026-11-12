-- Rollback for 148_labelos_project_members.sql (LABEL-21).
--
-- Lives outside supabase/migrations/ on purpose: scripts/apply-migrations.sh
-- applies every *.sql in that folder. Run by hand only.
--
-- "Drop the table; flag off." (docs/bstudio-label-os/14-engineering-backlog.md,
-- LABEL-21 Rollback), plus putting 139's accept function and 146's invitation
-- create function back, since 148 replaced both with the same signature.
--
--   - external memberships are deleted with the table: those people lose
--     access, which is the point of a rollback;
--   - project invitations are deleted (they can no longer be accepted, and
--     139's accept function would answer "unsupported" for them anyway);
--   - audit events 148's functions wrote STAY (06 §6: audit rows are never
--     deleted); tracks uploaded by external members stay in their projects
--     with `created_by` intact (D3);
--   - `org_invitations.project_allow_downloads` is dropped; `project_id` /
--     `project_role` belong to 136 and stay.
--
-- 139's labelos_accept_invitation and 146's labelos_audit_invitation_create
-- are restored by re-creating their bodies, which differ from 148's only in
-- the project branch and the project_id filter.

DROP FUNCTION IF EXISTS public.labelos_audit_project_member_remove(uuid, uuid, uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS public.labelos_audit_project_member_update(uuid, uuid, uuid, uuid, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.labelos_audit_project_invitation_create(uuid, uuid, uuid, text, text, boolean, text, timestamptz, jsonb);
DROP FUNCTION IF EXISTS public.labelos_audit_insert_project(uuid, uuid, text, text, uuid, uuid, jsonb);

-- Project invitations first: 139's function cannot accept them.
DELETE FROM public.org_invitations WHERE project_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.labelos_audit_invitation_create(
  p_org uuid,
  p_actor uuid,
  p_email text,
  p_role text,
  p_functions text[],
  p_artist_ids uuid[],
  p_token_hash text,
  p_expires_at timestamptz,
  p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_pending uuid;
  v_inv     public.org_invitations%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_org::text || ':' || p_email, 0));

  SELECT i.id INTO v_pending
  FROM public.org_invitations i
  WHERE i.org_id = p_org AND i.email = p_email
    AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
  ORDER BY i.created_at ASC, i.id ASC
  LIMIT 1;
  IF v_pending IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'pending', 'id', v_pending);
  END IF;

  INSERT INTO public.org_invitations (org_id, email, role, functions, artist_ids, token_hash, expires_at, invited_by)
  VALUES (p_org, p_email, p_role, COALESCE(p_functions, '{}'), COALESCE(p_artist_ids, '{}'), p_token_hash, p_expires_at, p_actor)
  RETURNING * INTO v_inv;

  PERFORM public.labelos_audit_insert(p_org, p_actor, 'invitation.created', 'invitation', v_inv.id, p_payload);

  RETURN jsonb_build_object('invitation', jsonb_build_object(
    'id', v_inv.id,
    'email', v_inv.email,
    'role', v_inv.role,
    'functions', to_jsonb(v_inv.functions),
    'artist_ids', to_jsonb(v_inv.artist_ids),
    'expires_at', v_inv.expires_at,
    'accepted_at', v_inv.accepted_at,
    'revoked_at', v_inv.revoked_at,
    'created_at', v_inv.created_at
  ));
END;
$fn$;

ALTER FUNCTION public.labelos_audit_invitation_create(uuid, uuid, text, text, text[], uuid[], text, timestamptz, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_audit_invitation_create(uuid, uuid, text, text, text[], uuid[], text, timestamptz, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_audit_invitation_create(uuid, uuid, text, text, text[], uuid[], text, timestamptz, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.labelos_accept_invitation(p_token_hash text, p_user uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_email     text;
  v_confirmed timestamptz;
  v_inv       public.org_invitations%ROWTYPE;
  v_rows      int;
  v_scope     text;
  v_scoped    uuid[] := '{}';
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' OR p_user IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  SELECT lower(btrim(u.email)), u.email_confirmed_at INTO v_email, v_confirmed
  FROM auth.users u WHERE u.id = p_user;
  IF v_email IS NULL OR v_email = '' THEN
    RETURN jsonb_build_object('error', 'email_mismatch');
  END IF;

  SELECT i.* INTO v_inv
  FROM public.org_invitations i
  JOIN public.organizations o ON o.id = i.org_id
  WHERE i.token_hash = p_token_hash
    AND o.deleted_at IS NULL
  FOR UPDATE OF i;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  IF v_inv.email <> v_email THEN
    RETURN jsonb_build_object('error', 'email_mismatch');
  END IF;
  IF v_confirmed IS NULL THEN
    RETURN jsonb_build_object('error', 'email_unverified');
  END IF;
  IF v_inv.project_id IS NOT NULL OR v_inv.role = 'owner' THEN
    RETURN jsonb_build_object('error', 'unsupported');
  END IF;
  IF v_inv.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'revoked');
  END IF;
  IF v_inv.accepted_at IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.org_members WHERE org_id = v_inv.org_id AND user_id = p_user) THEN
      RETURN jsonb_build_object('status', 'already_member', 'org_id', v_inv.org_id);
    END IF;
    RETURN jsonb_build_object('error', 'used');
  END IF;
  IF v_inv.expires_at <= now() THEN
    RETURN jsonb_build_object('error', 'expired');
  END IF;
  IF v_inv.invited_by IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.org_members m
    WHERE m.org_id = v_inv.org_id AND m.user_id = v_inv.invited_by AND m.role IN ('owner', 'admin')
  ) THEN
    RETURN jsonb_build_object('error', 'revoked');
  END IF;

  v_scope := CASE WHEN v_inv.role = 'artist' OR cardinality(v_inv.artist_ids) > 0 THEN 'artists' ELSE 'org' END;

  INSERT INTO public.org_members (org_id, user_id, role, functions, scope, invited_by)
  VALUES (
    v_inv.org_id,
    p_user,
    v_inv.role,
    CASE WHEN v_inv.role = 'member' THEN v_inv.functions ELSE '{}'::text[] END,
    v_scope,
    v_inv.invited_by
  )
  ON CONFLICT (org_id, user_id) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  UPDATE public.org_invitations SET accepted_at = now() WHERE id = v_inv.id;

  IF v_rows = 0 THEN
    RETURN jsonb_build_object('status', 'already_member', 'org_id', v_inv.org_id);
  END IF;

  IF v_scope = 'artists' AND cardinality(v_inv.artist_ids) > 0 THEN
    WITH written AS (
      INSERT INTO public.member_artist_scopes (org_id, user_id, contact_id)
      SELECT v_inv.org_id, p_user, c.id
      FROM public.contacts c
      WHERE c.id = ANY (v_inv.artist_ids)
        AND c.org_id = v_inv.org_id
      ON CONFLICT DO NOTHING
      RETURNING contact_id
    )
    SELECT coalesce(array_agg(contact_id ORDER BY contact_id), '{}') INTO v_scoped FROM written;
  END IF;

  INSERT INTO public.activity_events (org_id, actor_id, verb, subject_type, subject_id, payload, audit, visibility)
  VALUES (
    v_inv.org_id,
    p_user,
    'member.joined',
    'member',
    p_user,
    jsonb_build_object(
      'invitation_id', v_inv.id,
      'role', v_inv.role,
      'functions', to_jsonb(CASE WHEN v_inv.role = 'member' THEN v_inv.functions ELSE '{}'::text[] END),
      'contact_ids', to_jsonb(v_scoped),
      'invited_by', v_inv.invited_by
    ),
    true,
    'internal'
  );

  RETURN jsonb_build_object('status', 'joined', 'org_id', v_inv.org_id);
END;
$fn$;

ALTER FUNCTION public.labelos_accept_invitation(text, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_accept_invitation(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.labelos_accept_invitation(text, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_accept_invitation(text, uuid) TO service_role;

DROP FUNCTION IF EXISTS public.labelos_user_has_cap(uuid, uuid, text);

DROP POLICY IF EXISTS project_members_manage_read ON public.project_members;
DROP POLICY IF EXISTS project_members_self_read ON public.project_members;
DROP TRIGGER IF EXISTS project_members_integrity ON public.project_members;
DROP TABLE IF EXISTS public.project_members;
DROP FUNCTION IF EXISTS public.project_members_integrity();
DROP FUNCTION IF EXISTS public.can_see_project(uuid);

ALTER TABLE public.org_invitations DROP COLUMN IF EXISTS project_allow_downloads;

NOTIFY pgrst, 'reload schema';
