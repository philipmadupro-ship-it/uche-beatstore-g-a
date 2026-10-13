-- 157_labelos_approvals.sql
-- Label OS (LABEL-30): approvals — the human decision at a release gate, stored
-- append-only with a snapshot of what was approved.
--
-- LABEL OS — NOT APPLIED. Apply at the final merge of the Label OS branch
-- into main, after 155 and 156. Never part of supabase/apply/pending.sql.
--
-- 1. `approvals` — one row per REQUEST and one per DECISION (05 §3, 09 §3.3).
--    The subject is a song XOR a release; `gate` is master | artwork | legal |
--    marketing | metadata (a song is asked only for `legal`). `decision` is
--    requested | approved | changes_requested. The latest row per (subject,
--    gate) is where the gate stands — nothing is updated to say so.
--      actor_id        who requested / who decided
--      approver_id     on a request: the one person asked (an org member)
--      request_id      on a decision: the request it answers, when there was one
--      subject_snapshot  what was approved (lib/labelos/approvals.ts): the split
--                      sheet versions and credits (legal), the artwork file, the
--                      tracklist. Whether it is still true is DERIVED by comparing
--                      it with the current facts (`isStale`); the row never changes.
--
-- 2. APPEND-ONLY, held here and not in the route:
--      · no UPDATE for anyone (trigger; also no privilege), no DELETE except
--        with the organization or the release it belongs to (the cascade finds
--        the parent already gone), no TRUNCATE;
--      · `created_at` is stamped by the trigger, so a row cannot be backdated;
--      · the API roles have no write privilege and no write policy, and 141's
--        labelos_org_rows_service_only trigger refuses them as well. Rows are
--        written by the two audit functions below, service_role only.
--
-- 3. Writes: two SECURITY DEFINER functions that make the change AND insert the
--    `activity_events` row in one transaction (146's pattern — if the audit
--    insert fails the approval is not there afterwards):
--      labelos_audit_approval_request  approval.requested
--      labelos_audit_approval_decide   approval.decided
--    The decide function re-checks the one rule the database can know for itself:
--    a requester does not approve their own request unless the caller says
--    they are owner or admin (`p_may_self_approve`, decided by the route from
--    the live membership). Everything else (capabilities, scope, readiness) is
--    the route's, because it needs the application's capability model.
--
-- 4. Reads (RLS, SELECT): a member who holds release.write or any
--    release.approve.<gate> in the row's org, AND (a whole-org member, or the
--    song is in the caller's artist scope — labelos_scoped_tracks(), 149, or
--    the release's project is — labelos_scoped_releases(), 151). Every test is
--    an uncorrelated subquery over the caller's few memberships or a
--    set-returning function called once, so the planner hashes it (R-08: no
--    per-row SECURITY DEFINER call).
--
-- Idempotent: IF NOT EXISTS, CREATE OR REPLACE, DROP ... IF EXISTS first.

-- ── 1. approvals ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.approvals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  song_id          uuid REFERENCES public.tracks(id),
  release_id       uuid REFERENCES public.releases(id) ON DELETE CASCADE,
  gate             text NOT NULL,
  decision         text NOT NULL,
  note             text,
  actor_id         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approver_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  request_id       uuid REFERENCES public.approvals(id),
  subject_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT approvals_subject_check CHECK ((song_id IS NULL) <> (release_id IS NULL)),
  CONSTRAINT approvals_gate_check CHECK (gate IN ('master', 'artwork', 'legal', 'marketing', 'metadata')),
  CONSTRAINT approvals_song_gate_check CHECK (song_id IS NULL OR gate = 'legal'),
  CONSTRAINT approvals_decision_check CHECK (decision IN ('requested', 'approved', 'changes_requested')),
  CONSTRAINT approvals_note_check CHECK (note IS NULL OR length(note) <= 2000),
  CONSTRAINT approvals_changes_note_check CHECK (decision <> 'changes_requested' OR length(btrim(coalesce(note, ''))) > 0),
  CONSTRAINT approvals_request_shape_check CHECK (
    (decision = 'requested' AND approver_id IS NOT NULL AND actor_id IS NOT NULL AND request_id IS NULL)
    OR (decision <> 'requested' AND approver_id IS NULL)
  ),
  CONSTRAINT approvals_snapshot_check CHECK (jsonb_typeof(subject_snapshot) = 'object' AND pg_column_size(subject_snapshot) <= 65536)
);

