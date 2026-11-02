-- 187_labelos_atomic_audit_functions.sql
-- Label OS (LABEL-73): the audit-class writes that still wrote the change and
-- THEN the event (with a best-effort put-back) become one SECURITY DEFINER
-- function each — the change and its `activity_events` row in one transaction,
-- EXECUTE for service_role only (146's shape, 157's family). Design:
-- docs/bstudio-label-os/20-review-G7-atomic-deliver.md with G10's amendments
-- (raw updated_at string, fingerprint scope, one function family).
--
-- LABEL OS — NOT APPLIED. Apply at the final merge of the Label OS branch,
-- after 186 (and 154/157/158/167/172/192, which it replaces or reads). Never
-- part of supabase/apply/pending.sql.
--
-- Every route keeps its previous path and uses it when the function is not
-- there (PGRST202 / 42883), so production behaves as before until 187 is applied.
--
--  1. labelos_audit_release_deliver — draft → delivered + `release.delivered`.
--     Locks the release FOR UPDATE and compares the FINGERPRINT the route
--     evaluated readiness from (release `updated_at` as the raw string, the
--     latest approval id per gate, the ordered tracklist) with the same facts
--     under the lock: a mismatch is {"error":"changed"} and nothing is written,
--     so no put-back exists. Tracklist edits are refused on a non-draft release
--     by 167's release_items_store_lock, which takes FOR SHARE on this row.
--     Fingerprint scope (G10): the release row, release-subject approvals and
--     the tracklist. Song-level credits / splits / legal and `settings` are NOT
--     covered — a changed split stales the legal approval, derived on read.
--  2. labelos_audit_release_store — list / unlist (+ `release.store_listed` /
--     `release.store_unlisted`). Under the lock: the release is still what the
--     route planned from (state, imported_released, release_date, tracklist),
--     no artist said no and the owner did not veto (186) — consent is
--     re-checked HERE, so there is no claim to put back. Derivative cutting
--     (previews / full copies) stays in the route, before the call.
--  3. labelos_audit_release_import — an import is entered as delivered, with
--     its project (when none was named), the release row and `release.imported`
--     in one transaction.
--  4. labelos_audit_org_delete / _restore / _export — soft delete, restore
--     (compare-and-set on deleted_at, grace period re-checked in SQL) and the
--     export's event (owner and live org re-checked, event first).
--  5. labelos_audit_digest_channel_set / _remove — the Slack webhook cipher
--     and `digest.channel_set` / `digest.channel_removed`; `replaced` is read
--     under the lock.
--  6. labelos_audit_approval_decide (157) — same signature; the route passes
--     `p_ctx.check`, and the function then also enforces, under the subject's
--     lock: the latest row is the one the plan read ('changed'), "approve only
--     an open request addressed to you" ('no_request', owner/admin exempt),
--     a song's legal approval is refused once it is on a live release
--     ('decided_on_release'), and `seen` is required and equals the key
--     ('seen_required' / 'changed_since_seen'). Without `check` it is 157's.
--  7. labelos_audit_org_settings_atomic (a sibling of 192's labelos_audit_org_settings) — the `from` values of the audit payload
--     are read under the row lock, so two simultaneous owner saves cannot log
--     a stale `from`.
--  8. has_org_cap (171) — a capability whose module the owner switched off
--     (`organizations.settings.departments_off`) is false, like TS
--     `effectiveModules`. Only the module step changes.
--  9. Caps in SQL: labelos_artist_cap_ok + a trigger on contacts (the artist
--     cap, atomic with the write, under the entitlement row's lock);
--     labelos_audit_member_update (167) refuses an artist → staff change that
--     would pass max_seats ({"error":"seat_limit"}); 154's connection accept
--     answers {"error":"artist_limit"} instead of inserting a roster artist
--     past max_artists.
--
-- Rollback: supabase/rollback/187_labelos_atomic_audit_functions.down.sql puts
-- back 157 / 167 / 171 / 192 / 154 word for word and drops the rest.
-- Idempotent: CREATE OR REPLACE, DROP ... IF EXISTS first.

-- ── helpers ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.labelos_release_items_key(p_release uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(string_agg(ri.song_track_id::text || ':' || ri.master_track_id::text, ',' ORDER BY ri.position, ri.id), '')
  FROM public.release_items ri
  WHERE ri.release_id = p_release
$$;

ALTER FUNCTION public.labelos_release_items_key(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_release_items_key(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.labelos_release_latest_approval(p_release uuid, p_gate text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce((
    SELECT a.id::text FROM public.approvals a
    WHERE a.release_id = p_release AND a.gate = p_gate
    ORDER BY a.created_at DESC, a.id DESC LIMIT 1
  ), '')
$$;

ALTER FUNCTION public.labelos_release_latest_approval(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_release_latest_approval(uuid, text) FROM PUBLIC, anon, authenticated;

-- ── 1. deliver ───────────────────────────────────────────────────────────
-- p_expect: { release_updated_at: <raw string>, items: <labelos_release_items_key text>,
--             approvals: { master|artwork|legal|marketing|metadata: <latest approval id or ''> } }
-- p_ctx: { artist_id, project_id }. Answers {"release": <row>} or
-- {"error": "not_found" | "not_draft" | "changed", "state"?}.

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

-- ── 2. store listing ─────────────────────────────────────────────────────
-- p_expect: { state, imported_released, release_date (text|null), store_listed, items }
-- List: p_playback null leaves store_playback as it is. Unlist resets it to 'preview'.
-- Answers {"release": <row>} or {"error": "not_found" | "changed" | "consent" | "not_released" | "not_listed"}.

CREATE OR REPLACE FUNCTION public.labelos_audit_release_store(
  p_org uuid,
  p_actor uuid,
  p_release uuid,
  p_list boolean,
  p_playback text,
  p_expect jsonb,
  p_ctx jsonb,
  p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_rel public.releases%ROWTYPE;
BEGIN
  PERFORM public.labelos_approval_check_payload(p_payload);
  IF p_expect IS NULL OR jsonb_typeof(p_expect) <> 'object' THEN
    RAISE EXCEPTION 'listing needs the facts the plan was made from' USING ERRCODE = '22023';
  END IF;
  IF p_playback IS NOT NULL AND p_playback NOT IN ('preview', 'full') THEN
    RAISE EXCEPTION 'unknown playback %', p_playback USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_rel FROM public.releases WHERE id = p_release AND org_id = p_org FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  IF v_rel.state IS DISTINCT FROM (p_expect->>'state')
     OR v_rel.imported_released IS DISTINCT FROM (p_expect->>'imported_released')::boolean
     OR v_rel.release_date IS DISTINCT FROM (p_expect->>'release_date')::date
     OR v_rel.store_listed IS DISTINCT FROM (p_expect->>'store_listed')::boolean
     OR public.labelos_release_items_key(p_release) IS DISTINCT FROM coalesce(p_expect->>'items', '') THEN
    RETURN jsonb_build_object('error', 'changed');
  END IF;

  IF p_list THEN
    IF v_rel.state <> 'delivered' THEN
      RETURN jsonb_build_object('error', 'not_released');
    END IF;
    -- 186: any artist's "no" and the owner's veto are final. Read under the lock, so an answer that lands
    -- while the route was cutting derivatives still stops the listing. (Before 186 there is nothing to ask.)
    IF to_regclass('public.listing_consents') IS NOT NULL THEN
      IF EXISTS (SELECT 1 FROM public.listing_consents lc WHERE lc.release_id = p_release AND lc.state = 'no') THEN
        RETURN jsonb_build_object('error', 'consent');
      END IF;
    END IF;
    IF to_regclass('public.store_listing_vetoes') IS NOT NULL THEN
      IF EXISTS (SELECT 1 FROM public.store_listing_vetoes v WHERE v.release_id = p_release) THEN
        RETURN jsonb_build_object('error', 'consent');
      END IF;
    END IF;
    UPDATE public.releases
       SET store_listed = true,
           store_listed_at = coalesce(store_listed_at, now()),
           store_playback = coalesce(p_playback, store_playback)
     WHERE id = p_release
     RETURNING * INTO v_rel;
    INSERT INTO public.activity_events (org_id, actor_id, verb, subject_type, subject_id, artist_id, project_id, release_id, payload, audit, visibility)
    VALUES (p_org, p_actor, 'release.store_listed', 'release', p_release,
            NULLIF(p_ctx->>'artist_id', '')::uuid, NULLIF(p_ctx->>'project_id', '')::uuid, p_release,
            p_payload, true, 'artist');
  ELSE
    IF NOT v_rel.store_listed THEN
      RETURN jsonb_build_object('error', 'not_listed');
    END IF;
    UPDATE public.releases
       SET store_listed = false, store_listed_at = NULL, store_playback = 'preview'
     WHERE id = p_release
     RETURNING * INTO v_rel;
    INSERT INTO public.activity_events (org_id, actor_id, verb, subject_type, subject_id, artist_id, project_id, release_id, payload, audit, visibility)
    VALUES (p_org, p_actor, 'release.store_unlisted', 'release', p_release,
            NULLIF(p_ctx->>'artist_id', '')::uuid, NULLIF(p_ctx->>'project_id', '')::uuid, p_release,
            p_payload, true, 'artist');
  END IF;

  RETURN jsonb_build_object('release', to_jsonb(v_rel));
END;
$fn$;

ALTER FUNCTION public.labelos_audit_release_store(uuid, uuid, uuid, boolean, text, jsonb, jsonb, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_audit_release_store(uuid, uuid, uuid, boolean, text, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_audit_release_store(uuid, uuid, uuid, boolean, text, jsonb, jsonb, jsonb) TO service_role;

-- ── 3. import ────────────────────────────────────────────────────────────
-- p_row: title, contact_id, project_id (null = make the release's project and link the artist),
--        type, upc, label_name, c_line, p_line, primary_genre, target_date, release_date,
--        artwork_asset_id, delivered_at, created_by, distributor, territories[], language.
-- Answers {"release": <row>, "project_id", "created_project"} or {"error": "not_found"}.

CREATE OR REPLACE FUNCTION public.labelos_audit_release_import(
  p_org uuid,
  p_actor uuid,
  p_row jsonb,
  p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_project uuid := NULLIF(p_row->>'project_id', '')::uuid;
  v_contact uuid := NULLIF(p_row->>'contact_id', '')::uuid;
  v_created boolean := false;
  v_rel     public.releases%ROWTYPE;
BEGIN
  PERFORM public.labelos_approval_check_payload(p_payload);
  IF p_row IS NULL OR jsonb_typeof(p_row) <> 'object' OR v_contact IS NULL THEN
    RAISE EXCEPTION 'an import needs its row and artist' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = p_org AND o.deleted_at IS NULL)
     OR NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = v_contact AND c.org_id = p_org) THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  IF v_project IS NULL THEN
    -- Org rows have no owner (142 / 144): no producer route can reach them.
    INSERT INTO public.projects (user_id, org_id, name) VALUES (NULL, p_org, p_row->>'title') RETURNING id INTO v_project;
    INSERT INTO public.project_contacts (user_id, project_id, contact_id, role) VALUES (NULL, v_project, v_contact, 'artist');
    v_created := true;
  END IF;

  INSERT INTO public.releases (
    org_id, project_id, contact_id, title, type, upc, label_name, c_line, p_line, primary_genre,
    target_date, release_date, artwork_asset_id, state, delivered_at, delivered_to, imported_released,
    created_by, distributor, territories, language
  ) VALUES (
    p_org, v_project, v_contact, p_row->>'title', coalesce(NULLIF(p_row->>'type', ''), 'single'),
    NULLIF(p_row->>'upc', ''), NULLIF(p_row->>'label_name', ''), NULLIF(p_row->>'c_line', ''), NULLIF(p_row->>'p_line', ''),
    NULLIF(p_row->>'primary_genre', ''), NULLIF(p_row->>'target_date', '')::date, NULLIF(p_row->>'release_date', '')::date,
    NULLIF(p_row->>'artwork_asset_id', '')::uuid, 'delivered', (p_row->>'delivered_at')::timestamptz,
    'Imported (already released)', true, NULLIF(p_row->>'created_by', '')::uuid,
    NULLIF(p_row->>'distributor', ''),
    CASE WHEN jsonb_typeof(p_row->'territories') = 'array' THEN ARRAY(SELECT jsonb_array_elements_text(p_row->'territories')) END,
    NULLIF(p_row->>'language', '')
  ) RETURNING * INTO v_rel;

  IF v_created THEN
    INSERT INTO public.activity_events (org_id, actor_id, verb, subject_type, subject_id, artist_id, project_id, payload, audit, visibility)
    VALUES (p_org, p_actor, 'project.created', 'project', v_project, v_contact, v_project, jsonb_build_object('for', 'release'), false, 'artist');
  END IF;
  INSERT INTO public.activity_events (org_id, actor_id, verb, subject_type, subject_id, artist_id, project_id, release_id, payload, audit, visibility)
  VALUES (p_org, p_actor, 'release.created', 'release', v_rel.id, v_contact, v_project, v_rel.id, jsonb_build_object('type', v_rel.type), false, 'artist');
  INSERT INTO public.activity_events (org_id, actor_id, verb, subject_type, subject_id, artist_id, project_id, release_id, payload, audit, visibility)
  VALUES (p_org, p_actor, 'release.imported', 'release', v_rel.id, v_contact, v_project, v_rel.id, p_payload, true, 'internal');

  RETURN jsonb_build_object('release', to_jsonb(v_rel), 'project_id', v_project, 'created_project', v_created);
END;
$fn$;

ALTER FUNCTION public.labelos_audit_release_import(uuid, uuid, jsonb, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_audit_release_import(uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_audit_release_import(uuid, uuid, jsonb, jsonb) TO service_role;

-- ── 4. org delete / restore / export ─────────────────────────────────────

-- Start the grace period. Owner of a live, non-producer org; answers
-- {"deleted_at": <ts>} or {"error": "not_found" | "not_owner" | "producer_org"}.
CREATE OR REPLACE FUNCTION public.labelos_audit_org_delete(
  p_org uuid,
  p_actor uuid,
  p_deleted_at timestamptz,
  p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_kind text;
BEGIN
  PERFORM public.labelos_approval_check_payload(p_payload);
  SELECT o.kind INTO v_kind FROM public.organizations o WHERE o.id = p_org AND o.deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF p_actor IS NULL OR NOT EXISTS (SELECT 1 FROM public.org_members m WHERE m.org_id = p_org AND m.user_id = p_actor AND m.role = 'owner') THEN
    RETURN jsonb_build_object('error', 'not_owner');
  END IF;
  IF v_kind = 'producer' THEN
    RETURN jsonb_build_object('error', 'producer_org');
  END IF;
  UPDATE public.organizations SET deleted_at = p_deleted_at WHERE id = p_org;
  PERFORM public.labelos_audit_insert(p_org, p_actor, 'org.deletion_scheduled', 'org', p_org, p_payload);
  RETURN jsonb_build_object('deleted_at', p_deleted_at);
END;
$fn$;

ALTER FUNCTION public.labelos_audit_org_delete(uuid, uuid, timestamptz, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_audit_org_delete(uuid, uuid, timestamptz, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_audit_org_delete(uuid, uuid, timestamptz, jsonb) TO service_role;

-- Restore inside the grace period (30 days, GRACE_DAYS). Answers {"restored": true} or
-- {"error": "not_found" | "not_owner" | "not_deleted" | "changed" | "expired"}.
CREATE OR REPLACE FUNCTION public.labelos_audit_org_restore(
  p_org uuid,
  p_actor uuid,
  p_expect_deleted_at timestamptz,
  p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_deleted timestamptz;
BEGIN
  PERFORM public.labelos_approval_check_payload(p_payload);
  SELECT o.deleted_at INTO v_deleted FROM public.organizations o WHERE o.id = p_org FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF p_actor IS NULL OR NOT EXISTS (SELECT 1 FROM public.org_members m WHERE m.org_id = p_org AND m.user_id = p_actor AND m.role = 'owner') THEN
    RETURN jsonb_build_object('error', 'not_owner');
  END IF;
  IF v_deleted IS NULL THEN
    RETURN jsonb_build_object('error', 'not_deleted');
  END IF;
  IF v_deleted IS DISTINCT FROM p_expect_deleted_at THEN
    RETURN jsonb_build_object('error', 'changed');
  END IF;
  -- The purge removes the files before the row: past the boundary a restore must not succeed.
  IF v_deleted <= now() - interval '30 days' THEN
    RETURN jsonb_build_object('error', 'expired');
  END IF;
  UPDATE public.organizations SET deleted_at = NULL WHERE id = p_org;
  PERFORM public.labelos_audit_insert(p_org, p_actor, 'org.restored', 'org', p_org, p_payload);
  RETURN jsonb_build_object('restored', true);
END;
$fn$;

ALTER FUNCTION public.labelos_audit_org_restore(uuid, uuid, timestamptz, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_audit_org_restore(uuid, uuid, timestamptz, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_audit_org_restore(uuid, uuid, timestamptz, jsonb) TO service_role;

-- The export's event, written before any data leaves: owner of a live org.
CREATE OR REPLACE FUNCTION public.labelos_audit_org_export(
  p_org uuid,
  p_actor uuid,
  p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  PERFORM public.labelos_approval_check_payload(p_payload);
  IF NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = p_org AND o.deleted_at IS NULL) THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF p_actor IS NULL OR NOT EXISTS (SELECT 1 FROM public.org_members m WHERE m.org_id = p_org AND m.user_id = p_actor AND m.role = 'owner') THEN
    RETURN jsonb_build_object('error', 'not_owner');
  END IF;
  PERFORM public.labelos_audit_insert(p_org, p_actor, 'org.exported', 'org', p_org, p_payload);
  RETURN jsonb_build_object('recorded', true);
END;
$fn$;

ALTER FUNCTION public.labelos_audit_org_export(uuid, uuid, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_audit_org_export(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_audit_org_export(uuid, uuid, jsonb) TO service_role;

-- ── 5. digest channel ────────────────────────────────────────────────────

-- p_cipher is the AES-256-GCM ciphertext (lib/labelos/webhook-secret); the function never sees the URL.
CREATE OR REPLACE FUNCTION public.labelos_audit_digest_channel_set(
  p_org uuid,
  p_actor uuid,
  p_cipher text,
  p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_prev text;
  v_had  boolean;
BEGIN
  PERFORM public.labelos_approval_check_payload(p_payload);
  IF p_cipher IS NULL OR btrim(p_cipher) = '' THEN
    RAISE EXCEPTION 'a webhook cipher is required' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = p_org AND o.deleted_at IS NULL) THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  SELECT c.slack_webhook_cipher INTO v_prev FROM public.org_digest_channels c WHERE c.org_id = p_org FOR UPDATE;
  v_had := FOUND;
  IF v_had THEN
    UPDATE public.org_digest_channels SET slack_webhook_cipher = p_cipher, configured_by = p_actor, updated_at = now() WHERE org_id = p_org;
  ELSE
    INSERT INTO public.org_digest_channels (org_id, slack_webhook_cipher, configured_by) VALUES (p_org, p_cipher, p_actor);
  END IF;
  PERFORM public.labelos_audit_insert(p_org, p_actor, 'digest.channel_set', 'org', p_org,
    p_payload || jsonb_build_object('replaced', v_prev IS NOT NULL));
  RETURN jsonb_build_object('configured', true, 'replaced', v_prev IS NOT NULL);
END;
$fn$;

ALTER FUNCTION public.labelos_audit_digest_channel_set(uuid, uuid, text, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_audit_digest_channel_set(uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_audit_digest_channel_set(uuid, uuid, text, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.labelos_audit_digest_channel_remove(
  p_org uuid,
  p_actor uuid,
  p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_prev text;
BEGIN
  PERFORM public.labelos_approval_check_payload(p_payload);
  SELECT c.slack_webhook_cipher INTO v_prev FROM public.org_digest_channels c WHERE c.org_id = p_org FOR UPDATE;
  -- Nothing stored: idempotent, and no event for a no-op.
  IF NOT FOUND OR v_prev IS NULL THEN
    RETURN jsonb_build_object('configured', false, 'changed', false);
  END IF;
  UPDATE public.org_digest_channels SET slack_webhook_cipher = NULL, updated_at = now() WHERE org_id = p_org;
  PERFORM public.labelos_audit_insert(p_org, p_actor, 'digest.channel_removed', 'org', p_org, p_payload);
  RETURN jsonb_build_object('configured', false, 'changed', true);
END;
$fn$;

ALTER FUNCTION public.labelos_audit_digest_channel_remove(uuid, uuid, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_audit_digest_channel_remove(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_audit_digest_channel_remove(uuid, uuid, jsonb) TO service_role;

-- ── 6. approval decide: the plan's facts re-checked under the lock ────────

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
  ORDER BY a.created_at DESC LIMIT 1;
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

-- ── 7. settings: the audit payload's `from` read under the row lock ──────
-- A NEW name, not a replacement: 192 (which comes after 187) redefines labelos_audit_org_settings, and
-- would silently undo this. The route calls this one first and falls back to the other. It uses 192's
-- shared validator, so 192 must be applied too (it always is when 187 is).

CREATE OR REPLACE FUNCTION public.labelos_audit_org_settings_atomic(
  p_org uuid,
  p_actor uuid,
  p_patch jsonb,
  p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_settings jsonb;
  v_payload  jsonb := p_payload;
  v_changes  jsonb;
  v_key      text;
BEGIN
  PERFORM public.labelos_validate_org_settings_patch(p_patch);
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'audit payload must be an object' USING ERRCODE = '22023';
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

  -- 187: `from` is what the row holds NOW, under the lock (a key never saved keeps the route's default).
  IF jsonb_typeof(p_payload->'changes') = 'object' THEN
    v_changes := p_payload->'changes';
    FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
      IF jsonb_typeof(v_changes->v_key) = 'object' THEN
        v_changes := jsonb_set(v_changes, ARRAY[v_key], (v_changes->v_key) || jsonb_build_object(
          'from', coalesce(v_settings->v_key, v_changes->v_key->'from'),
          'to', p_patch->v_key));
      END IF;
    END LOOP;
    v_payload := jsonb_set(p_payload, '{changes}', v_changes);
  END IF;

  v_settings := coalesce(v_settings, '{}'::jsonb) || p_patch;
  UPDATE public.organizations SET settings = v_settings WHERE id = p_org;

  PERFORM public.labelos_audit_insert(p_org, p_actor, 'org.settings_changed', 'org', p_org, v_payload);

  RETURN jsonb_build_object('settings', v_settings);
END;
$fn$;

ALTER FUNCTION public.labelos_audit_org_settings_atomic(uuid, uuid, jsonb, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_audit_org_settings_atomic(uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_audit_org_settings_atomic(uuid, uuid, jsonb, jsonb) TO service_role;

-- ── 8. has_org_cap: departments_off subtracted (171's function plus one step) ──

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
    'members.manage', 'org.manage', 'finance.read', 'business.read.internal',
    'finance.write', 'finance.approve', 'pr.read', 'pr.write', 'exec.read',
    'creative.read', 'creative.approve', 'contracts.write', 'contracts.sign'
  ];
  org_kinds constant text[] := ARRAY['artist', 'producer', 'label'];
  roles_by_org_kind constant text[] := ARRAY[
    ['artist', 'owner'], ['artist', 'admin'], ['artist', 'member'],
    ['producer', 'owner'], ['producer', 'admin'], ['producer', 'member'],
    ['label', 'owner'], ['label', 'admin'], ['label', 'member'], ['label', 'artist']
  ];
  functions_by_org_kind constant text[] := ARRAY[
    ['artist', 'artist_manager'], ['artist', 'producer'],
    ['artist', 'engineer'], ['artist', 'marketing'], ['artist', 'legal'],
    ['artist', 'operations'], ['artist', 'finance'], ['artist', 'pr'],
    ['artist', 'contracts'], ['producer', 'producer'],
    ['producer', 'engineer'], ['producer', 'artist_manager'],
    ['producer', 'operations'], ['label', 'a_and_r'],
    ['label', 'project_manager'], ['label', 'marketing'], ['label', 'legal'],
    ['label', 'finance'], ['label', 'artist_manager'], ['label', 'producer'],
    ['label', 'engineer'], ['label', 'operations'], ['label', 'pr'],
    ['label', 'executive'], ['label', 'artistic_director'],
    ['label', 'contracts']
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
    ['a_and_r', 'tasks.write'], ['project_manager', 'catalog.write'],
    ['project_manager', 'audio.finished'],
    ['project_manager', 'audio.working'], ['project_manager', 'review.write'],
    ['project_manager', 'rights.read'], ['project_manager', 'release.write'],
    ['project_manager', 'release.approve.metadata'],
    ['project_manager', 'share.external'],
    ['project_manager', 'business.read.internal'],
    ['project_manager', 'tasks.write'], ['marketing', 'catalog.read'],
    ['marketing', 'audio.finished'], ['marketing', 'release.approve.artwork'],
    ['marketing', 'release.approve.marketing'],
    ['marketing', 'business.read.internal'], ['marketing', 'tasks.write'],
    ['legal', 'catalog.read'], ['legal', 'audio.finished'],
    ['legal', 'rights.write'], ['legal', 'contracts.read'],
    ['legal', 'contracts.write'], ['legal', 'release.approve.legal'],
    ['legal', 'business.read.internal'], ['legal', 'tasks.write'],
    ['artist_manager', 'catalog.write'], ['artist_manager', 'audio.finished'],
    ['artist_manager', 'audio.working'], ['artist_manager', 'review.write'],
    ['artist_manager', 'rights.read'], ['artist_manager', 'tasks.write'],
    ['producer', 'catalog.write'], ['producer', 'audio.finished'],
    ['producer', 'audio.working'], ['producer', 'rights.read.own_line'],
    ['producer', 'tasks.write'], ['engineer', 'catalog.write'],
    ['engineer', 'audio.finished'], ['engineer', 'audio.working'],
    ['engineer', 'rights.read.own_line'], ['engineer', 'tasks.write'],
    ['finance', 'catalog.read'], ['finance', 'finance.write'],
    ['finance', 'business.read.internal'], ['finance', 'tasks.write'],
    ['pr', 'catalog.read'], ['pr', 'audio.finished'], ['pr', 'pr.write'],
    ['pr', 'business.read.internal'], ['pr', 'tasks.write'],
    ['executive', 'catalog.read'], ['executive', 'audio.finished'],
    ['executive', 'exec.read'], ['executive', 'rights.read'],
    ['executive', 'contracts.read'], ['executive', 'finance.read'],
    ['executive', 'pr.read'], ['executive', 'creative.read'],
    ['executive', 'business.read.internal'],
    ['artistic_director', 'catalog.write'],
    ['artistic_director', 'audio.finished'],
    ['artistic_director', 'audio.working'],
    ['artistic_director', 'review.write'],
    ['artistic_director', 'creative.approve'],
    ['artistic_director', 'tasks.write'], ['contracts', 'catalog.read'],
    ['contracts', 'rights.read'], ['contracts', 'contracts.write'],
    ['contracts', 'business.read.internal'], ['contracts', 'tasks.write']
  ];
  -- IMPLIES: [wider, narrower].
  implies constant text[] := ARRAY[
    ['catalog.write', 'catalog.read'], ['audio.finished', 'catalog.read'],
    ['audio.working', 'catalog.read'], ['review.comment', 'catalog.read'],
    ['rights.read.own_line', 'catalog.read'],
    ['contracts.read', 'catalog.read'], ['release.write', 'catalog.read'],
    ['release.approve.master', 'catalog.read'],
    ['release.approve.artwork', 'catalog.read'],
    ['release.approve.legal', 'catalog.read'],
    ['release.approve.marketing', 'catalog.read'],
    ['release.approve.metadata', 'catalog.read'],
    ['tasks.write', 'catalog.read'], ['share.external', 'catalog.read'],
    ['business.read.internal', 'catalog.read'],
    ['rights.write', 'rights.read'], ['rights.read', 'rights.read.own_line'],
    ['review.write', 'review.comment'], ['finance.read', 'catalog.read'],
    ['finance.write', 'finance.read'], ['finance.approve', 'finance.read'],
    ['pr.read', 'catalog.read'], ['pr.write', 'pr.read'],
    ['exec.read', 'catalog.read'], ['creative.read', 'catalog.read'],
    ['creative.approve', 'creative.read'],
    ['contracts.write', 'contracts.read'],
    ['contracts.sign', 'contracts.read']
  ];
  never_grantable constant text[] := ARRAY[
    ['member', 'members.manage'], ['member', 'org.manage'],
    ['artist', 'members.manage'], ['artist', 'org.manage'],
    ['artist', 'business.read.internal'], ['artist', 'contracts.read'],
    ['artist', 'contracts.write'], ['artist', 'contracts.sign'],
    ['artist', 'finance.read'], ['artist', 'finance.write'],
    ['artist', 'finance.approve'], ['artist', 'pr.read'],
    ['artist', 'pr.write'], ['artist', 'exec.read'],
    ['artist', 'creative.read'], ['artist', 'creative.approve']
  ];
  -- ENTITLEMENTS (170, LABEL-47; department capabilities added by 171,
  -- LABEL-49): src/lib/labelos/entitlements.ts + account.ts.
  -- CAPABILITY_MODULE: [capability, module]. A capability a module owns needs
  -- the module; every other capability is core and needs nothing.
  capability_modules constant text[] := ARRAY[
    ['contracts.read', 'contracts'], ['contracts.write', 'contracts'],
    ['contracts.sign', 'contracts'], ['finance.read', 'finance'],
    ['finance.write', 'finance'], ['finance.approve', 'finance'],
    ['pr.read', 'pr'], ['pr.write', 'pr'], ['exec.read', 'executive'],
    ['creative.read', 'artistic'], ['creative.approve', 'artistic']
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
  v_settings  jsonb;
BEGIN
  IF p_org IS NULL OR p_cap IS NULL OR NOT (p_cap = ANY (all_capabilities)) THEN
    RETURN false;
  END IF;

  SELECT o.kind, om.role, om.functions, om.cap_grants, om.cap_revokes, o.settings
    INTO v_kind, v_role, v_functions, v_grants, v_revokes, v_settings
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
  -- 187 (LABEL-73): the owner switched this department off (settings.departments_off). Like TS
  --    effectiveModules, it only narrows what the licence grants.
  IF jsonb_typeof(v_settings->'departments_off') = 'array' AND (v_settings->'departments_off') ? v_module THEN
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

-- ── 9. caps decided in SQL ───────────────────────────────────────────────
-- The artist cap: would one more roster artist (an artist role, main or extra,
-- 166's labelos_is_artist_category) pass max_artists? Takes the entitlement
-- row's FOR UPDATE lock, so two writes at cap-1 queue and the second sees the
-- first. p_exclude is the contact being written (an edit of an artist is not
-- one more).

CREATE OR REPLACE FUNCTION public.labelos_artist_cap_ok(p_org uuid, p_exclude uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_max int;
BEGIN
  SELECT e.max_artists INTO v_max FROM public.org_entitlements e WHERE e.org_id = p_org FOR UPDATE;
  IF NOT FOUND OR v_max IS NULL THEN
    RETURN true;
  END IF;
  RETURN (
    SELECT count(*) FROM public.contacts c
    WHERE c.org_id = p_org AND c.id IS DISTINCT FROM p_exclude
      AND (public.labelos_is_artist_category(c.category) OR public.labelos_is_artist_category(c.secondary_category))
  ) < v_max;
END;
$fn$;

ALTER FUNCTION public.labelos_artist_cap_ok(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_artist_cap_ok(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.contacts_artist_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NEW.org_id IS NULL
     OR NOT (public.labelos_is_artist_category(NEW.category) OR public.labelos_is_artist_category(NEW.secondary_category)) THEN
    RETURN NEW;
  END IF;
  -- Already a roster artist of this org: not one more.
  IF TG_OP = 'UPDATE' AND OLD.org_id IS NOT DISTINCT FROM NEW.org_id
     AND (public.labelos_is_artist_category(OLD.category) OR public.labelos_is_artist_category(OLD.secondary_category)) THEN
    RETURN NEW;
  END IF;
  IF NOT public.labelos_artist_cap_ok(NEW.org_id, NEW.id) THEN
    RAISE EXCEPTION 'artist_limit: this organization has reached the number of artists its licence includes' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$fn$;

ALTER FUNCTION public.contacts_artist_cap() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.contacts_artist_cap() FROM PUBLIC;

DROP TRIGGER IF EXISTS contacts_artist_cap ON public.contacts;
CREATE TRIGGER contacts_artist_cap
  BEFORE INSERT OR UPDATE OF org_id, category, secondary_category ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.contacts_artist_cap();


-- member update: 167's function plus the seat cap

CREATE OR REPLACE FUNCTION public.labelos_audit_member_update(
  p_org uuid,
  p_actor uuid,
  p_user uuid,
  p_patch jsonb,
  p_verb text,
  p_payload jsonb,
  p_expect jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_row     public.org_members%ROWTYPE;
  v_now     jsonb;
  v_key     text;
  v_cleared uuid[] := '{}';
  v_payload jsonb := p_payload;
  v_max_seats int;
BEGIN
  IF p_verb NOT IN ('member.role_changed', 'member.capabilities_changed', 'member.scope_changed') THEN
    RAISE EXCEPTION 'unknown member verb %', p_verb USING ERRCODE = '22023';
  END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' OR p_patch = '{}'::jsonb THEN
    RAISE EXCEPTION 'empty member patch' USING ERRCODE = '22023';
  END IF;
  IF p_expect IS NOT NULL AND jsonb_typeof(p_expect) <> 'object' THEN
    RAISE EXCEPTION 'member expectation must be an object' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row FROM public.org_members WHERE org_id = p_org AND user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  -- The plan was made from p_expect; if the row moved since, nothing happens.
  IF p_expect IS NOT NULL THEN
    v_now := jsonb_build_object(
      'role', v_row.role,
      'functions', to_jsonb(v_row.functions),
      'scope', v_row.scope,
      'cap_grants', to_jsonb(v_row.cap_grants),
      'cap_revokes', to_jsonb(v_row.cap_revokes)
    );
    FOR v_key IN SELECT jsonb_object_keys(p_expect) LOOP
      IF NOT (v_now ? v_key) THEN
        RAISE EXCEPTION 'unknown member expectation key %', v_key USING ERRCODE = '22023';
      END IF;
      IF v_now->v_key IS DISTINCT FROM p_expect->v_key THEN
        RETURN jsonb_build_object('error', 'changed');
      END IF;
    END LOOP;
  END IF;

  -- 187: the seat cap, decided here under the entitlement row's lock. A roster artist made staff takes
  -- a seat it did not hold; two such changes at cap-1 queue on the lock and the second is refused.
  IF v_row.role = 'artist' AND COALESCE(p_patch->>'role', v_row.role) <> 'artist' THEN
    SELECT e.max_seats INTO v_max_seats FROM public.org_entitlements e WHERE e.org_id = p_org FOR UPDATE;
    IF FOUND AND v_max_seats IS NOT NULL
       AND (SELECT count(*) FROM public.org_members x WHERE x.org_id = p_org AND x.role <> 'artist') >= v_max_seats THEN
      RETURN jsonb_build_object('error', 'seat_limit');
    END IF;
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

ALTER FUNCTION public.labelos_audit_member_update(uuid, uuid, uuid, jsonb, text, jsonb, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_audit_member_update(uuid, uuid, uuid, jsonb, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_audit_member_update(uuid, uuid, uuid, jsonb, text, jsonb, jsonb) TO service_role;

-- connection accept: 154's function plus the artist cap

CREATE OR REPLACE FUNCTION public.labelos_audit_connection_accept(
  p_org uuid,
  p_actor uuid,
  p_connection uuid,
  p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_conn    public.org_connections%ROWTYPE;
  v_contact uuid;
  v_name    text;
BEGIN
  SELECT * INTO v_conn FROM public.org_connections WHERE id = p_connection FOR UPDATE;
  IF NOT FOUND OR v_conn.status <> 'requested' THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  -- The accepting org is a party and is NOT the one that asked.
  IF NOT (
    (v_conn.initiated_by = 'label' AND p_org = v_conn.artist_org_id)
    OR (v_conn.initiated_by = 'artist' AND p_org = v_conn.label_org_id)
  ) THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = v_conn.label_org_id AND o.deleted_at IS NULL)
     OR NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = v_conn.artist_org_id AND o.deleted_at IS NULL) THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  v_contact := v_conn.label_contact_id;
  IF v_contact IS NULL THEN
    -- 187: the label's roster grows by one artist; the licence's artist cap is decided here.
    IF NOT public.labelos_artist_cap_ok(v_conn.label_org_id, NULL) THEN
      RETURN jsonb_build_object('error', 'artist_limit');
    END IF;
    SELECT o.name INTO v_name FROM public.organizations o WHERE o.id = v_conn.artist_org_id;
    INSERT INTO public.contacts (org_id, user_id, name, category)
    VALUES (v_conn.label_org_id, NULL, v_name, 'artist')
    RETURNING id INTO v_contact;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.contacts c
    WHERE c.id = v_contact AND c.artist_org_id IS NOT NULL AND c.artist_org_id <> v_conn.artist_org_id
  ) OR EXISTS (
    SELECT 1 FROM public.contacts c
    WHERE c.org_id = v_conn.label_org_id AND c.artist_org_id = v_conn.artist_org_id AND c.id <> v_contact
  ) THEN
    RETURN jsonb_build_object('error', 'contact_taken');
  END IF;

  UPDATE public.org_connections
  SET status = 'active', accepted_by = p_actor, accepted_at = now(), label_contact_id = v_contact
  WHERE id = v_conn.id;
  UPDATE public.contacts SET artist_org_id = v_conn.artist_org_id WHERE id = v_contact;

  PERFORM public.labelos_audit_insert(v_conn.label_org_id, p_actor, 'connection.accepted', 'connection', v_conn.id,
    public.labelos_connection_payload(v_conn.id, COALESCE(p_payload, '{}'::jsonb)));
  PERFORM public.labelos_audit_insert(v_conn.artist_org_id, p_actor, 'connection.accepted', 'connection', v_conn.id,
    public.labelos_connection_payload(v_conn.id, COALESCE(p_payload, '{}'::jsonb)));

  RETURN jsonb_build_object('connection', public.labelos_connection_json(v_conn.id));
END;
$fn$;

ALTER FUNCTION public.labelos_audit_connection_accept(uuid, uuid, uuid, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_audit_connection_accept(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_audit_connection_accept(uuid, uuid, uuid, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
