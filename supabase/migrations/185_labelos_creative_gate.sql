-- 185_labelos_creative_gate.sql
-- Label OS (LABEL-68): the OPTIONAL creative approval gate on a release.
--
-- No table and no column. The artistic direction workspace (`/o/<slug>/creative`) READS what the earlier tasks stored —
-- artist_direction / artist_references (152), song_reviews (149), tracks.song_stage (140), releases and approvals
-- (144 / 157) — through the service-role routes and their scope + D4 rules; nothing is duplicated here.
--
-- What this migration adds is the gate itself, one more release gate decided through the existing approvals function
-- family (`creative.approve`, 171):
--
--   1. approvals_gate_check accepts 'creative' (a SONG still takes `legal` only: approvals_song_gate_check is untouched).
--   2. labelos_audit_approval_request (157) lists 'creative' among the gates it accepts. Nothing else in it changes: the
--      body below is 157's with that one word added, same signature, same grants. The two functions 187 redefines
--      (labelos_audit_approval_decide, labelos_audit_release_deliver) get the same word IN 187 ITSELF: 187 sorts after
--      185, so a redefinition here would be silently undone when 187 is applied. 187 is not applied anywhere yet.
--   3. labelos_audit_creative_gate(p_org, p_actor, p_enabled): owner only (a role, not a capability), merges the one
--      `creative_gate` key ('on' | 'off') into organizations.settings under the row lock, derives `from` itself and
--      records `creative_gate.changed` (audit, internal) in the same transaction. Deliberately not part of 172 / 192's
--      settings validator (LABEL-73 reworks it): a sibling function, as 183 did for the marketing plan.
--
-- The gate is OFF by default: a missing or malformed `creative_gate` reads as off, only the exact string 'on' turns it on
-- (lib/contracts parseReadinessSettings). While it is off nothing about releases, readiness or delivery changes.
--
-- Needs 144, 146, 157, 171 and 187 (decide / deliver). Rollback: supabase/rollback/185_labelos_creative_gate.down.sql puts
-- back 157's check and request function word for word and drops the switch function.
-- Idempotent: CREATE OR REPLACE, DROP ... IF EXISTS first.

-- ── 1. the gate vocabulary ───────────────────────────────────────────────

ALTER TABLE public.approvals DROP CONSTRAINT IF EXISTS approvals_gate_check;
ALTER TABLE public.approvals ADD CONSTRAINT approvals_gate_check
  CHECK (gate IN ('master', 'artwork', 'legal', 'marketing', 'metadata', 'creative'));

-- ── 2. the request function accepts it ──────────────────────────────────

CREATE OR REPLACE FUNCTION public.labelos_audit_approval_request(
  p_org uuid,
  p_actor uuid,
  p_kind text,
  p_subject uuid,
  p_gate text,
  p_approver uuid,
  p_note text,
  p_snapshot jsonb,
  p_ctx jsonb,
  p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_last   public.approvals%ROWTYPE;
  v_row    public.approvals%ROWTYPE;
  v_rows   int;
  v_has    boolean;
BEGIN
  PERFORM public.labelos_approval_check_payload(p_payload);
  IF p_kind NOT IN ('song', 'release') THEN
    RAISE EXCEPTION 'unknown approval subject %', p_kind USING ERRCODE = '22023';
  END IF;
  IF p_gate NOT IN ('master', 'artwork', 'legal', 'marketing', 'metadata', 'creative') OR (p_kind = 'song' AND p_gate <> 'legal') THEN
    RETURN jsonb_build_object('error', 'bad_gate');
  END IF;

  -- Lock the subject: two people asking, or asking and deciding, at once are
  -- serialised, so "the latest row" below is the latest row.
  IF p_kind = 'song' THEN
    PERFORM 1 FROM public.tracks t WHERE t.id = p_subject AND t.org_id = p_org AND t.type = 'song' FOR UPDATE;
  ELSE
    PERFORM 1 FROM public.releases r WHERE r.id = p_subject AND r.org_id = p_org FOR UPDATE;
  END IF;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.org_members m WHERE m.org_id = p_org AND m.user_id = p_approver) THEN
    RETURN jsonb_build_object('error', 'approver_not_member');
  END IF;

  SELECT * INTO v_last FROM public.approvals a
  WHERE a.org_id = p_org AND a.gate = p_gate
    AND CASE WHEN p_kind = 'song' THEN a.song_id = p_subject ELSE a.release_id = p_subject END
  ORDER BY a.created_at DESC LIMIT 1;
  IF FOUND AND v_last.decision = 'requested' THEN
    RETURN jsonb_build_object('error', 'already_requested');
  END IF;

  INSERT INTO public.approvals (org_id, song_id, release_id, gate, decision, note, actor_id, approver_id, subject_snapshot)
  VALUES (p_org,
          CASE WHEN p_kind = 'song' THEN p_subject END,
          CASE WHEN p_kind = 'release' THEN p_subject END,
          p_gate, 'requested', NULLIF(btrim(coalesce(p_note, '')), ''), p_actor, p_approver, coalesce(p_snapshot, '{}'::jsonb))
  RETURNING * INTO v_row;

  INSERT INTO public.activity_events (org_id, actor_id, verb, subject_type, subject_id, artist_id, project_id, song_id, release_id, payload, audit, visibility)
  VALUES (p_org, p_actor, 'approval.requested', 'approval', v_row.id,
          NULLIF(p_ctx->>'artist_id', '')::uuid, NULLIF(p_ctx->>'project_id', '')::uuid,
          NULLIF(p_ctx->>'song_id', '')::uuid, NULLIF(p_ctx->>'release_id', '')::uuid,
          p_payload || jsonb_build_object('gate', p_gate), true, 'internal');

  RETURN jsonb_build_object('approval', to_jsonb(v_row));
