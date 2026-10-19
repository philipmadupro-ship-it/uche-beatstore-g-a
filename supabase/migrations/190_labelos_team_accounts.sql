-- 190_labelos_team_accounts.sql
-- Label OS: team accounts an organization creates for its people
-- (docs/bstudio-label-os/25-team-accounts.md, phase 1).
--
-- LABEL OS — NOT APPLIED. Apply at the final merge of the Label OS branch
-- into main, after 170 and 189. Never part of supabase/apply/pending.sql.
-- Numbered 190: 171–188 are doc 23's phase-2 reservations, 189 is /setup.
--
-- An owner or admin (`members.manage`) creates a login for a person — the
-- auth user is made by the route with the Supabase admin API, email
-- confirmed, with a password the creator chose — and this migration records
-- that the ORG made it:
--
--  * org_managed_accounts(org_id, user_id, …) — one row per account an org
--    created. UNIQUE (user_id): an account is managed by exactly one org.
--    `must_change_password` sends the person to /account/password until they
--    set their own; `disabled_at` mirrors the auth ban the route sets.
--    Service-role only (no policy); nobody but the functions below writes.
--  * labelos_audit_team_account_create — the membership (role, functions,
--    scope, artist list), the managed row and `member.account_created` in one
--    transaction, seat cap under the lock 170 uses for invitations.
--  * labelos_team_account_target — may THIS org reset / switch off THIS
--    account? Only one it created, that is in nothing else: no other org,
--    no shared project, not the producer, not a platform operator, never the
--    actor themselves, and an owner or an admin only by an owner (peer admins
--    cannot reset each other and sign in as each other). The route asks it
--    before touching the auth user, so an org can never take over somebody's
--    own account. (The setup and join routes refuse a managed account, so it
--    cannot become "in something else" and slip out of its org's control.)
--  * labelos_audit_team_account_reset / _set_disabled — the flag change and
--    its audit event (`member.password_reset`, `member.account_disabled` /
--    `member.account_enabled`), re-checking the same rule under a row lock,
--    and revoking every session the person has (`labelos_revoke_auth_sessions`)
--    in the same transaction, so a reset or a switch-off ends their sign-ins.
--  * labelos_team_account_password_changed — the person's own change clears
--    the flag and revokes their OTHER sessions (the current one is kept; the
--    route records `member.password_changed`).
--  * labelos_revoke_auth_sessions — deletes auth.sessions rows (refresh tokens
--    go with them, and Supabase refuses an access token whose session is
--    gone). If this database does not let it (no table, no privilege) it
--    warns and answers false instead of failing the act; the route logs that.
--  * labelos_my_password_pending — the ONE function the API roles may call:
--    does the CALLER (auth.uid()) still have to choose their own password?
--    It answers about the caller only, so the proxy can refuse every other
--    Label OS request on the caller's own session.
--
-- No password, hash or temporary value is ever written here or to an event.
-- All functions: SECURITY DEFINER, owner postgres, service_role EXECUTE only,
-- except labelos_my_password_pending (authenticated, about oneself).
-- Idempotent: IF NOT EXISTS, CREATE OR REPLACE, DROP POLICY IF EXISTS.

CREATE TABLE IF NOT EXISTS public.org_managed_accounts (
  org_id               uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id              uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_by           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  must_change_password boolean NOT NULL DEFAULT true,
  password_changed_at  timestamptz,
  password_reset_at    timestamptz,
  disabled_at          timestamptz,
  PRIMARY KEY (org_id, user_id),
  CONSTRAINT org_managed_accounts_one_org UNIQUE (user_id)
);

-- Service-role only, like 160's digest tables: RLS on, NO policy, no grant to
-- anon or authenticated. Every read is a server route or page (the members
-- list for managers, the person's own row for the password page).
ALTER TABLE public.org_managed_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.org_managed_accounts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.org_managed_accounts TO service_role;
-- An earlier draft of 190 had a self-read policy; a replay drops it.
DROP POLICY IF EXISTS org_managed_accounts_self_read ON public.org_managed_accounts;

-- ── create ───────────────────────────────────────────────────────────────
-- Returns {"ok": true} or {"error": "seat_limit" | "already_member" | "bad_role"}.

CREATE OR REPLACE FUNCTION public.labelos_audit_team_account_create(
  p_org        uuid,
  p_actor      uuid,
  p_user       uuid,
  p_role       text,
  p_functions  text[],
  p_artist_ids uuid[],
  p_payload    jsonb
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_max_seats int;
  v_scope     text;
BEGIN
  IF p_role IS NULL OR p_role NOT IN ('admin', 'member', 'artist') THEN
    RETURN jsonb_build_object('error', 'bad_role');
  END IF;
  IF EXISTS (SELECT 1 FROM public.org_members WHERE org_id = p_org AND user_id = p_user) THEN
    RETURN jsonb_build_object('error', 'already_member');
  END IF;

  -- 170's seat cap, under the same lock as an invitation being accepted.
  IF p_role <> 'artist' THEN
    SELECT e.max_seats INTO v_max_seats
    FROM public.org_entitlements e
    WHERE e.org_id = p_org
    FOR UPDATE;
    IF v_max_seats IS NOT NULL
       AND (SELECT count(*) FROM public.org_members WHERE org_id = p_org AND role <> 'artist') >= v_max_seats THEN
      RETURN jsonb_build_object('error', 'seat_limit');
    END IF;
  END IF;

  v_scope := CASE WHEN p_role = 'artist' OR cardinality(coalesce(p_artist_ids, '{}')) > 0 THEN 'artists' ELSE 'org' END;

  INSERT INTO public.org_members (org_id, user_id, role, functions, scope, invited_by)
  VALUES (p_org, p_user, p_role, coalesce(p_functions, '{}'), v_scope, p_actor);

  IF cardinality(coalesce(p_artist_ids, '{}')) > 0 THEN
    INSERT INTO public.member_artist_scopes (org_id, user_id, contact_id)
    SELECT p_org, p_user, c.id
    FROM public.contacts c
    WHERE c.id = ANY (p_artist_ids) AND c.org_id = p_org;
  END IF;

  INSERT INTO public.org_managed_accounts (org_id, user_id, created_by)
  VALUES (p_org, p_user, p_actor);

  PERFORM public.labelos_audit_insert(p_org, p_actor, 'member.account_created', 'member', p_user, coalesce(p_payload, '{}'::jsonb));
  RETURN jsonb_build_object('ok', true);
END;
$fn$;

-- ── who may be reset / switched off ──────────────────────────────────────
-- NULL = allowed; otherwise the reason (the route answers 404 / 403 / 409).

CREATE OR REPLACE FUNCTION public.labelos_team_account_target(
  p_org   uuid,
  p_actor uuid,
  p_user  uuid
) RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_role       text;
  v_actor_role text;
BEGIN
  IF p_user = p_actor THEN
    RETURN 'self';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.org_managed_accounts WHERE org_id = p_org AND user_id = p_user) THEN
    RETURN 'not_managed';
  END IF;
  SELECT role INTO v_role FROM public.org_members WHERE org_id = p_org AND user_id = p_user;
  IF NOT FOUND THEN
    RETURN 'not_member';
  END IF;
  SELECT role INTO v_actor_role FROM public.org_members WHERE org_id = p_org AND user_id = p_actor;
  -- An owner or an admin only by an owner: otherwise two admins could reset
  -- each other and sign in as each other.
  IF v_role IN ('owner', 'admin') AND v_actor_role IS DISTINCT FROM 'owner' THEN
    RETURN 'owner_only';
  END IF;
  IF EXISTS (SELECT 1 FROM public.org_members WHERE user_id = p_user AND org_id <> p_org)
     OR EXISTS (SELECT 1 FROM public.project_members WHERE user_id = p_user)
     OR EXISTS (SELECT 1 FROM public.creator_profiles WHERE user_id = p_user)
     OR EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = p_user) THEN
    RETURN 'shared';
  END IF;
  RETURN NULL;
END;
$fn$;

-- ── session revocation ───────────────────────────────────────────────────
-- Every session of p_user except p_keep (the caller's current one, on their
-- own change). True when done; false, with a warning, when this database does
-- not let it, so a reset or switch-off never fails for want of it.

CREATE OR REPLACE FUNCTION public.labelos_revoke_auth_sessions(p_user uuid, p_keep uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  DELETE FROM auth.sessions WHERE user_id = p_user AND (p_keep IS NULL OR id <> p_keep);
  RETURN true;
EXCEPTION WHEN undefined_table OR insufficient_privilege THEN
  RAISE WARNING 'labelos_revoke_auth_sessions: sessions not revoked: %', SQLERRM;
  RETURN false;
END;
$fn$;

-- ── reset ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.labelos_audit_team_account_reset(
  p_org   uuid,
  p_actor uuid,
  p_user  uuid
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_reason text;
BEGIN
  PERFORM 1 FROM public.org_managed_accounts WHERE org_id = p_org AND user_id = p_user FOR UPDATE;
  v_reason := public.labelos_team_account_target(p_org, p_actor, p_user);
  IF v_reason IS NOT NULL THEN
    RETURN jsonb_build_object('error', v_reason);
  END IF;
  UPDATE public.org_managed_accounts
  SET must_change_password = true, password_reset_at = now()
  WHERE org_id = p_org AND user_id = p_user;
  PERFORM public.labelos_audit_insert(p_org, p_actor, 'member.password_reset', 'member', p_user, '{}'::jsonb);
  RETURN jsonb_build_object('ok', true, 'sessions_revoked', public.labelos_revoke_auth_sessions(p_user));
END;
$fn$;

-- ── switch off / on ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.labelos_audit_team_account_set_disabled(
  p_org      uuid,
  p_actor    uuid,
  p_user     uuid,
  p_disabled boolean
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_reason text;
BEGIN
  PERFORM 1 FROM public.org_managed_accounts WHERE org_id = p_org AND user_id = p_user FOR UPDATE;
  v_reason := public.labelos_team_account_target(p_org, p_actor, p_user);
  IF v_reason IS NOT NULL THEN
    RETURN jsonb_build_object('error', v_reason);
  END IF;
  UPDATE public.org_managed_accounts
  SET disabled_at = CASE WHEN p_disabled THEN now() ELSE NULL END
  WHERE org_id = p_org AND user_id = p_user;
  PERFORM public.labelos_audit_insert(
    p_org, p_actor,
    CASE WHEN p_disabled THEN 'member.account_disabled' ELSE 'member.account_enabled' END,
    'member', p_user, '{}'::jsonb);
  -- Switching off ends every sign-in; switching back on has nothing to end.
  RETURN jsonb_build_object('ok', true, 'sessions_revoked',
    CASE WHEN p_disabled THEN public.labelos_revoke_auth_sessions(p_user) ELSE true END);
END;
$fn$;

-- ── the person's own change ──────────────────────────────────────────────
-- Returns the org id of their managed row, or NULL when they have none, and
-- revokes their other sessions (p_keep_session = the one they changed it from).
-- An earlier draft took (p_user) only; a replay drops that signature.

DROP FUNCTION IF EXISTS public.labelos_team_account_password_changed(uuid);

CREATE OR REPLACE FUNCTION public.labelos_team_account_password_changed(p_user uuid, p_keep_session uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_org uuid;
BEGIN
  UPDATE public.org_managed_accounts
  SET must_change_password = false, password_changed_at = now()
  WHERE user_id = p_user
  RETURNING org_id INTO v_org;
  IF v_org IS NOT NULL THEN
    PERFORM public.labelos_revoke_auth_sessions(p_user, p_keep_session);
  END IF;
  RETURN v_org;
END;
$fn$;

-- ── the caller's own pending change ──────────────────────────────────────
-- For src/proxy.ts on the caller's session: may answer only about auth.uid().

CREATE OR REPLACE FUNCTION public.labelos_my_password_pending()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.org_managed_accounts
    WHERE user_id = auth.uid() AND must_change_password AND disabled_at IS NULL
  );
$fn$;

ALTER FUNCTION public.labelos_audit_team_account_create(uuid, uuid, uuid, text, text[], uuid[], jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_audit_team_account_create(uuid, uuid, uuid, text, text[], uuid[], jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_audit_team_account_create(uuid, uuid, uuid, text, text[], uuid[], jsonb) TO service_role;

ALTER FUNCTION public.labelos_team_account_target(uuid, uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_team_account_target(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_team_account_target(uuid, uuid, uuid) TO service_role;

ALTER FUNCTION public.labelos_audit_team_account_reset(uuid, uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_audit_team_account_reset(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_audit_team_account_reset(uuid, uuid, uuid) TO service_role;

ALTER FUNCTION public.labelos_audit_team_account_set_disabled(uuid, uuid, uuid, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_audit_team_account_set_disabled(uuid, uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_audit_team_account_set_disabled(uuid, uuid, uuid, boolean) TO service_role;

ALTER FUNCTION public.labelos_team_account_password_changed(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_team_account_password_changed(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_team_account_password_changed(uuid, uuid) TO service_role;

ALTER FUNCTION public.labelos_revoke_auth_sessions(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_revoke_auth_sessions(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_revoke_auth_sessions(uuid, uuid) TO service_role;

ALTER FUNCTION public.labelos_my_password_pending() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_my_password_pending() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.labelos_my_password_pending() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
