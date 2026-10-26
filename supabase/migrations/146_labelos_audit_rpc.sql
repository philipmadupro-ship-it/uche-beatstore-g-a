-- 146_labelos_audit_rpc.sql
-- Label OS (LABEL-19): audit-class mutations that commit WITH their event.
--
-- LABEL OS — NOT APPLIED. Apply at the final merge of the Label OS branch
-- into main, after 136–145 (docs/bstudio-label-os/16-execution-runbook.md).
-- Never part of supabase/apply/pending.sql.
--
-- SQL functions only; no table or column changes. Until now an audit event
-- (06 §6) was written by the route AFTER the mutation, and a failed write
-- was undone by a best-effort compensating write that could itself fail.
-- Each function below does the mutation AND the activity_events insert in
-- one transaction: if the audit insert fails, the mutation rolls back, and
-- no compensation code exists to get wrong.
--
--   labelos_audit_member_update        role / functions / scope / abilities
--                                      (+ clearing the artist list when the
--                                      member ends up seeing the whole org —
--                                      decided here, under the row lock)
--   labelos_audit_member_remove        remove a member
--   labelos_audit_member_artists_set   replace an artists-scoped member's list
--   labelos_audit_invitation_create    create an invitation (one pending per
--                                      address, decided under a lock)
--   labelos_audit_invitation_revoke    revoke a pending invitation
--
-- (Accepting an invitation is 138's labelos_accept_invitation, which already
-- writes `member.joined` in its own transaction.) Split transitions,
-- approvals and delivery have no mutating route yet (LABEL-30/32/33); each
-- adds its function here-style when its route lands.
--
-- Security: SECURITY DEFINER, owned by postgres (owner of 136's tables),
-- EXECUTE for service_role ONLY — `authenticated` and `anon` have none,
-- asserted in supabase/local/checks/146_labelos_audit_rpc.sql. The functions
-- do not re-derive who may act: the route has already run requireOrgCapability
-- and planMemberChange, and the service role is the only caller. They do
-- refuse what the database can know for itself (unknown verb, a payload that
-- looks like a secret, a row of another org).
--
-- Also here, because the activity feed needs a complete history (08 §B5):
-- orgs created by 137's backfill never got an `org.created` event (only
-- POST /api/profile records one). One is written for each org without one,
-- stamped with the org's own created_at and marked `source: 'backfill'`.
--
-- Idempotent: CREATE OR REPLACE; the backfill inserts only where missing.

-- ── private helper: the one event insert ─────────────────────────────────
-- Not callable by anyone but the functions below (owner-only EXECUTE).