END;
$fn$;

ALTER FUNCTION public.labelos_audit_approval_request(uuid, uuid, text, uuid, text, uuid, text, jsonb, jsonb, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_audit_approval_request(uuid, uuid, text, uuid, text, uuid, text, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_audit_approval_request(uuid, uuid, text, uuid, text, uuid, text, jsonb, jsonb, jsonb) TO service_role;

-- ── 3. the switch ────────────────────────────────────────────────────────
-- Owner only. Merges the one key under the row lock so a concurrent owner save of another setting cannot lose it, and
-- derives `from` itself so the event never logs a stale value. Answers {"enabled": bool, "changed": bool} or
-- {"error": "not_found" | "not_owner"}.

CREATE OR REPLACE FUNCTION public.labelos_audit_creative_gate(
  p_org uuid,
  p_actor uuid,
  p_enabled boolean
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_settings jsonb;
  v_before boolean;
BEGIN
  IF p_enabled IS NULL THEN
    RAISE EXCEPTION 'creative_gate must be true or false' USING ERRCODE = '22023';
  END IF;
  SELECT o.settings INTO v_settings
  FROM public.organizations o
  WHERE o.id = p_org AND o.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF p_actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.org_members m WHERE m.org_id = p_org AND m.user_id = p_actor AND m.role = 'owner'
  ) THEN
    RETURN jsonb_build_object('error', 'not_owner');
  END IF;

  v_settings := coalesce(v_settings, '{}'::jsonb);
  -- A missing key is NULL, so coalesce: only the exact JSON string "on" counts as on.
  v_before := coalesce((v_settings -> 'creative_gate') = '"on"'::jsonb, false);
  IF v_before = p_enabled THEN
    RETURN jsonb_build_object('enabled', p_enabled, 'changed', false);
  END IF;

  UPDATE public.organizations
     SET settings = v_settings || jsonb_build_object('creative_gate', CASE WHEN p_enabled THEN 'on' ELSE 'off' END)
   WHERE id = p_org;
  PERFORM public.labelos_audit_insert(
    p_org, p_actor, 'creative_gate.changed', 'org', p_org,
    jsonb_build_object('from', CASE WHEN v_before THEN 'on' ELSE 'off' END, 'to', CASE WHEN p_enabled THEN 'on' ELSE 'off' END)
  );
  RETURN jsonb_build_object('enabled', p_enabled, 'changed', true);
END;
$fn$;

ALTER FUNCTION public.labelos_audit_creative_gate(uuid, uuid, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_audit_creative_gate(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_audit_creative_gate(uuid, uuid, boolean) TO service_role;

NOTIFY pgrst, 'reload schema';
