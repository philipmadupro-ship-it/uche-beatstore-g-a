-- Rollback for 194_labelos_creative_gate.sql (LABEL-68).
--
-- Lives outside supabase/migrations/ on purpose: scripts/apply-migrations.sh applies every *.sql in that folder. Run by
-- hand only.
--
-- Puts back 157's approvals_gate_check and labelos_audit_approval_request and 187's labelos_audit_approval_decide and
-- labelos_audit_release_deliver exactly as they were, and drops the switch function. The check is restored as it was, so
-- it REFUSES while creative approval rows exist: approvals are append-only (no UPDATE or DELETE for anyone), so first
-- switch the gate off (PUT …/settings/creative-gate) and, if rows remain, delete them through the organization's hard
-- delete, or accept that this rollback does not apply to an organization that used the gate. The `creative_gate` key is
-- REMOVED from organizations.settings (see below) and the `creative_gate.changed` events stay: the log is append-only.

-- Force the gate off BEFORE anything else: the application sends a `creative` key to the deliver function whenever the
-- setting reads on, and the restored 187 function refuses an unknown gate (22023, a 500). Removing the key makes the
-- setting read as off, so nothing sends it. (The `creative_gate.changed` events stay: the log is append-only.)
UPDATE public.organizations SET settings = settings - 'creative_gate' WHERE settings ? 'creative_gate';

DROP FUNCTION IF EXISTS public.labelos_audit_creative_gate(uuid, uuid, boolean);

ALTER TABLE public.approvals DROP CONSTRAINT IF EXISTS approvals_gate_check;
ALTER TABLE public.approvals ADD CONSTRAINT approvals_gate_check
  CHECK (gate IN ('master', 'artwork', 'legal', 'marketing', 'metadata'));

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
  IF p_gate NOT IN ('master', 'artwork', 'legal', 'marketing', 'metadata') OR (p_kind = 'song' AND p_gate <> 'legal') THEN
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

