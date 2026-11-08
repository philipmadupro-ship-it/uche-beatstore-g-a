-- 201_labelos_store_consent_audit.sql
-- Label OS (review G17): the store-consent verbs are audit class and now commit WITH their event.
--
-- `listing.consent_decided`, `listing.vetoed` and `listing.veto_lifted` were written by `recordEvent` AFTER the
-- change, and the change was put back by a second write if the event failed. Migration 187 gave the listing itself
-- (`labelos_audit_release_store`) the atomic treatment but not the consent side doc 26 describes. Two SECURITY
-- DEFINER functions (146's shape, `service_role` EXECUTE only) close that: the change and its `activity_events` row
-- are one transaction, so an event that cannot be written leaves no change behind and there is no put-back to fail.
--
--  1. labelos_audit_consent_decide(p_org, p_actor, p_release, p_artist, p_from, p_to, p_ctx, p_payload, p_unlist_payload)
--     Locks the release row (the same lock `labelos_audit_release_store` takes, so a listing and an answer
--     serialize), then
--       * p_from set: moves the (release, artist) consent row p_from → p_to ('yes' | 'no') by compare-and-set on the
--         state read and writes `listing.consent_decided` (internal). The row moved under us (another tab answered)
--         is { changed: false } and nothing is written.
--       * p_to = 'no': in the same transaction a LISTED release comes off the store (store_listed false,
--         store_listed_at NULL, playback back to preview) with `release.store_unlisted` (artist visibility, as 187).
--       * p_from NULL: "enforce a no that already stands" — requires a `no` row for the artist under the lock ({ error: 'no_row' } otherwise), changes
--         no consent row and writes no consent event, but still takes a still-listed release off the store with its
--         event (a no given a moment ago whose unlisting did not finish).
--     Answers { changed, unlisted } or { error: 'not_found' | 'no_row' }.
--     The route keeps every rule of lib/labelos/store-consent.ts (silence is not a no, one no withdraws, re-listing
--     needs that artist's yes: `labelos_audit_release_store` still refuses while any `no` stands); the function
--     does only what the database can know for itself. Deleting the promoted public previews stays in the route.
--  2. labelos_audit_listing_veto(p_org, p_actor, p_release, p_veto, p_label_payload, p_artist_ctx, p_artist_payload)
--     The store owner's veto on a connected artist's release, kept in the LABEL org's rows. `p_org` is the label.
--     Veto inserts the `store_listing_vetoes` row (a repeat is { changed: false }); lifting deletes it (no row is
--     { changed: false }). Each writes `listing.vetoed` / `listing.veto_lifted` in the label org AND a copy in the
--     artist org's feed in the same transaction. An organization with no ACTIVE connection to the release's
--     organization is { error: 'not_connected' } (186's guard would raise).
--     Answers { changed } or { error: 'not_found' | 'not_connected' }.
--
-- Every payload goes through 157's `labelos_approval_check_payload` (object, no secret-looking key, ≤ 16 KB).
-- Needs 186 (the tables) and 187 / 158 (`releases.store_playback`, the lock order). The routes fall back to their
-- previous path (change, then event, put back on failure) while this migration is missing.
-- Rollback: supabase/rollback/201_labelos_store_consent_audit.down.sql. Idempotent: CREATE OR REPLACE.

-- A GENERIC mover, on purpose: this function does not know who may answer or whether a transition is allowed.
-- The transition rules (`planDecision` in lib/labelos/store-consent.ts: which state may move to which, and that the
-- answering account stands for a credited artist of the release) are enforced by the route before the call. The
-- function only moves the row from `p_from` to `p_to` atomically with its events, and is executable by
-- `service_role` only, so nothing but that route can reach it.
CREATE OR REPLACE FUNCTION public.labelos_audit_consent_decide(
  p_org uuid,
  p_actor uuid,
  p_release uuid,
  p_artist uuid,
  p_from text,
  p_to text,
  p_ctx jsonb,
  p_payload jsonb,
  p_unlist_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_rel public.releases%ROWTYPE;
  v_state text;
  v_changed boolean := false;
  v_unlisted boolean := false;
BEGIN
  PERFORM public.labelos_approval_check_payload(p_payload);
  PERFORM public.labelos_approval_check_payload(p_unlist_payload);
  IF p_to NOT IN ('yes', 'no') THEN
    RAISE EXCEPTION 'unknown consent decision %', p_to USING ERRCODE = '22023';
  END IF;
  IF p_from IS NOT NULL AND p_from NOT IN ('proposed', 'yes', 'no') THEN
    RAISE EXCEPTION 'unknown consent state %', p_from USING ERRCODE = '22023';
  END IF;
  IF p_from IS NULL AND p_to <> 'no' THEN
    RAISE EXCEPTION 'only a no can be enforced without a change' USING ERRCODE = '22023';
  END IF;
  IF p_from IS NOT NULL AND p_from = p_to THEN
    RAISE EXCEPTION 'a consent decision must change the state' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_rel FROM public.releases WHERE id = p_release AND org_id = p_org FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  IF p_from IS NOT NULL THEN
    UPDATE public.listing_consents
       SET state = p_to, decided_by = p_actor, decided_at = now()
     WHERE release_id = p_release AND org_id = p_org AND artist_contact_id = p_artist AND state = p_from
     RETURNING state INTO v_state;
    IF FOUND THEN
      v_changed := true;
      INSERT INTO public.activity_events (org_id, actor_id, verb, subject_type, subject_id, artist_id, project_id, release_id, payload, audit, visibility)
      VALUES (p_org, p_actor, 'listing.consent_decided', 'release', p_release,
              p_artist, NULLIF(p_ctx->>'project_id', '')::uuid, p_release,
              p_payload, true, 'internal');
    END IF;
  ELSE
    SELECT lc.state INTO v_state FROM public.listing_consents lc
     WHERE lc.release_id = p_release AND lc.org_id = p_org AND lc.artist_contact_id = p_artist;
    IF NOT FOUND OR v_state <> 'no' THEN
      RETURN jsonb_build_object('error', 'no_row');
    END IF;
  END IF;

  -- A no (also one that already stood, or one a repeated request enforces) takes a listed release off the store.
  -- Conditional on the row still being a no: a repeat that lost a race to a yes must not unlist.
  IF p_to = 'no' AND v_rel.store_listed AND EXISTS (
       SELECT 1 FROM public.listing_consents lc
        WHERE lc.release_id = p_release AND lc.org_id = p_org AND lc.artist_contact_id = p_artist AND lc.state = 'no') THEN
    UPDATE public.releases
       SET store_listed = false, store_listed_at = NULL, store_playback = 'preview'
     WHERE id = p_release;
    v_unlisted := true;
    INSERT INTO public.activity_events (org_id, actor_id, verb, subject_type, subject_id, artist_id, project_id, release_id, payload, audit, visibility)
    VALUES (p_org, p_actor, 'release.store_unlisted', 'release', p_release,
            NULLIF(p_ctx->>'release_artist_id', '')::uuid, NULLIF(p_ctx->>'project_id', '')::uuid, p_release,
            p_unlist_payload, true, 'artist');
  END IF;

  RETURN jsonb_build_object('changed', v_changed, 'unlisted', v_unlisted);
END;
$fn$;

ALTER FUNCTION public.labelos_audit_consent_decide(uuid, uuid, uuid, uuid, text, text, jsonb, jsonb, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_audit_consent_decide(uuid, uuid, uuid, uuid, text, text, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_audit_consent_decide(uuid, uuid, uuid, uuid, text, text, jsonb, jsonb, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.labelos_audit_listing_veto(
  p_org uuid,
  p_actor uuid,
  p_release uuid,
  p_veto boolean,
  p_label_payload jsonb,
  p_artist_ctx jsonb,
  p_artist_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_rel public.releases%ROWTYPE;
  v_verb text := CASE WHEN p_veto THEN 'listing.vetoed' ELSE 'listing.veto_lifted' END;
BEGIN
  PERFORM public.labelos_approval_check_payload(p_label_payload);
  PERFORM public.labelos_approval_check_payload(p_artist_payload);

  -- Same lock as the listing and the artists' answers, so a veto and a listing serialize.
  SELECT * INTO v_rel FROM public.releases WHERE id = p_release FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.org_connections oc
     WHERE oc.label_org_id = p_org AND oc.artist_org_id = v_rel.org_id AND oc.status = 'active'
  ) THEN
    RETURN jsonb_build_object('error', 'not_connected');
  END IF;

  IF p_veto THEN
    INSERT INTO public.store_listing_vetoes (release_id, org_id, vetoed_by)
    VALUES (p_release, p_org, p_actor)
    ON CONFLICT (release_id) DO NOTHING;
  ELSE
    DELETE FROM public.store_listing_vetoes WHERE release_id = p_release AND org_id = p_org;
  END IF;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('changed', false);
  END IF;

  INSERT INTO public.activity_events (org_id, actor_id, verb, subject_type, subject_id, release_id, payload, audit, visibility)
  VALUES (p_org, p_actor, v_verb, 'release', p_release, p_release, p_label_payload, true, 'internal');
  -- The artist side sees what happened to its release, in its own feed (its context keys, the label's actor).
  INSERT INTO public.activity_events (org_id, actor_id, verb, subject_type, subject_id, artist_id, project_id, release_id, payload, audit, visibility)
  VALUES (v_rel.org_id, p_actor, v_verb, 'release', p_release,
          NULLIF(p_artist_ctx->>'artist_id', '')::uuid, NULLIF(p_artist_ctx->>'project_id', '')::uuid, p_release,
          p_artist_payload, true, 'internal');

  RETURN jsonb_build_object('changed', true);
END;
$fn$;

ALTER FUNCTION public.labelos_audit_listing_veto(uuid, uuid, uuid, boolean, jsonb, jsonb, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_audit_listing_veto(uuid, uuid, uuid, boolean, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_audit_listing_veto(uuid, uuid, uuid, boolean, jsonb, jsonb, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
