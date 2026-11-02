-- Rollback for 185_labelos_creative_gate.sql (LABEL-68).
--
-- Lives outside supabase/migrations/ on purpose: scripts/apply-migrations.sh applies every *.sql in that folder. Run by
-- hand only.
--
-- Puts back 157's approvals_gate_check and labelos_audit_approval_request exactly as they were, and drops the switch
-- function. (The word 'creative' in 187's decide and deliver functions is harmless without the gate: nothing sends it.) The check is restored as it was, so
-- it REFUSES while creative approval rows exist: approvals are append-only (no UPDATE or DELETE for anyone), so first
-- switch the gate off (PUT …/settings/creative-gate) and, if rows remain, delete them through the organization's hard
-- delete, or accept that this rollback does not apply to an organization that used the gate. The `creative_gate` key
-- stays in organizations.settings (readers ignore an unknown key) and the `creative_gate.changed` events stay: the log
-- is append-only.

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

NOTIFY pgrst, 'reload schema';
