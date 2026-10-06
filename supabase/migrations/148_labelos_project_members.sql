-- 148_labelos_project_members.sql
-- Label OS (LABEL-21): external project members ("Shared with me").
--
-- LABEL OS — NOT APPLIED. Apply at the final merge of the Label OS branch
-- into main, after 136–146 (docs/bstudio-label-os/16-execution-runbook.md).
-- Never part of supabase/apply/pending.sql. (147 is LABEL-20's.)
--
-- A person with their OWN account is admitted to ONE org project as viewer,
-- commenter, contributor or editor (06 §2.6, W4). They are not an org member:
-- they hold a row in `project_members` and nothing else, so every org-level
-- check (`org_members`, `has_org_cap`) answers "no" for them by itself. The
-- SQL here is the database half; the routes are the real boundary (service
-- role), exactly like the rest of /api/org.
--
--   1. `project_members` (one table): who, which project, which role, whether
--      a viewer / commenter may download (`allow_downloads`, §2.6 "per
--      project"), an optional expiry. UNIQUE (project_id, user_id). A member's
--      project must be a project OF THE ROW'S ORG (trigger, like 141/142);
--      who / where never change after insert (trigger). Org rows: service role
--      only — no INSERT / UPDATE / DELETE grant for the API roles.
--   2. `org_invitations.project_allow_downloads`: the column an invitation
--      carries for `allow_downloads`. 136 already gave the table `project_id`
--      + `project_role` (both or neither).
--   3. `can_see_project(project)` — the SQL twin of the TypeScript project
--      reach: an org member who passes `catalog.read` + `can_see_org_project`
--      (scope), OR a live external membership (not expired, org not deleted).
--      SECURITY DEFINER STABLE, like the 141 helpers; called as
--      `(SELECT public.can_see_project(project_id))` so it runs once per
--      statement, never once per row of a big table.
--   4. RLS on `project_members`: SELECT only. A person reads their OWN row
--      while it is live (`can_see_project`); an org member with `share.external`
--      reads those of the projects their artist scope reaches (the whole
--      org for a member who sees it). No policy anywhere gives an external
--      member the project's tracks, files or comments: those are read through
--      the service-role routes, which apply `externalCan` (lib/labelos/
--      capabilities). tracks / projects / … keep 141's org_member_read +
--      org_member_guard untouched, so an external member's own JWT reads none
--      of them (asserted in supabase/local/checks/148_*.sql).
--   5. Audit functions (service_role only, one transaction each with their
--      `activity_events` row, the 146 pattern):
--        labelos_audit_project_invitation_create  invitation.created
--        labelos_audit_project_member_update      project.member_changed
--        labelos_audit_project_member_remove      project.member_removed
--      `labelos_audit_invitation_revoke` (146) already revokes a project
--      invitation unchanged.
--   6. `labelos_accept_invitation` (138/139) is REPLACED (same signature, so
--      a true replacement): a project invitation writes `project_members`,
--      never `org_members`, and records `project.member_added`. The invitee
--      is admitted to the project only; they are not made an org member. The
--      inviter must STILL hold `share.external` in the org at accept time
--      (an invitation does not outlive the authority that issued it) — read
--      through `labelos_user_has_cap`, which asks the one `has_org_cap`
--      definition about another user instead of copying its tables.
--      The org path is byte-for-byte 139's.
--   7. `labelos_audit_invitation_create` (146) is replaced with the same
--      signature, ignoring project invitations when it looks for a pending
--      org invitation, so an open project invite does not block (or get
--      mistaken for) an org one for the same address.
--
-- Proven as anon / authenticated users in
-- supabase/local/checks/148_labelos_project_members.sql and held by
-- src/lib/security/rls-final-state.test.ts.
--
-- Idempotent: IF NOT EXISTS, CREATE OR REPLACE, DROP ... IF EXISTS first.

-- ── 1. project_members ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.project_members (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id      uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('viewer', 'commenter', 'contributor', 'editor')),
  -- 06 §2.6: a viewer / commenter downloads masters only when the project
  -- allows it; contributors and editors always may.
  allow_downloads boolean NOT NULL DEFAULT false,
  -- Access ends on the next request after this passes (W4 step 6).
  expires_at      timestamptz,
  invited_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  invitation_id   uuid REFERENCES public.org_invitations(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_members_project_user_uniq UNIQUE (project_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_project_members_user ON public.project_members (user_id, org_id);
CREATE INDEX IF NOT EXISTS idx_project_members_org_project ON public.project_members (org_id, project_id);

ALTER TABLE public.org_invitations
  ADD COLUMN IF NOT EXISTS project_allow_downloads boolean NOT NULL DEFAULT false;

-- The member's project is a project OF THE ROW'S ORG (an org project, never
-- a producer one); and who / where never change after insert — a membership
-- is changed (role, downloads, expiry) or removed, never moved.
CREATE OR REPLACE FUNCTION public.project_members_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW.org_id IS DISTINCT FROM OLD.org_id
    OR NEW.project_id IS DISTINCT FROM OLD.project_id
    OR NEW.user_id IS DISTINCT FROM OLD.user_id
  ) THEN
    RAISE EXCEPTION 'project_members: org, project and user of a membership cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' AND NOT EXISTS (
    SELECT 1 FROM public.projects p WHERE p.id = NEW.project_id AND p.org_id IS NOT NULL AND p.org_id = NEW.org_id
  ) THEN
    RAISE EXCEPTION 'project_members: project % is not a project of organization %', NEW.project_id, NEW.org_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.project_members_integrity() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.project_members_integrity() FROM PUBLIC;

DROP TRIGGER IF EXISTS project_members_integrity ON public.project_members;
CREATE TRIGGER project_members_integrity
  BEFORE INSERT OR UPDATE ON public.project_members
  FOR EACH ROW EXECUTE FUNCTION public.project_members_integrity();

-- ── 3. can_see_project ──────────────────────────────────────────────────
-- Does the caller reach this org project at all? An org member inside their
-- artist scope with catalog.read, or a live external member. False for a
-- producer project, a deleted org, an expired membership and anyone else.

CREATE OR REPLACE FUNCTION public.can_see_project(p_project uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.projects p
    JOIN public.organizations o ON o.id = p.org_id AND o.deleted_at IS NULL
    WHERE p.id = p_project
      AND p.org_id IS NOT NULL
      AND (
        EXISTS (
          SELECT 1 FROM public.project_members m
          WHERE m.project_id = p.id
            AND m.org_id = p.org_id
            AND m.user_id = auth.uid()
            AND (m.expires_at IS NULL OR m.expires_at > now())
        )
        OR (
          public.has_org_cap(p.org_id, 'catalog.read')
          AND public.can_see_org_project(p.org_id, p.id)
        )
      )
  );
$$;

ALTER FUNCTION public.can_see_project(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.can_see_project(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_see_project(uuid) TO authenticated, anon;

-- Is this user's capability in this org met? The one has_org_cap, asked
-- about another person: it reads auth.uid(), so the caller's identity is set
-- for the call and put back (transaction-local either way). Both places
-- Supabase's auth.uid() reads are set — `request.jwt.claims` (PostgREST 10+)
-- and the legacy `request.jwt.claim.sub` it prefers when present — so the
-- answer is the same on either. Both are put back exactly as they were; an
-- unset setting reads back as '{}' / '' for the rest of the transaction
-- (set_config cannot unset), which auth.uid() treats as no user, as before,
-- and which reverts when the transaction ends. service_role only: nobody who
-- can run it can pick whose answer the API roles get.
CREATE OR REPLACE FUNCTION public.labelos_user_has_cap(p_org uuid, p_user uuid, p_cap text)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claims text := coalesce(current_setting('request.jwt.claims', true), '{}');
  v_sub    text := coalesce(current_setting('request.jwt.claim.sub', true), '');
  v_ok     boolean;
BEGIN
  IF p_org IS NULL OR p_user IS NULL OR p_cap IS NULL THEN
    RETURN false;
  END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  v_ok := public.has_org_cap(p_org, p_cap);
  PERFORM set_config('request.jwt.claims', v_claims, true);
  PERFORM set_config('request.jwt.claim.sub', v_sub, true);
  RETURN coalesce(v_ok, false);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('request.jwt.claims', v_claims, true);
  PERFORM set_config('request.jwt.claim.sub', v_sub, true);
  RAISE;
END;
$$;

ALTER FUNCTION public.labelos_user_has_cap(uuid, uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_user_has_cap(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_user_has_cap(uuid, uuid, text) TO service_role;

-- ── 4. RLS ──────────────────────────────────────────────────────────────

ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;

-- A person reads their OWN membership while it is live (this is what the
-- proxy's coarse gate reads on the caller's own session); an org member who
-- may share externally reads the memberships of the projects their artist
-- scope reaches (`can_see_org_project`, 141 — the whole org for a member who
-- sees the whole org).
DROP POLICY IF EXISTS project_members_self_read ON public.project_members;
CREATE POLICY project_members_self_read ON public.project_members
  FOR SELECT
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND (SELECT public.can_see_project(project_id))
  );

DROP POLICY IF EXISTS project_members_manage_read ON public.project_members;
CREATE POLICY project_members_manage_read ON public.project_members
  FOR SELECT
  TO authenticated
  USING (
    (SELECT public.has_org_cap(org_id, 'share.external'))
    AND (SELECT public.can_see_org_project(org_id, project_id))
  );

-- Writes are the service role's (the routes and the functions below).
REVOKE ALL ON public.project_members FROM anon, authenticated;
GRANT SELECT ON public.project_members TO authenticated;

-- ── 5. Audit functions ──────────────────────────────────────────────────

-- Private helper: one audit event WITH its project. 146's labelos_audit_insert
-- carries no project column; this one does (the feed filters by it). Same
-- guards on the payload. No EXECUTE for anyone but its owner.
CREATE OR REPLACE FUNCTION public.labelos_audit_insert_project(
  p_org uuid,
  p_actor uuid,
  p_verb text,
  p_subject_type text,
  p_subject_id uuid,
  p_project uuid,
  p_payload jsonb
) RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_id uuid;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'audit payload must be an object' USING ERRCODE = '22023';
  END IF;
  IF p_payload::text ~* '"[^"]*(token|password|secret)[^"]*"\s*:' THEN
    RAISE EXCEPTION 'audit payload carries a secret-looking key' USING ERRCODE = '22023';
  END IF;
  IF pg_column_size(p_payload) > 16384 THEN
    RAISE EXCEPTION 'audit payload is too large' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.activity_events (org_id, actor_id, verb, subject_type, subject_id, project_id, payload, audit, visibility)
  VALUES (p_org, p_actor, p_verb, p_subject_type, p_subject_id, p_project, p_payload, true, 'internal')
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$fn$;

ALTER FUNCTION public.labelos_audit_insert_project(uuid, uuid, text, text, uuid, uuid, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_audit_insert_project(uuid, uuid, text, text, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- Invite someone to ONE project. One pending invitation per address per
-- project, decided under a lock (the 146 rule, per project). The project
-- must be a project of the org. Answers {"invitation": <row>},
-- {"error": "pending", "id": <existing>} or {"error": "not_found"}.
CREATE OR REPLACE FUNCTION public.labelos_audit_project_invitation_create(
  p_org uuid,
  p_actor uuid,
  p_project uuid,
  p_email text,
  p_role text,
  p_allow_downloads boolean,
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
  IF p_role NOT IN ('viewer', 'commenter', 'contributor', 'editor') THEN
    RAISE EXCEPTION 'unknown project role %', p_role USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = p_project AND p.org_id = p_org) THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_org::text || ':' || p_project::text || ':' || p_email, 0));

  SELECT i.id INTO v_pending
  FROM public.org_invitations i
  WHERE i.org_id = p_org AND i.project_id = p_project AND i.email = p_email
    AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
  ORDER BY i.created_at ASC, i.id ASC
  LIMIT 1;
  IF v_pending IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'pending', 'id', v_pending);
  END IF;

  -- `role` is the ORG role column (NOT NULL); a project invitation never
  -- becomes an org membership (labelos_accept_invitation branches on
  -- project_id first), so the least one is stored.
  INSERT INTO public.org_invitations
    (org_id, email, role, functions, artist_ids, project_id, project_role, project_allow_downloads, token_hash, expires_at, invited_by)
  VALUES
    (p_org, p_email, 'member', '{}', '{}', p_project, p_role, coalesce(p_allow_downloads, false), p_token_hash, p_expires_at, p_actor)
  RETURNING * INTO v_inv;

  PERFORM public.labelos_audit_insert_project(p_org, p_actor, 'invitation.created', 'invitation', v_inv.id, p_project, p_payload);

  RETURN jsonb_build_object('invitation', jsonb_build_object(
    'id', v_inv.id,
    'email', v_inv.email,
    'project_id', v_inv.project_id,
    'project_role', v_inv.project_role,
    'allow_downloads', v_inv.project_allow_downloads,
    'expires_at', v_inv.expires_at,
    'accepted_at', v_inv.accepted_at,
    'revoked_at', v_inv.revoked_at,
    'created_at', v_inv.created_at
  ));
END;
$fn$;

ALTER FUNCTION public.labelos_audit_project_invitation_create(uuid, uuid, uuid, text, text, boolean, text, timestamptz, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_audit_project_invitation_create(uuid, uuid, uuid, text, text, boolean, text, timestamptz, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_audit_project_invitation_create(uuid, uuid, uuid, text, text, boolean, text, timestamptz, jsonb) TO service_role;

-- Change one membership. p_patch holds only the keys that change: role,
-- allow_downloads, expires_at (null clears it). Answers {"member": <row>} or
-- {"error": "not_found"}.
CREATE OR REPLACE FUNCTION public.labelos_audit_project_member_update(
  p_org uuid,
  p_actor uuid,
  p_project uuid,
  p_user uuid,
  p_patch jsonb,
  p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_row public.project_members%ROWTYPE;
BEGIN
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' OR p_patch = '{}'::jsonb THEN
    RAISE EXCEPTION 'empty project member patch' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.project_members
  WHERE org_id = p_org AND project_id = p_project AND user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  UPDATE public.project_members m
  SET role            = COALESCE(p_patch->>'role', m.role),
      allow_downloads = CASE WHEN p_patch ? 'allow_downloads' THEN (p_patch->>'allow_downloads')::boolean ELSE m.allow_downloads END,
      expires_at      = CASE WHEN p_patch ? 'expires_at' THEN nullif(p_patch->>'expires_at', '')::timestamptz ELSE m.expires_at END
  WHERE m.org_id = p_org AND m.project_id = p_project AND m.user_id = p_user
  RETURNING m.* INTO v_row;

  PERFORM public.labelos_audit_insert_project(p_org, p_actor, 'project.member_changed', 'member', p_user, p_project, p_payload);

  RETURN jsonb_build_object('member', jsonb_build_object(
    'user_id', v_row.user_id,
    'role', v_row.role,
    'allow_downloads', v_row.allow_downloads,
    'expires_at', v_row.expires_at,
    'created_at', v_row.created_at
  ));
END;
$fn$;

ALTER FUNCTION public.labelos_audit_project_member_update(uuid, uuid, uuid, uuid, jsonb, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_audit_project_member_update(uuid, uuid, uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_audit_project_member_update(uuid, uuid, uuid, uuid, jsonb, jsonb) TO service_role;

-- Remove one membership. What the person uploaded stays in the project with
-- their name on it (D3): uploads carry `tracks.created_by`, not this row.
CREATE OR REPLACE FUNCTION public.labelos_audit_project_member_remove(
  p_org uuid,
  p_actor uuid,
  p_project uuid,
  p_user uuid,
  p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_gone int;
BEGIN
  DELETE FROM public.project_members
  WHERE org_id = p_org AND project_id = p_project AND user_id = p_user;
  GET DIAGNOSTICS v_gone = ROW_COUNT;
  IF v_gone = 0 THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  PERFORM public.labelos_audit_insert_project(p_org, p_actor, 'project.member_removed', 'member', p_user, p_project, p_payload);
  RETURN jsonb_build_object('removed', true);
END;
$fn$;

ALTER FUNCTION public.labelos_audit_project_member_remove(uuid, uuid, uuid, uuid, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_audit_project_member_remove(uuid, uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_audit_project_member_remove(uuid, uuid, uuid, uuid, jsonb) TO service_role;

-- ── 7. labelos_audit_invitation_create (146, replaced) ──────────────────
-- Identical to 146 except the pending lookup, which now ignores project
-- invitations: an open invitation to one PROJECT is not an open invitation
-- to the ORG (and must not be mistaken for one).

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
  WHERE i.org_id = p_org AND i.email = p_email AND i.project_id IS NULL
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

-- ── 6. labelos_accept_invitation (139, replaced) ────────────────────────
-- 139's function with one new branch. A project invitation (project_id set)
-- admits the invitee to that project through `project_members` and records
-- `project.member_added`; org_members is never touched for it. Everything
-- else — and every org invitation — is exactly 139. Answers carry
-- `project_id` for the project path so the route can open the right page.

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

NOTIFY pgrst, 'reload schema';
