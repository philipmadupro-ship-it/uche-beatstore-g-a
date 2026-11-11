-- 199_labelos_press_share_audit.sql
-- Label OS (review G16, PR #195): making and revoking a press-kit share link are audit-class.
--
-- `press_kit.shared` and `press_kit.share_revoked` were best-effort `recordEvent` calls AFTER the change, so a link
-- could exist (or be revoked) with no record. Two SECURITY DEFINER functions (146 pattern, `service_role` EXECUTE
-- only) now make the change AND insert the `activity_events` row (audit = true, visibility internal) in one
-- transaction: if the event cannot be written, the change is not there.
--
--   labelos_audit_press_share_create(p_org, p_actor, p_kit, p_token_hash, p_label, p_expires_at, p_max, p_ctx, p_payload)
--     answers { share: {...} } or { error: 'not_found' | 'full' }. Locks the kit row, counts live links (not revoked,
--     not expired is the app's notion; the cap counts the unrevoked ones like the route did), inserts the share
--     with the SHA-256 hash only (the token never reaches the database), writes `press_kit.shared`.
--   labelos_audit_press_share_revoke(p_org, p_actor, p_kit, p_share, p_ctx, p_payload)
--     answers { share: {...} } or { error: 'not_found' } (unknown id, other kit/org, or already revoked); writes
--     `press_kit.share_revoked`.
--
-- The payload is validated like every audit function's (object, no secret-looking key, size). `p_ctx` carries the
-- context keys the event is filed under: { artist_id, project_id, release_id }. Idempotent.

CREATE OR REPLACE FUNCTION public.labelos_audit_press_share_create(
  p_org uuid, p_actor uuid, p_kit uuid, p_token_hash text, p_label text, p_expires_at timestamptz, p_max int, p_ctx jsonb, p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_kit public.press_kits%ROWTYPE;
  v_live int;
  v_share public.press_kit_shares%ROWTYPE;
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

  SELECT * INTO v_kit FROM public.press_kits k WHERE k.id = p_kit AND k.org_id = p_org FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;

  SELECT count(*) INTO v_live FROM public.press_kit_shares s WHERE s.org_id = p_org AND s.kit_id = p_kit AND s.revoked_at IS NULL;
  IF v_live >= p_max THEN RETURN jsonb_build_object('error', 'full'); END IF;

  INSERT INTO public.press_kit_shares (org_id, kit_id, token_hash, label, expires_at, created_by)
  VALUES (p_org, p_kit, p_token_hash, p_label, p_expires_at, p_actor)
  RETURNING * INTO v_share;

  INSERT INTO public.activity_events (org_id, actor_id, verb, subject_type, subject_id, artist_id, project_id, release_id, payload, audit, visibility)
  VALUES (p_org, p_actor, 'press_kit.shared', 'release', v_kit.release_id,
          NULLIF(p_ctx->>'artist_id', '')::uuid, NULLIF(p_ctx->>'project_id', '')::uuid, v_kit.release_id,
          p_payload || jsonb_build_object('shareId', v_share.id, 'expires', v_share.expires_at IS NOT NULL), true, 'internal');

  RETURN jsonb_build_object('share', jsonb_build_object(
    'id', v_share.id, 'label', v_share.label, 'expires_at', v_share.expires_at, 'revoked_at', v_share.revoked_at,
    'view_count', v_share.view_count, 'last_viewed_at', v_share.last_viewed_at, 'created_at', v_share.created_at));
END;
$fn$;

ALTER FUNCTION public.labelos_audit_press_share_create(uuid, uuid, uuid, text, text, timestamptz, int, jsonb, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_audit_press_share_create(uuid, uuid, uuid, text, text, timestamptz, int, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_audit_press_share_create(uuid, uuid, uuid, text, text, timestamptz, int, jsonb, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.labelos_audit_press_share_revoke(
  p_org uuid, p_actor uuid, p_kit uuid, p_share uuid, p_ctx jsonb, p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_kit public.press_kits%ROWTYPE;
  v_share public.press_kit_shares%ROWTYPE;
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

  SELECT * INTO v_kit FROM public.press_kits k WHERE k.id = p_kit AND k.org_id = p_org;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;

  UPDATE public.press_kit_shares s SET revoked_at = now(), revoked_by = p_actor
  WHERE s.id = p_share AND s.org_id = p_org AND s.kit_id = p_kit AND s.revoked_at IS NULL
  RETURNING * INTO v_share;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;

  INSERT INTO public.activity_events (org_id, actor_id, verb, subject_type, subject_id, artist_id, project_id, release_id, payload, audit, visibility)
  VALUES (p_org, p_actor, 'press_kit.share_revoked', 'release', v_kit.release_id,
          NULLIF(p_ctx->>'artist_id', '')::uuid, NULLIF(p_ctx->>'project_id', '')::uuid, v_kit.release_id,
          p_payload || jsonb_build_object('shareId', v_share.id), true, 'internal');

  RETURN jsonb_build_object('share', jsonb_build_object('id', v_share.id));
END;
$fn$;

ALTER FUNCTION public.labelos_audit_press_share_revoke(uuid, uuid, uuid, uuid, jsonb, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_audit_press_share_revoke(uuid, uuid, uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_audit_press_share_revoke(uuid, uuid, uuid, uuid, jsonb, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