CREATE OR REPLACE FUNCTION public.labelos_audit_insert(
  p_org uuid,
  p_actor uuid,
  p_verb text,
  p_subject_type text,
  p_subject_id uuid,
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
  -- Same rule as recordEvent: a bearer secret never lands in the log (06 §5).
  IF p_payload::text ~* '"[^"]*(token|password|secret)[^"]*"\s*:' THEN
    RAISE EXCEPTION 'audit payload carries a secret-looking key' USING ERRCODE = '22023';
  END IF;
  IF pg_column_size(p_payload) > 16384 THEN
    RAISE EXCEPTION 'audit payload is too large' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.activity_events (org_id, actor_id, verb, subject_type, subject_id, payload, audit, visibility)
  VALUES (p_org, p_actor, p_verb, p_subject_type, p_subject_id, p_payload, true, 'internal')
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$fn$;

ALTER FUNCTION public.labelos_audit_insert(uuid, uuid, text, text, uuid, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_audit_insert(uuid, uuid, text, text, uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- ── member update ────────────────────────────────────────────────────────
-- p_patch holds only the keys that change: role, functions, scope,
-- cap_grants, cap_revokes. A member who ends up seeing the whole org (role
-- other than `artist` AND scope `org`, 06 §2.5) has their artist list
-- dropped, so a later limit starts from none; the dropped ids are added to
-- the payload as contact_ids {from, to: []}. That decision is made here from
-- the row as it is under the lock, not from what the route read earlier.
-- Answers {"member": <row>} or {"error": "not_found"}.
-- A change that would leave the org without an owner is refused by 136's
-- deferred trigger at COMMIT, which rolls the event back with it.

CREATE OR REPLACE FUNCTION public.labelos_audit_member_update(
  p_org uuid,
  p_actor uuid,
  p_user uuid,
  p_patch jsonb,
  p_verb text,
  p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_row     public.org_members%ROWTYPE;
  v_cleared uuid[] := '{}';
  v_payload jsonb := p_payload;
BEGIN
  IF p_verb NOT IN ('member.role_changed', 'member.capabilities_changed', 'member.scope_changed') THEN
    RAISE EXCEPTION 'unknown member verb %', p_verb USING ERRCODE = '22023';
  END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' OR p_patch = '{}'::jsonb THEN
    RAISE EXCEPTION 'empty member patch' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.org_members WHERE org_id = p_org AND user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  UPDATE public.org_members m
  SET role        = COALESCE(p_patch->>'role', m.role),
      functions   = CASE WHEN p_patch ? 'functions'   THEN ARRAY(SELECT jsonb_array_elements_text(p_patch->'functions'))   ELSE m.functions END,
      scope       = COALESCE(p_patch->>'scope', m.scope),
      cap_grants  = CASE WHEN p_patch ? 'cap_grants'  THEN ARRAY(SELECT jsonb_array_elements_text(p_patch->'cap_grants'))  ELSE m.cap_grants END,
      cap_revokes = CASE WHEN p_patch ? 'cap_revokes' THEN ARRAY(SELECT jsonb_array_elements_text(p_patch->'cap_revokes')) ELSE m.cap_revokes END
  WHERE m.org_id = p_org AND m.user_id = p_user
  RETURNING m.* INTO v_row;

  IF v_row.role <> 'artist' AND v_row.scope <> 'artists' THEN
    WITH gone AS (
      DELETE FROM public.member_artist_scopes s
      WHERE s.org_id = p_org AND s.user_id = p_user
      RETURNING s.contact_id
    )
    SELECT COALESCE(array_agg(contact_id ORDER BY contact_id), '{}') INTO v_cleared FROM gone;
    IF cardinality(v_cleared) > 0 THEN
      v_payload := v_payload || jsonb_build_object('contact_ids', jsonb_build_object('from', to_jsonb(v_cleared), 'to', '[]'::jsonb));
    END IF;
  END IF;

  PERFORM public.labelos_audit_insert(p_org, p_actor, p_verb, 'member', p_user, v_payload);

  RETURN jsonb_build_object('member', jsonb_build_object(
    'user_id', v_row.user_id,
    'role', v_row.role,
    'functions', to_jsonb(v_row.functions),
    'scope', v_row.scope,
    'cap_grants', to_jsonb(v_row.cap_grants),
    'cap_revokes', to_jsonb(v_row.cap_revokes),
    'joined_at', v_row.joined_at,
    'invited_by', v_row.invited_by
  ));
END;
$fn$;

ALTER FUNCTION public.labelos_audit_member_update(uuid, uuid, uuid, jsonb, text, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_audit_member_update(uuid, uuid, uuid, jsonb, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_audit_member_update(uuid, uuid, uuid, jsonb, text, jsonb) TO service_role;

-- ── member remove ────────────────────────────────────────────────────────
-- The membership's artist list goes with it (FK cascade) and comes back with
-- it if anything below fails: it is one transaction.

CREATE OR REPLACE FUNCTION public.labelos_audit_member_remove(
  p_org uuid,
  p_actor uuid,
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
  DELETE FROM public.org_members WHERE org_id = p_org AND user_id = p_user;
  GET DIAGNOSTICS v_gone = ROW_COUNT;
  IF v_gone = 0 THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  PERFORM public.labelos_audit_insert(p_org, p_actor, 'member.removed', 'member', p_user, p_payload);
  RETURN jsonb_build_object('removed', true);
END;
$fn$;

ALTER FUNCTION public.labelos_audit_member_remove(uuid, uuid, uuid, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_audit_member_remove(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_audit_member_remove(uuid, uuid, uuid, jsonb) TO service_role;

-- ── member artists ───────────────────────────────────────────────────────
-- Make the list exactly p_contact_ids (139's same-org trigger still judges
-- each row). Only for a member limited to some artists — checked here under
-- the row lock, so a widening that lands first is not undone by a stale list.
-- Answers {"contact_ids": [...]}, {"error": "not_found"} or
-- {"error": "not_scoped"}.

CREATE OR REPLACE FUNCTION public.labelos_audit_member_artists_set(
  p_org uuid,
  p_actor uuid,
  p_user uuid,
  p_contact_ids uuid[],
  p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_ids   uuid[];
  v_role  text;
  v_scope text;
BEGIN
  SELECT m.role, m.scope INTO v_role, v_scope
  FROM public.org_members m WHERE m.org_id = p_org AND m.user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF v_role <> 'artist' AND v_scope <> 'artists' THEN
    RETURN jsonb_build_object('error', 'not_scoped');
  END IF;
  v_ids := COALESCE(ARRAY(SELECT DISTINCT c FROM unnest(p_contact_ids) AS c ORDER BY c), '{}');

  DELETE FROM public.member_artist_scopes s
  WHERE s.org_id = p_org AND s.user_id = p_user AND NOT (s.contact_id = ANY (v_ids));
  INSERT INTO public.member_artist_scopes (org_id, user_id, contact_id)
  SELECT p_org, p_user, c FROM unnest(v_ids) AS c
  ON CONFLICT (org_id, user_id, contact_id) DO NOTHING;

  PERFORM public.labelos_audit_insert(p_org, p_actor, 'member.artists_changed', 'member', p_user, p_payload);
  RETURN jsonb_build_object('contact_ids', to_jsonb(v_ids));
END;
$fn$;

ALTER FUNCTION public.labelos_audit_member_artists_set(uuid, uuid, uuid, uuid[], jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_audit_member_artists_set(uuid, uuid, uuid, uuid[], jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_audit_member_artists_set(uuid, uuid, uuid, uuid[], jsonb) TO service_role;

-- ── invitation create ────────────────────────────────────────────────────
-- One pending invitation per address per org, decided HERE under a
-- transaction-scoped advisory lock — the route no longer has to insert,
-- re-check and delete to survive two simultaneous requests (a delete would
-- leave an `invitation.created` event with nothing behind it).
-- Answers {"invitation": <row>} or {"error": "pending", "id": <existing>}.
-- The token hash (never the token) is stored, exactly as before.

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

-- ── invitation revoke ────────────────────────────────────────────────────
-- Only a still-pending row. Answers {"revoked_at": ...} or
-- {"error": "not_pending"} (the route reads the row to say which of
-- already-revoked / accepted / missing it is).

CREATE OR REPLACE FUNCTION public.labelos_audit_invitation_revoke(
  p_org uuid,
  p_actor uuid,
  p_id uuid,
  p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_at timestamptz;
BEGIN
  UPDATE public.org_invitations i
  SET revoked_at = now()
  WHERE i.org_id = p_org AND i.id = p_id AND i.accepted_at IS NULL AND i.revoked_at IS NULL
  RETURNING i.revoked_at INTO v_at;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'not_pending');
  END IF;
  PERFORM public.labelos_audit_insert(p_org, p_actor, 'invitation.revoked', 'invitation', p_id, p_payload);
  RETURN jsonb_build_object('revoked_at', v_at);
END;
$fn$;

ALTER FUNCTION public.labelos_audit_invitation_revoke(uuid, uuid, uuid, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_audit_invitation_revoke(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_audit_invitation_revoke(uuid, uuid, uuid, jsonb) TO service_role;

-- ── org.created backfill ─────────────────────────────────────────────────
-- Orgs 137 created for existing producers have no `org.created`. Everyday
-- (non-audit) event, internal, dated to the org's own creation.

INSERT INTO public.activity_events (org_id, actor_id, verb, subject_type, subject_id, payload, audit, visibility, created_at)
SELECT o.id, o.created_by, 'org.created', 'org', o.id,
       jsonb_build_object('kind', o.kind, 'source', 'backfill'),
       false, 'internal', o.created_at
FROM public.organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM public.activity_events e WHERE e.org_id = o.id AND e.verb = 'org.created'
);

NOTIFY pgrst, 'reload schema';
