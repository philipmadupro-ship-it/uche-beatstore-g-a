-- Rollback for 139_labelos_org_contacts.sql (LABEL-10).
--
-- Lives outside supabase/migrations/ on purpose: scripts/apply-migrations.sh
-- applies every *.sql in that folder. Run by hand only.
--
-- Order matters:
--   1. the additive contacts policy goes first, so nothing org-scoped is
--      readable while the rest unwinds;
--   2. org contacts are DELETED before contacts.org_id is dropped. Without
--      their org_id they would be ownerless rows (contacts_org_or_owner
--      kept their user_id NULL), and the producer's legacy
--      `user_id IS NULL` reads would show them. They belong to Label OS,
--      never to the producer's CRM (Q2). Their scope rows, and producer-side
--      child rows (none can exist: 122+ same-owner triggers refuse an
--      ownerless contact), go with them by cascade;
--   3. labelos_accept_invitation is put back exactly as 138 wrote it.
-- Audit events that name contacts stay (06 §6: audit rows are never deleted).

DROP POLICY IF EXISTS org_member_read ON public.contacts;

DROP TRIGGER IF EXISTS labelos_artist_org_self_contact ON public.organizations;
DROP FUNCTION IF EXISTS public.labelos_artist_org_self_contact();

DROP TABLE IF EXISTS public.member_artist_scopes;
DROP FUNCTION IF EXISTS public.member_artist_scopes_same_org();
DROP FUNCTION IF EXISTS public.can_see_artist(uuid, uuid);

DELETE FROM public.contacts WHERE org_id IS NOT NULL;

DROP TRIGGER IF EXISTS contacts_org_is_fixed ON public.contacts;
DROP FUNCTION IF EXISTS public.contacts_org_is_fixed();
ALTER TABLE public.contacts DROP CONSTRAINT IF EXISTS contacts_org_or_owner;
DROP INDEX IF EXISTS public.contacts_org_email_uniq;
DROP INDEX IF EXISTS public.idx_contacts_org;
ALTER TABLE public.contacts DROP COLUMN IF EXISTS org_id;

-- 138's labelos_accept_invitation, verbatim.
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