-- The latest row per (subject, gate), newest first.
CREATE INDEX IF NOT EXISTS idx_approvals_song_gate ON public.approvals (song_id, gate, created_at DESC) WHERE song_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_approvals_release_gate ON public.approvals (release_id, gate, created_at DESC) WHERE release_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_approvals_org ON public.approvals (org_id, created_at DESC);
-- "Asked of me" (the legal queue, LABEL-31).
CREATE INDEX IF NOT EXISTS idx_approvals_approver ON public.approvals (approver_id, created_at DESC) WHERE decision = 'requested';

ALTER TABLE public.approvals ENABLE ROW LEVEL SECURITY;

-- ── 2. Append-only ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.approvals_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org   uuid;
  v_type  text;
  v_req   public.approvals%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'approvals are append-only: a decision is never changed' USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'DELETE' THEN
    -- Only with the organization or the release it belongs to: the cascade
    -- runs after the parent row is gone, so a direct delete (parent present) is refused.
    IF EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = OLD.org_id)
       AND (OLD.release_id IS NULL OR EXISTS (SELECT 1 FROM public.releases r WHERE r.id = OLD.release_id)) THEN
      RAISE EXCEPTION 'approvals are append-only: a decision is never deleted' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  -- INSERT. (current_user is the definer in here, so read the session's role.)
  IF current_setting('role', true) IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION 'approvals: organization rows are written through /api/org only' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF (NEW.song_id IS NULL) = (NEW.release_id IS NULL) THEN
    RAISE EXCEPTION 'approvals: exactly one subject, a song or a release (approvals_subject_check)' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.song_id IS NOT NULL THEN
    SELECT t.org_id, t.type INTO v_org, v_type FROM public.tracks t WHERE t.id = NEW.song_id;
    IF v_org IS NULL OR v_org <> NEW.org_id THEN
      RAISE EXCEPTION 'approvals: the song must be a song of the same organization' USING ERRCODE = 'check_violation';
    END IF;
    IF v_type <> 'song' THEN
      RAISE EXCEPTION 'approvals: a song is approved, not a %', v_type USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    SELECT r.org_id INTO v_org FROM public.releases r WHERE r.id = NEW.release_id;
    IF v_org IS NULL OR v_org <> NEW.org_id THEN
      RAISE EXCEPTION 'approvals: the release must be a release of the same organization' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.decision = 'requested' THEN
    IF NOT EXISTS (SELECT 1 FROM public.org_members m WHERE m.org_id = NEW.org_id AND m.user_id = NEW.approver_id) THEN
      RAISE EXCEPTION 'approvals: the approver must be a member of the organization' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.request_id IS NOT NULL THEN
    SELECT * INTO v_req FROM public.approvals a WHERE a.id = NEW.request_id;
    IF NOT FOUND OR v_req.decision <> 'requested' OR v_req.org_id <> NEW.org_id OR v_req.gate <> NEW.gate
       OR v_req.song_id IS DISTINCT FROM NEW.song_id OR v_req.release_id IS DISTINCT FROM NEW.release_id THEN
      RAISE EXCEPTION 'approvals: a decision answers a request for the same subject and gate' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Not backdated, not future-dated: the order of rows IS the history.
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.approvals_guard() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.approvals_guard() FROM PUBLIC;

DROP TRIGGER IF EXISTS approvals_guard ON public.approvals;
CREATE TRIGGER approvals_guard BEFORE INSERT OR UPDATE OR DELETE ON public.approvals
  FOR EACH ROW EXECUTE FUNCTION public.approvals_guard();

CREATE OR REPLACE FUNCTION public.approvals_no_truncate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'approvals are append-only: the table is never truncated' USING ERRCODE = 'check_violation';
END;
$$;

ALTER FUNCTION public.approvals_no_truncate() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.approvals_no_truncate() FROM PUBLIC;

DROP TRIGGER IF EXISTS approvals_no_truncate ON public.approvals;
CREATE TRIGGER approvals_no_truncate BEFORE TRUNCATE ON public.approvals
  FOR EACH STATEMENT EXECUTE FUNCTION public.approvals_no_truncate();

DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.approvals;
CREATE TRIGGER labelos_org_rows_service_only BEFORE INSERT OR UPDATE OR DELETE ON public.approvals
  FOR EACH ROW EXECUTE FUNCTION public.labelos_org_rows_service_only('self', 'org_id');

-- No privilege to change what was said, for anyone. (The triggers above hold it
-- again for a role that regains the privilege.)
REVOKE ALL ON public.approvals FROM anon, authenticated;
GRANT SELECT ON public.approvals TO authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON public.approvals FROM service_role;
GRANT SELECT, INSERT ON public.approvals TO service_role;

-- ── 3. Reads ─────────────────────────────────────────────────────────────
-- The releases whose project the caller's artist scope reaches come from
-- 151's labelos_scoped_releases() (the release twin of 149's
-- labelos_scoped_tracks()): one set, so the policy stays a hashed subplan.