CREATE OR REPLACE FUNCTION public.labelos_audit_approval_decide(
  p_org uuid,
  p_actor uuid,
  p_kind text,
  p_subject uuid,
  p_gate text,
  p_decision text,
  p_note text,
  p_snapshot jsonb,
  p_may_self_approve boolean,
  p_ctx jsonb,
  p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_last  public.approvals%ROWTYPE;
  v_row   public.approvals%ROWTYPE;
  v_rows  int;
  v_has   boolean;
  v_note  text := NULLIF(btrim(coalesce(p_note, '')), '');
  v_check jsonb := CASE WHEN jsonb_typeof(p_ctx->'check') = 'object' THEN p_ctx->'check' ELSE NULL END;
BEGIN
  PERFORM public.labelos_approval_check_payload(p_payload);
  IF p_kind NOT IN ('song', 'release') THEN
    RAISE EXCEPTION 'unknown approval subject %', p_kind USING ERRCODE = '22023';
  END IF;
  IF p_gate NOT IN ('master', 'artwork', 'legal', 'marketing', 'metadata') OR (p_kind = 'song' AND p_gate <> 'legal') THEN
    RETURN jsonb_build_object('error', 'bad_gate');
  END IF;
  IF p_decision NOT IN ('approved', 'changes_requested') THEN
    RETURN jsonb_build_object('error', 'bad_decision');
  END IF;
  IF p_decision = 'changes_requested' AND v_note IS NULL THEN
    RETURN jsonb_build_object('error', 'note_required');
  END IF;

  IF p_kind = 'song' THEN
    PERFORM 1 FROM public.tracks t WHERE t.id = p_subject AND t.org_id = p_org AND t.type = 'song' FOR UPDATE;
  ELSE
    PERFORM 1 FROM public.releases r WHERE r.id = p_subject AND r.org_id = p_org FOR UPDATE;
  END IF;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  SELECT * INTO v_last FROM public.approvals a
  WHERE a.org_id = p_org AND a.gate = p_gate
    AND CASE WHEN p_kind = 'song' THEN a.song_id = p_subject ELSE a.release_id = p_subject END
  ORDER BY a.created_at DESC, a.id DESC LIMIT 1;
  v_has := FOUND;

  IF v_has AND v_last.decision = 'requested' AND p_decision = 'approved'
     AND v_last.actor_id = p_actor AND NOT coalesce(p_may_self_approve, false) THEN
    RETURN jsonb_build_object('error', 'self_approval');
  END IF;

  -- 187 (LABEL-73): what the route's plan read must still be true under the lock. Without
  -- p_ctx.check (a caller from before 187) this is 157's function unchanged.
  IF v_check IS NOT NULL THEN
    IF v_check ? 'latest' AND coalesce(v_last.id::text, '') IS DISTINCT FROM lower(coalesce(v_check->>'latest', '')) THEN
      RETURN jsonb_build_object('error', 'changed');
    END IF;
    IF p_decision = 'approved' THEN
      IF coalesce(btrim(v_check->>'seen'), '') = '' THEN
        RETURN jsonb_build_object('error', 'seen_required');
      END IF;
      -- Approving needs an open request addressed to the decider; owner and admin are exempt (doc 21 #15).
      IF NOT coalesce(p_may_self_approve, false)
         AND NOT (v_has AND v_last.decision = 'requested' AND v_last.approver_id = p_actor) THEN
        RETURN jsonb_build_object('error', 'no_request');
      END IF;
      -- A song on a release that is still going out is approved there (doc 21 #13).
      IF p_kind = 'song' AND p_gate = 'legal' AND EXISTS (
        SELECT 1 FROM public.release_items ri
        JOIN public.releases r ON r.id = ri.release_id
        WHERE ri.org_id = p_org AND ri.song_track_id = p_subject AND r.state NOT IN ('cancelled', 'withdrawn')
      ) THEN
        RETURN jsonb_build_object('error', 'decided_on_release');
      END IF;
      IF v_check ? 'key' AND v_check->>'seen' IS DISTINCT FROM v_check->>'key' THEN
        RETURN jsonb_build_object('error', 'changed_since_seen');
      END IF;
    END IF;
  END IF;

  INSERT INTO public.approvals (org_id, song_id, release_id, gate, decision, note, actor_id, request_id, subject_snapshot)
  VALUES (p_org,
          CASE WHEN p_kind = 'song' THEN p_subject END,
          CASE WHEN p_kind = 'release' THEN p_subject END,
          p_gate, p_decision, v_note, p_actor,
          CASE WHEN v_has AND v_last.decision = 'requested' THEN v_last.id END,
          coalesce(p_snapshot, '{}'::jsonb))
  RETURNING * INTO v_row;

  INSERT INTO public.activity_events (org_id, actor_id, verb, subject_type, subject_id, artist_id, project_id, song_id, release_id, payload, audit, visibility)
  VALUES (p_org, p_actor, 'approval.decided', 'approval', v_row.id,
          NULLIF(p_ctx->>'artist_id', '')::uuid, NULLIF(p_ctx->>'project_id', '')::uuid,
          NULLIF(p_ctx->>'song_id', '')::uuid, NULLIF(p_ctx->>'release_id', '')::uuid,
          p_payload || jsonb_build_object('gate', p_gate, 'decision', p_decision), true, 'internal');

  RETURN jsonb_build_object('approval', to_jsonb(v_row));
END;
$fn$;

ALTER FUNCTION public.labelos_audit_approval_decide(uuid, uuid, text, uuid, text, text, text, jsonb, boolean, jsonb, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_audit_approval_decide(uuid, uuid, text, uuid, text, text, text, jsonb, boolean, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_audit_approval_decide(uuid, uuid, text, uuid, text, text, text, jsonb, boolean, jsonb, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.labelos_audit_release_deliver(
  p_org uuid,
  p_actor uuid,
  p_release uuid,
  p_distributor text,
  p_delivered_at timestamptz,
  p_expect jsonb,
  p_ctx jsonb,
  p_payload jsonb,
  p_visibility text
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_rel  public.releases%ROWTYPE;
  v_gate text;
BEGIN
  PERFORM public.labelos_approval_check_payload(p_payload);
  IF p_visibility NOT IN ('artist', 'internal') THEN
    RAISE EXCEPTION 'unknown visibility %', p_visibility USING ERRCODE = '22023';
  END IF;
  IF p_expect IS NULL OR jsonb_typeof(p_expect) <> 'object' OR jsonb_typeof(p_expect->'approvals') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'delivery needs the fingerprint the readiness was read from' USING ERRCODE = '22023';
  END IF;
  IF p_distributor IS NULL OR btrim(p_distributor) = '' THEN
    RAISE EXCEPTION 'delivery needs a distributor' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_rel FROM public.releases WHERE id = p_release AND org_id = p_org FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF v_rel.state <> 'draft' THEN
    RETURN jsonb_build_object('error', 'not_draft', 'state', v_rel.state);
  END IF;

  -- Did a gate move between the route's read and this lock?
  IF v_rel.updated_at IS DISTINCT FROM (p_expect->>'release_updated_at')::timestamptz
     OR public.labelos_release_items_key(p_release) IS DISTINCT FROM coalesce(p_expect->>'items', '') THEN
    RETURN jsonb_build_object('error', 'changed');
  END IF;
  FOR v_gate IN SELECT jsonb_object_keys(p_expect->'approvals') LOOP
    IF v_gate NOT IN ('master', 'artwork', 'legal', 'marketing', 'metadata') THEN
      RAISE EXCEPTION 'unknown gate %', v_gate USING ERRCODE = '22023';
    END IF;
    IF public.labelos_release_latest_approval(p_release, v_gate) IS DISTINCT FROM lower(coalesce(p_expect->'approvals'->>v_gate, '')) THEN
      RETURN jsonb_build_object('error', 'changed');
    END IF;
  END LOOP;

  UPDATE public.releases
     SET state = 'delivered', delivered_at = p_delivered_at, delivered_to = p_distributor
   WHERE id = p_release
   RETURNING * INTO v_rel;

  INSERT INTO public.activity_events (org_id, actor_id, verb, subject_type, subject_id, artist_id, project_id, release_id, payload, audit, visibility)
  VALUES (p_org, p_actor, 'release.delivered', 'release', p_release,
          NULLIF(p_ctx->>'artist_id', '')::uuid, NULLIF(p_ctx->>'project_id', '')::uuid, p_release,
          p_payload, true, p_visibility);

  RETURN jsonb_build_object('release', to_jsonb(v_rel));
END;
$fn$;

ALTER FUNCTION public.labelos_audit_release_deliver(uuid, uuid, uuid, text, timestamptz, jsonb, jsonb, jsonb, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_audit_release_deliver(uuid, uuid, uuid, text, timestamptz, jsonb, jsonb, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_audit_release_deliver(uuid, uuid, uuid, text, timestamptz, jsonb, jsonb, jsonb, text) TO service_role;

NOTIFY pgrst, 'reload schema';
