-- 167_labelos_release_items_lock_member_cas.sql
-- Label OS (LABEL-44, reviews G4 / G7 / G10): two writes that a stale read
-- could get wrong are held in the database, and every tracklist write takes
-- its locks in one order.
--
-- LABEL OS — NOT APPLIED. Apply at the final merge of the Label OS branch
-- into main, after 136–166. Never part of supabase/apply/pending.sql.
--
-- ── 1. A tracklist changes only while the release is a draft ───────────────
-- `tracklistLocked` (src/app/api/org/[orgId]/releases/access.ts) refuses an
-- item add / edit / reorder / remove on a release that is not a draft, but
-- it judges a row the route read EARLIER. An add that read `draft` could
-- land after `POST …/deliver` claimed the release: a delivered release with
-- a tracklist nobody evaluated (20-review-G7-atomic-deliver.md, point 2).
-- The FK from release_items to releases only takes FOR KEY SHARE, which a
-- state UPDATE does not wait for.
--
-- 158's `release_items_store_lock` is replaced (same name, same trigger) by
-- one that, for every INSERT / UPDATE / DELETE of an item:
--   - takes FOR SHARE on the release row. Delivering is an UPDATE of that
--     row, which FOR SHARE blocks (and which blocks FOR SHARE): an item
--     write and a delivery are serialised. An item write that waited reads
--     the release as the delivery left it and is refused; a delivery that
--     waited goes through after the item write committed.
--   - refuses a listed release (158's rule and message, unchanged);
--   - refuses any release that is not a draft, except one IMPORTED as
--     already out and not on the store (LABEL-42: its tracklist is the very
--     thing being entered). That is `tracklistLocked`, as SQL.
-- What this does NOT close: deliver evaluates readiness BEFORE its claim, so
-- an item that commits between that read and the claim is delivered with
-- the release (the claim waits for it, then goes through). That window is
-- the atomic-deliver function's (20-review-G7-atomic-deliver.md: lock the
-- release and compare a fingerprint under the lock), not this trigger's;
-- the same holds for store listing, which reads the tracklist before it
-- sets store_listed.
--
-- A release (or its organization) being deleted removes its items by
-- cascade; by then the parent row is gone, the lookup finds nothing and the
-- cascade goes through, as in 158.
--
-- Error: check_violation (23514) with a message starting `release_items:`;
-- the routes answer it as a 409 in their own words (access.ts#writeError).
--
-- ── 2. A member change compares what the plan was made from ───────────────
-- `PATCH /api/org/[orgId]/members` reads the member, plans the change with
-- `planMemberChange` (which looks at the whole row), then calls
-- labelos_audit_member_update. A second admin's change landing in between
-- was overwritten by a plan made from the old row (G4). The function gains
-- `p_expect jsonb` — the row as the route read it (role, functions, scope,
-- cap_grants, cap_revokes; lib/labelos/members#memberExpectation) — and,
-- under its row lock, answers {"error": "changed"} and writes nothing (no
-- change, no event) when any key it names differs. A NULL p_expect skips the
-- comparison, so 146's local check (which calls it with six arguments)
-- still runs; the route always sends it.
--
-- The six-argument function is dropped and the seven-argument one created
-- (an overload would make PostgREST's choice ambiguous). EXECUTE stays
-- service_role only.
--
-- ── 3. Every item write locks the release FIRST ───────────────────────────
-- 144's reorder / remove functions (and a release DELETE cascading to its
-- items) take FOR UPDATE on the release and then touch item rows. A plain
-- UPDATE of an item locks the item row before section 1's trigger asks for
-- the release, so `PATCH …/items/[itemId]` racing a reorder took the two
-- locks in the opposite order and could deadlock (40P01). The PATCH now goes
-- through labelos_release_item_update, which locks the release FOR UPDATE
-- before it touches the item — the same order as 144's functions, so the
-- two queue instead. (An INSERT holds no item lock when the trigger runs.)
-- service_role only. Answers the updated row as jsonb, or NULL when the
-- release or the item is not there (the route's 404).
--
-- Rollback: supabase/rollback/167_*.down.sql puts back 158's trigger body
-- and 146's six-argument function, and drops labelos_release_item_update.
--
-- Idempotent: CREATE OR REPLACE, DROP ... IF EXISTS first.

-- ── 1 ────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.release_items_store_lock()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_release  uuid := COALESCE(NEW.release_id, OLD.release_id);
  v_state    text;
  v_imported boolean;
  v_listed   boolean;
BEGIN
  -- The organization's own purge deletes its items by cascade, possibly
  -- before its releases: a release whose organization is already gone holds
  -- nothing. FOR SHARE OF r: the release row only, never the organization.
  SELECT r.state, r.imported_released, r.store_listed
    INTO v_state, v_imported, v_listed
  FROM public.releases r
  JOIN public.organizations o ON o.id = r.org_id
  WHERE r.id = v_release
  FOR SHARE OF r;
  IF NOT FOUND THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF v_listed THEN
    RAISE EXCEPTION 'release_items: take the release off the store to change its tracklist' USING ERRCODE = 'check_violation';
  END IF;
  IF v_state = 'draft' OR (v_imported AND v_state = 'delivered') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'release_items: a % release keeps its tracklist', v_state USING ERRCODE = 'check_violation';
END $$;

ALTER FUNCTION public.release_items_store_lock() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.release_items_store_lock() FROM PUBLIC;

DROP TRIGGER IF EXISTS release_items_store_lock ON public.release_items;
CREATE TRIGGER release_items_store_lock BEFORE INSERT OR UPDATE OR DELETE ON public.release_items
  FOR EACH ROW EXECUTE FUNCTION public.release_items_store_lock();

-- ── 2 ────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.labelos_audit_member_update(uuid, uuid, uuid, jsonb, text, jsonb);

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

-- ── 3 ────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.labelos_release_item_update(p_org uuid, p_release uuid, p_item uuid, p_patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_row public.release_items%ROWTYPE;
  v_key text;
BEGIN
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' OR p_patch = '{}'::jsonb THEN
    RAISE EXCEPTION 'empty item patch' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
    IF v_key NOT IN ('master_track_id', 'version_title', 'explicit') THEN
      RAISE EXCEPTION 'unknown item field %', v_key USING ERRCODE = 'invalid_parameter_value';
    END IF;
  END LOOP;

  -- The release first, as 144's reorder / remove do.
  PERFORM 1 FROM public.releases WHERE id = p_release AND org_id = p_org FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE public.release_items ri
  SET master_track_id = CASE WHEN p_patch ? 'master_track_id' THEN (p_patch->>'master_track_id')::uuid ELSE ri.master_track_id END,
      version_title   = CASE WHEN p_patch ? 'version_title' THEN p_patch->>'version_title' ELSE ri.version_title END,
      explicit        = CASE WHEN p_patch ? 'explicit' THEN (p_patch->>'explicit')::boolean ELSE ri.explicit END
  WHERE ri.id = p_item AND ri.release_id = p_release AND ri.org_id = p_org
  RETURNING ri.* INTO v_row;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  RETURN to_jsonb(v_row);
END;
$$;

ALTER FUNCTION public.labelos_release_item_update(uuid, uuid, uuid, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_release_item_update(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_release_item_update(uuid, uuid, uuid, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