DROP POLICY IF EXISTS approvals_member_read ON public.approvals;
CREATE POLICY approvals_member_read ON public.approvals
  FOR SELECT
  TO authenticated
  USING (
    org_id IN (
      SELECT cm.org_id
      FROM public.org_members cm
      WHERE cm.user_id = (SELECT auth.uid())
        AND (
          public.has_org_cap(cm.org_id, 'release.write')
          OR public.has_org_cap(cm.org_id, 'release.approve.master')
          OR public.has_org_cap(cm.org_id, 'release.approve.artwork')
          OR public.has_org_cap(cm.org_id, 'release.approve.legal')
          OR public.has_org_cap(cm.org_id, 'release.approve.marketing')
          OR public.has_org_cap(cm.org_id, 'release.approve.metadata')
        )
    )
    AND (
      org_id IN (
        SELECT om.org_id
        FROM public.org_members om
        WHERE om.user_id = (SELECT auth.uid())
          AND om.scope = 'org'
          AND om.role <> 'artist'
      )
      OR (org_id, song_id) IN (SELECT st.org_id, st.track_id FROM public.labelos_scoped_tracks() st)
      OR (org_id, release_id) IN (SELECT sr.org_id, sr.release_id FROM public.labelos_scoped_releases() sr)
    )
  );

-- ── 4. Writes ────────────────────────────────────────────────────────────

-- Shared payload guard (146's rule: an object, no secret-looking key, small).
CREATE OR REPLACE FUNCTION public.labelos_approval_check_payload(p_payload jsonb)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
END;
$$;

ALTER FUNCTION public.labelos_approval_check_payload(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_approval_check_payload(jsonb) FROM PUBLIC;

-- Ask one member to decide a gate. p_kind song | release; p_subject_ctx is the
-- subject's context keys { artist_id, project_id, song_id, release_id } the event
-- is filed under. Answers {"approval": <row>},
-- {"error": "not_found" | "bad_gate" | "already_requested" | "approver_not_member"}.
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

-- Record a decision. p_may_self_approve: the caller is owner or admin (the
-- route reads the live membership). Answers {"approval": <row>},
-- {"error": "not_found" | "bad_gate" | "bad_decision" | "note_required" | "self_approval"}.
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
  ORDER BY a.created_at DESC LIMIT 1;
  v_has := FOUND;

  IF v_has AND v_last.decision = 'requested' AND p_decision = 'approved'
     AND v_last.actor_id = p_actor AND NOT coalesce(p_may_self_approve, false) THEN
    RETURN jsonb_build_object('error', 'self_approval');
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

NOTIFY pgrst, 'reload schema';
