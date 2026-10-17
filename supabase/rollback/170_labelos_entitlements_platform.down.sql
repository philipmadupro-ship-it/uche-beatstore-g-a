-- Rollback for 170_labelos_entitlements_platform.sql (LABEL-47).
--
-- Lives outside supabase/migrations/ on purpose: scripts/apply-migrations.sh
-- applies every *.sql in that folder. Run by hand only.
--
-- Puts back 136's has_org_cap and 148's labelos_accept_invitation, word for
-- word (every org holds every module-owned capability again, an owner
-- invitation is unsupported again, there is no seat cap), then drops the
-- console functions and both tables. Operators listed in platform_admins
-- are lost; re-add them after re-applying 170.

CREATE OR REPLACE FUNCTION public.has_org_cap(p_org uuid, p_cap text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  -- labelos:mapping:start
  all_capabilities constant text[] := ARRAY[
    'catalog.read', 'catalog.write', 'audio.finished', 'audio.working',
    'review.write', 'review.comment', 'rights.read', 'rights.read.own_line',
    'rights.write', 'contracts.read', 'release.write',
    'release.approve.master', 'release.approve.artwork',
    'release.approve.legal', 'release.approve.marketing',
    'release.approve.metadata', 'tasks.write', 'share.external',
    'members.manage', 'org.manage', 'finance.read', 'business.read.internal'
  ];
  org_kinds constant text[] := ARRAY['artist', 'producer', 'label'];
  roles_by_org_kind constant text[] := ARRAY[
    ['artist', 'owner'], ['artist', 'admin'], ['artist', 'member'],
    ['producer', 'owner'], ['producer', 'admin'], ['producer', 'member'],
    ['label', 'owner'], ['label', 'admin'], ['label', 'member'], ['label', 'artist']
  ];
  functions_by_org_kind constant text[] := ARRAY[
    ['artist', 'artist_manager'], ['artist', 'producer'], ['artist', 'engineer'],
    ['artist', 'marketing'], ['artist', 'legal'], ['artist', 'operations'],
    ['producer', 'producer'], ['producer', 'engineer'],
    ['producer', 'artist_manager'], ['producer', 'operations'],
    ['label', 'a_and_r'], ['label', 'project_manager'], ['label', 'marketing'],
    ['label', 'legal'], ['label', 'finance'], ['label', 'artist_manager'],
    ['label', 'producer'], ['label', 'engineer'], ['label', 'operations']
  ];
  -- KIND_CEILING: kinds whose ceiling is every capability. No kind has a
  -- partial ceiling in the MVP; the parity test fails if one appears.
  kinds_with_full_ceiling constant text[] := ARRAY['artist', 'producer', 'label'];
  -- ROLE_GRANTS: roles granted every capability, then the rest as pairs.
  roles_granted_everything constant text[] := ARRAY['owner', 'admin'];
  role_grants constant text[] := ARRAY[
    ['artist', 'catalog.write'], ['artist', 'audio.finished'],
    ['artist', 'audio.working'], ['artist', 'review.comment'],
    ['artist', 'rights.read']
  ];
  roles_using_functions constant text[] := ARRAY['member'];
  roles_taking_overrides constant text[] := ARRAY['member', 'artist'];
  function_presets constant text[] := ARRAY[
    ['a_and_r', 'catalog.write'], ['a_and_r', 'audio.finished'],
    ['a_and_r', 'audio.working'], ['a_and_r', 'review.write'],
    ['a_and_r', 'rights.read'], ['a_and_r', 'release.write'],
    ['a_and_r', 'release.approve.master'], ['a_and_r', 'share.external'],
    ['a_and_r', 'tasks.write'],
    ['project_manager', 'catalog.write'], ['project_manager', 'audio.finished'],
    ['project_manager', 'audio.working'], ['project_manager', 'review.write'],
    ['project_manager', 'rights.read'], ['project_manager', 'release.write'],
    ['project_manager', 'release.approve.metadata'],
    ['project_manager', 'share.external'],
    ['project_manager', 'business.read.internal'],
    ['project_manager', 'tasks.write'],
    ['marketing', 'catalog.read'], ['marketing', 'audio.finished'],
    ['marketing', 'release.approve.artwork'],
    ['marketing', 'release.approve.marketing'],
    ['marketing', 'business.read.internal'], ['marketing', 'tasks.write'],
    ['legal', 'catalog.read'], ['legal', 'audio.finished'],
    ['legal', 'rights.write'], ['legal', 'contracts.read'],
    ['legal', 'release.approve.legal'], ['legal', 'business.read.internal'],
    ['legal', 'tasks.write'],
    ['artist_manager', 'catalog.write'], ['artist_manager', 'audio.finished'],
    ['artist_manager', 'audio.working'], ['artist_manager', 'review.write'],
    ['artist_manager', 'rights.read'], ['artist_manager', 'tasks.write'],
    ['producer', 'catalog.write'], ['producer', 'audio.finished'],
    ['producer', 'audio.working'], ['producer', 'rights.read.own_line'],
    ['producer', 'tasks.write'],
    ['engineer', 'catalog.write'], ['engineer', 'audio.finished'],
    ['engineer', 'audio.working'], ['engineer', 'rights.read.own_line'],
    ['engineer', 'tasks.write']
  ];
  -- IMPLIES: [wider, narrower].
  implies constant text[] := ARRAY[
    ['catalog.write', 'catalog.read'], ['audio.finished', 'catalog.read'],
    ['audio.working', 'catalog.read'], ['review.comment', 'catalog.read'],
    ['rights.read.own_line', 'catalog.read'], ['contracts.read', 'catalog.read'],
    ['release.write', 'catalog.read'], ['release.approve.master', 'catalog.read'],
    ['release.approve.artwork', 'catalog.read'],
    ['release.approve.legal', 'catalog.read'],
    ['release.approve.marketing', 'catalog.read'],
    ['release.approve.metadata', 'catalog.read'], ['tasks.write', 'catalog.read'],
    ['share.external', 'catalog.read'], ['business.read.internal', 'catalog.read'],
    ['rights.write', 'rights.read'], ['rights.read', 'rights.read.own_line'],
    ['review.write', 'review.comment']
  ];
  never_grantable constant text[] := ARRAY[
    ['member', 'members.manage'], ['member', 'org.manage'],
    ['artist', 'members.manage'], ['artist', 'org.manage'],
    ['artist', 'business.read.internal'], ['artist', 'contracts.read']
  ];
  -- labelos:mapping:end

  v_kind      text;
  v_role      text;
  v_functions text[];
  v_grants    text[];
  v_revokes   text[];
  granted     text[] := '{}';
  revoked     text[] := '{}';
  pair        text[];
  preset      text[];
  fn          text;
  ok          boolean;
  grown       boolean;
BEGIN
  IF p_org IS NULL OR p_cap IS NULL OR NOT (p_cap = ANY (all_capabilities)) THEN
    RETURN false;
  END IF;

  SELECT o.kind, om.role, om.functions, om.cap_grants, om.cap_revokes
    INTO v_kind, v_role, v_functions, v_grants, v_revokes
  FROM public.org_members om
  JOIN public.organizations o ON o.id = om.org_id
  WHERE om.org_id = p_org
    AND om.user_id = auth.uid()
    AND o.deleted_at IS NULL;
  IF NOT FOUND OR NOT (v_kind = ANY (org_kinds)) THEN
    RETURN false;
  END IF;

  -- 1. The role must be one the org kind offers.
  ok := false;
  FOREACH pair SLICE 1 IN ARRAY roles_by_org_kind LOOP
    IF pair[1] = v_kind AND pair[2] = v_role THEN ok := true; END IF;
  END LOOP;
  IF NOT ok THEN RETURN false; END IF;

  -- 2. Role grants, function presets, per-member grants.
  IF v_role = ANY (roles_granted_everything) THEN
    granted := all_capabilities;
  ELSE
    FOREACH pair SLICE 1 IN ARRAY role_grants LOOP
      IF pair[1] = v_role THEN granted := granted || pair[2]; END IF;
    END LOOP;
  END IF;

  IF v_role = ANY (roles_using_functions) THEN
    FOREACH fn IN ARRAY coalesce(v_functions, '{}') LOOP
      FOREACH pair SLICE 1 IN ARRAY functions_by_org_kind LOOP
        IF pair[1] = v_kind AND pair[2] = fn THEN
          FOREACH preset SLICE 1 IN ARRAY function_presets LOOP
            IF preset[1] = fn THEN granted := granted || preset[2]; END IF;
          END LOOP;
        END IF;
      END LOOP;
    END LOOP;
  END IF;

  IF v_role = ANY (roles_taking_overrides) THEN
    granted := granted || ARRAY(
      SELECT c FROM unnest(coalesce(v_grants, '{}')) AS c WHERE c = ANY (all_capabilities)
    );
    revoked := ARRAY(
      SELECT c FROM unnest(coalesce(v_revokes, '{}')) AS c WHERE c = ANY (all_capabilities)
    );
    -- 3. Revoking a capability also revokes everything that needs it.
    LOOP
      grown := false;
      FOREACH pair SLICE 1 IN ARRAY implies LOOP
        IF pair[2] = ANY (revoked) AND NOT (pair[1] = ANY (revoked)) THEN
          revoked := revoked || pair[1];
          grown := true;
        END IF;
      END LOOP;
      EXIT WHEN NOT grown;
    END LOOP;
  END IF;

  -- 4. Close the grants under IMPLIES.
  LOOP
    grown := false;
    FOREACH pair SLICE 1 IN ARRAY implies LOOP
      IF pair[1] = ANY (granted) AND NOT (pair[2] = ANY (granted)) THEN
        granted := granted || pair[2];
        grown := true;
      END IF;
    END LOOP;
    EXIT WHEN NOT grown;
  END LOOP;

  -- 5. Granted, inside the ceiling, not a hard limit, not revoked.
  IF NOT (p_cap = ANY (granted)) OR NOT (v_kind = ANY (kinds_with_full_ceiling)) THEN
    RETURN false;
  END IF;
  FOREACH pair SLICE 1 IN ARRAY never_grantable LOOP
    IF pair[1] = v_role AND pair[2] = p_cap THEN RETURN false; END IF;
  END LOOP;
  RETURN NOT (p_cap = ANY (revoked));
END;
$fn$;

ALTER FUNCTION public.has_org_cap(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.has_org_cap(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_org_cap(uuid, text) TO authenticated, anon;

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
  v_renewed   boolean := false;
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
  IF v_inv.role = 'owner' THEN
    RETURN jsonb_build_object('error', 'unsupported');
  END IF;
  IF v_inv.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'revoked');
  END IF;

  -- ── A project invitation: a project_members row, never org_members ────
  IF v_inv.project_id IS NOT NULL THEN
    IF v_inv.accepted_at IS NOT NULL THEN
      -- Only a LIVE membership is "already a member": someone whose access has
      -- expired and who clicks the spent link again is told it is used, not
      -- that they still have access.
      IF EXISTS (
        SELECT 1 FROM public.project_members
        WHERE project_id = v_inv.project_id AND user_id = p_user AND (expires_at IS NULL OR expires_at > now())
      ) THEN
        RETURN jsonb_build_object('status', 'already_member', 'org_id', v_inv.org_id, 'project_id', v_inv.project_id);
      END IF;
      RETURN jsonb_build_object('error', 'used');
    END IF;
    IF v_inv.expires_at <= now() THEN
      RETURN jsonb_build_object('error', 'expired');
    END IF;
    -- The inviter must still be able to share outside the org, and the
    -- project must still be a project of it.
    IF v_inv.invited_by IS NULL
       OR NOT public.labelos_user_has_cap(v_inv.org_id, v_inv.invited_by, 'share.external')
       OR NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = v_inv.project_id AND p.org_id = v_inv.org_id) THEN
      RETURN jsonb_build_object('error', 'revoked');
    END IF;

    v_renewed := EXISTS (SELECT 1 FROM public.project_members WHERE project_id = v_inv.project_id AND user_id = p_user);
    -- A person who is already on the project keeps what they have (an
    -- invitation never changes a live membership), EXCEPT one whose access
    -- has EXPIRED: a new invitation is how the producer brings them back, so
    -- it renews the row with the invited role and downloads setting and
    -- clears the expiry. v_rows = 1 then, and the event says `renewed`.
    INSERT INTO public.project_members (org_id, project_id, user_id, role, allow_downloads, invited_by, invitation_id)
    VALUES (v_inv.org_id, v_inv.project_id, p_user, v_inv.project_role, v_inv.project_allow_downloads, v_inv.invited_by, v_inv.id)
    ON CONFLICT (project_id, user_id) DO UPDATE
      SET role = EXCLUDED.role,
          allow_downloads = EXCLUDED.allow_downloads,
          expires_at = NULL,
          invited_by = EXCLUDED.invited_by,
          invitation_id = EXCLUDED.invitation_id
      WHERE public.project_members.expires_at IS NOT NULL
        AND public.project_members.expires_at <= now();
    GET DIAGNOSTICS v_rows = ROW_COUNT;

    UPDATE public.org_invitations SET accepted_at = now() WHERE id = v_inv.id;

    IF v_rows = 0 THEN
      RETURN jsonb_build_object('status', 'already_member', 'org_id', v_inv.org_id, 'project_id', v_inv.project_id);
    END IF;

    PERFORM public.labelos_audit_insert_project(
      v_inv.org_id, p_user, 'project.member_added', 'member', p_user, v_inv.project_id,
      jsonb_build_object(
        'invitation_id', v_inv.id,
        'role', v_inv.project_role,
        'allow_downloads', v_inv.project_allow_downloads,
        'invited_by', v_inv.invited_by,
        'renewed', v_renewed
      )
    );
    RETURN jsonb_build_object('status', 'joined', 'org_id', v_inv.org_id, 'project_id', v_inv.project_id);
  END IF;

  -- ── An org invitation: 139's function, unchanged ──────────────────────
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

DROP FUNCTION IF EXISTS public.labelos_platform_create_licensee(uuid, text, text, text, text[], int, int, jsonb);
DROP FUNCTION IF EXISTS public.labelos_platform_set_entitlements(uuid, uuid, text[], int, int, jsonb);
DROP TABLE IF EXISTS public.org_entitlements;
DROP TABLE IF EXISTS public.platform_admins;

NOTIFY pgrst, 'reload schema';
