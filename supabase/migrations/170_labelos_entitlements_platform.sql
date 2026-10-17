-- 170_labelos_entitlements_platform.sql
-- Label OS (LABEL-47): account faces, entitlements, the platform console.
--
-- LABEL OS — NOT APPLIED. Apply at the final merge of the Label OS branch
-- into main. Never part of supabase/apply/pending.sql.
--
-- The platform operator (the owner of the software) licenses Label OS to an
-- independent artist/producer (org kind `artist`) or to a label (kind
-- `label`) and decides what each licensee gets. No kind is renamed; the face
-- is derived from the kind (src/lib/labelos/account.ts).
--
--  * platform_admins(user_id) — who may use /platform. NEVER self-service:
--    no route, function or API role writes it (service_role may only read).
--    The owner adds themself once, by hand, in the SQL editor:
--        INSERT INTO public.platform_admins (user_id, note)
--        SELECT id, 'owner' FROM auth.users WHERE email = '<your sign-in email>';
--    (docs: supabase/MIGRATIONS.md, 170). No email is seeded here.
--  * org_entitlements(org_id, modules, max_seats, max_artists, setup_done,
--    granted_by, granted_at) — one row per licensee org. NO ROW = everything
--    the org's face allows (src/lib/labelos/entitlements.ts#orgEntitlements),
--    so every org that exists today keeps working unchanged. Members read
--    their own org's row; nobody but the functions below writes it.
--    Cascades from the organization (LABEL-39's hard delete). Not in the org
--    export: it is the operator's licence for the org, not the org's data.
--  * has_org_cap gains step 6: a capability a module owns (contracts.read →
--    contracts, finance.read → finance) needs the module. The rest of the
--    function is 136's, word for word; capabilities.sql.test.ts parses the
--    LATEST definition and holds both the old and the new data equal to the
--    TypeScript tables.
--  * labelos_accept_invitation (148's, word for word, plus two changes): an
--    `owner` invitation is honoured when its sender is a platform operator
--    (the console's first owner of a licensee), and the seat cap is enforced
--    under a lock on the org's entitlement row ({"error": "seat_limit"}).
--  * labelos_platform_create_licensee / labelos_platform_set_entitlements —
--    the console's two writes, each WITH its audit event in the affected org
--    (`org.entitlements_changed`; the new org also gets `org.created`). The
--    owner invitation reuses 146's labelos_audit_invitation_create
--    (`invitation.created`). Platform-level actions are therefore recorded in
--    the activity log of the org they act on, with the operator as actor;
--    there is no platform-wide log (every console write has an affected org).
--    service_role EXECUTE only; each re-checks that the actor is an operator.
--
-- Idempotent: IF NOT EXISTS, CREATE OR REPLACE, DROP POLICY IF EXISTS.

-- ── platform_admins ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.platform_admins (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_admins FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.platform_admins TO authenticated, service_role;

-- An operator reads their own row (nothing else reads it but the service role).
DROP POLICY IF EXISTS platform_admins_self_read ON public.platform_admins;
CREATE POLICY platform_admins_self_read ON public.platform_admins
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- ── org_entitlements ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.org_entitlements (
  org_id      uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  modules     text[] NOT NULL DEFAULT '{}',
  max_seats   int CHECK (max_seats IS NULL OR max_seats >= 1),
  max_artists int CHECK (max_artists IS NULL OR max_artists >= 0),
  setup_done  boolean NOT NULL DEFAULT false,
  granted_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  granted_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.org_entitlements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.org_entitlements FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.org_entitlements TO authenticated, service_role;

-- Members of a live org read its licence (the shell hides what it does not
-- include). Uncorrelated, one initplan per query (R-08).
DROP POLICY IF EXISTS org_entitlements_member_read ON public.org_entitlements;
CREATE POLICY org_entitlements_member_read ON public.org_entitlements
  FOR SELECT TO authenticated
  USING ((SELECT public.org_role(org_id)) IS NOT NULL);

-- ── has_org_cap(org, cap): 136 + step 6 (entitlements) ───────────────────

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
  -- ENTITLEMENTS (170, LABEL-47): src/lib/labelos/entitlements.ts + account.ts.
  -- CAPABILITY_MODULE: [capability, module]. A capability a module owns needs
  -- the module; every other capability is core and needs nothing.
  capability_modules constant text[] := ARRAY[
    ['contracts.read', 'contracts'], ['finance.read', 'finance']
  ];
  -- MODULES: the ceiling of an org kind with no face (the producer's own org).
  modules constant text[] := ARRAY[
    'contracts', 'finance', 'marketing', 'pr', 'executive', 'artistic',
    'store', 'search', 'digest', 'export'
  ];
  -- FACE_KIND, read as [kind, face].
  kind_faces constant text[] := ARRAY[
    ['artist', 'independent'], ['label', 'label']
  ];
  -- FACE_MODULES: [face, module].
  face_modules constant text[] := ARRAY[
    ['independent', 'contracts'], ['independent', 'finance'],
    ['independent', 'marketing'], ['independent', 'pr'],
    ['independent', 'executive'], ['independent', 'artistic'],
    ['independent', 'store'], ['independent', 'search'],
    ['independent', 'digest'], ['independent', 'export'],
    ['label', 'contracts'], ['label', 'finance'],
    ['label', 'marketing'], ['label', 'pr'],
    ['label', 'executive'], ['label', 'artistic'],
    ['label', 'store'], ['label', 'search'],
    ['label', 'digest'], ['label', 'export']
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
  v_module    text;
  v_face      text;
  v_entitled  text[];
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
  IF p_cap = ANY (revoked) THEN
    RETURN false;
  END IF;

  -- 6. Entitlements (170): a capability a module owns needs the module. The
  --    module must be inside the face's ceiling, and, when the operator has
  --    written an org_entitlements row, in that row. No row = the ceiling.
  v_module := NULL;
  FOREACH pair SLICE 1 IN ARRAY capability_modules LOOP
    IF pair[1] = p_cap THEN v_module := pair[2]; END IF;
  END LOOP;
  IF v_module IS NULL THEN
    RETURN true;
  END IF;
  v_face := NULL;
  FOREACH pair SLICE 1 IN ARRAY kind_faces LOOP
    IF pair[1] = v_kind THEN v_face := pair[2]; END IF;
  END LOOP;
  ok := false;
  IF v_face IS NULL THEN
    ok := v_module = ANY (modules);
  ELSE
    FOREACH pair SLICE 1 IN ARRAY face_modules LOOP
      IF pair[1] = v_face AND pair[2] = v_module THEN ok := true; END IF;
    END LOOP;
  END IF;
  IF NOT ok THEN
    RETURN false;
  END IF;
  SELECT e.modules INTO v_entitled FROM public.org_entitlements e WHERE e.org_id = p_org;
  IF NOT FOUND THEN
    RETURN true;
  END IF;
  RETURN v_module = ANY (coalesce(v_entitled, '{}'));
END;
$fn$;
ALTER FUNCTION public.has_org_cap(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.has_org_cap(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_org_cap(uuid, text) TO authenticated, anon;

-- ── labelos_accept_invitation: 148 + owner invitations + seat cap ────────

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
  v_max_seats int;
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
  -- 170: an owner invitation exists only for the platform console's first
  -- owner of a licensee org, and is honoured only while its sender is still
  -- a platform operator. Any other owner invitation stays unsupported.
  IF v_inv.role = 'owner' AND (
       v_inv.project_id IS NOT NULL
       OR v_inv.invited_by IS NULL
       OR NOT EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = v_inv.invited_by)
     ) THEN
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
  -- An owner invitation's sender was checked above (a platform operator);
  -- every other invitation's sender must still run the org.
  IF v_inv.role <> 'owner' AND (v_inv.invited_by IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.org_members m
    WHERE m.org_id = v_inv.org_id AND m.user_id = v_inv.invited_by AND m.role IN ('owner', 'admin')
  )) THEN
    RETURN jsonb_build_object('error', 'revoked');
  END IF;

  -- 170: the seat cap. A staff seat is a membership whose role is not
  -- `artist` (a roster artist's login is bounded by the artist cap, where the
  -- contact is added). Decided under a lock on the org's entitlement row, so
  -- two invitees accepting at once cannot both take the last seat. Someone who
  -- is already a member is not refused: the insert below answers already_member.
  IF v_inv.role <> 'artist' THEN
    SELECT e.max_seats INTO v_max_seats
    FROM public.org_entitlements e
    WHERE e.org_id = v_inv.org_id
    FOR UPDATE;
    IF v_max_seats IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.org_members WHERE org_id = v_inv.org_id AND user_id = p_user)
       AND (SELECT count(*) FROM public.org_members WHERE org_id = v_inv.org_id AND role <> 'artist') >= v_max_seats THEN
      RETURN jsonb_build_object('error', 'seat_limit');
    END IF;
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

-- ── console writes ───────────────────────────────────────────────────────
-- Modules are passed already normalised by the route (known names, inside
-- the face's ceiling: lib/labelos/entitlements#normalizeModules); unknown
-- names would grant nothing anyway, since every reader intersects.

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

-- Set an existing licensee's modules and caps. Writes the row if the org had
-- none (an org that predates its licence: setup_done = true, it is running).
-- Only live artist / label orgs: the producer's own org is not a licensee.
CREATE OR REPLACE FUNCTION public.labelos_platform_set_entitlements(
  p_actor uuid,
  p_org uuid,
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
  v_row public.org_entitlements%ROWTYPE;
BEGIN
  IF p_actor IS NULL OR NOT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = p_actor) THEN
    RETURN jsonb_build_object('error', 'not_operator');
  END IF;
  PERFORM 1 FROM public.organizations o
  WHERE o.id = p_org AND o.kind IN ('artist', 'label') AND o.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  INSERT INTO public.org_entitlements AS e (org_id, modules, max_seats, max_artists, setup_done, granted_by, granted_at)
  VALUES (p_org, coalesce(p_modules, '{}'), p_max_seats, p_max_artists, true, p_actor, now())
  ON CONFLICT (org_id) DO UPDATE
    SET modules = EXCLUDED.modules,
        max_seats = EXCLUDED.max_seats,
        max_artists = EXCLUDED.max_artists,
        granted_by = EXCLUDED.granted_by,
        granted_at = EXCLUDED.granted_at
  RETURNING * INTO v_row;

  PERFORM public.labelos_audit_insert(p_org, p_actor, 'org.entitlements_changed', 'org', p_org, p_payload);

  RETURN jsonb_build_object('entitlements', jsonb_build_object(
    'modules', to_jsonb(v_row.modules), 'max_seats', v_row.max_seats, 'max_artists', v_row.max_artists,
    'setup_done', v_row.setup_done, 'granted_at', v_row.granted_at
  ));
END;
$fn$;

ALTER FUNCTION public.labelos_platform_set_entitlements(uuid, uuid, text[], int, int, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_platform_set_entitlements(uuid, uuid, text[], int, int, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_platform_set_entitlements(uuid, uuid, text[], int, int, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
