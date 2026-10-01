-- 138_labelos_invitation_accept.sql
-- Label OS (LABEL-08): accepting an org invitation.
--
-- LABEL OS — NOT APPLIED. Apply at the final merge of the Label OS branch
-- into main, after 136 and 137 (docs/bstudio-label-os/16-execution-runbook.md).
--
-- One function, no table change. 136 deliberately has no INSERT policy (and
-- no INSERT grant) on org_members: "joining an org happens ONLY through the
-- service-role invitation-accept route". This is that path, kept in SQL so
-- every check and both writes happen in one transaction:
--
--   1. the invitation is looked up by the sha-256 of its token and LOCKED
--      (FOR UPDATE), so two simultaneous accepts serialise;
--   2. the accepting user's email (read from auth.users, never from the
--      caller) must be VERIFIED (`email_confirmed_at`) and equal the invited
--      email, normalised as lib/contacts/email.ts normalises (trim +
--      lower-case). An unverified address proves nothing about who holds
--      the inbox;
--   3. revoked → refused; already accepted → idempotent for a user who is a
--      member, "used" for anyone else; expired → refused; an inviter who no
--      longer holds members.manage in the org (removed, demoted — only owner
--      and admin can hold it, NEVER_GRANTABLE) → refused as withdrawn: an
--      invitation does not outlive the authority that issued it;
--   4. org_members is written (scope `artists` for an artist or anyone
--      limited to named artists, 06 §2.5), the invitation is marked accepted
--      and the `member.joined` audit event is recorded.
--
-- A user who is already a member keeps their membership exactly as it is
-- (an invitation never changes an existing role); the invitation is still
-- consumed. Owner invitations and project invitations (LABEL-21) are not
-- accepted here.
--
-- Answers are jsonb codes the route maps to HTTP (lib/labelos/invitations.ts
-- `interpretAcceptResult`). The invited email is never part of an answer.
--
-- Runs as postgres (owner of 136's tables); only service_role may execute
-- it. Idempotent: CREATE OR REPLACE.

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

  INSERT INTO public.org_members (org_id, user_id, role, functions, scope, invited_by)
  VALUES (
    v_inv.org_id,
    p_user,
    v_inv.role,
    CASE WHEN v_inv.role = 'member' THEN v_inv.functions ELSE '{}'::text[] END,
    CASE WHEN v_inv.role = 'artist' OR cardinality(v_inv.artist_ids) > 0 THEN 'artists' ELSE 'org' END,
    v_inv.invited_by
  )
  ON CONFLICT (org_id, user_id) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  UPDATE public.org_invitations SET accepted_at = now() WHERE id = v_inv.id;

  IF v_rows = 0 THEN
    RETURN jsonb_build_object('status', 'already_member', 'org_id', v_inv.org_id);
  END IF;

  -- 06 §6: membership changes are audit events. Same transaction as the
  -- membership, so one never exists without the other. `artist_ids` holds
  -- roster CONTACT ids (17 R3); the column keeps 136's name.
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
      'contact_ids', to_jsonb(v_inv.artist_ids),
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
-- Supabase grants EXECUTE on new public functions to anon/authenticated by
-- default privileges; take it back explicitly (as 137 does).
REVOKE ALL ON FUNCTION public.labelos_accept_invitation(text, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_accept_invitation(text, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
