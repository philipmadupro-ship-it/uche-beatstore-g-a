-- Rollback for 167_labelos_release_items_lock_member_cas.sql (LABEL-44).
--
-- Lives outside supabase/migrations/ on purpose: scripts/apply-migrations.sh
-- applies every *.sql in that folder. Run by hand only.
--
-- Puts back, word for word:
--   1. 158's release_items_store_lock: only a LISTED release's tracklist is
--      held; an item add can again land on a delivered or cancelled release
--      after the route checked it was a draft (tracklistLocked still refuses
--      what it reads).
--   2. 146's six-argument labelos_audit_member_update, with no p_expect: a
--      stale plan overwrites a concurrent member change again. The members
--      route sends p_expect, so roll the route back with it (PostgREST finds
--      no seven-argument function and the route answers 503 "not set up").

CREATE OR REPLACE FUNCTION public.release_items_store_lock()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_release uuid := COALESCE(NEW.release_id, OLD.release_id);
BEGIN
  -- The organization's own purge deletes its items by cascade, possibly before its releases: a release
  -- whose organization is already gone holds nothing.
  IF EXISTS (
    SELECT 1 FROM public.releases r
    JOIN public.organizations o ON o.id = r.org_id
    WHERE r.id = v_release AND r.store_listed
  ) THEN
    RAISE EXCEPTION 'release_items: take the release off the store to change its tracklist' USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

ALTER FUNCTION public.release_items_store_lock() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.release_items_store_lock() FROM PUBLIC;

DROP TRIGGER IF EXISTS release_items_store_lock ON public.release_items;
CREATE TRIGGER release_items_store_lock BEFORE INSERT OR UPDATE OR DELETE ON public.release_items
  FOR EACH ROW EXECUTE FUNCTION public.release_items_store_lock();

DROP FUNCTION IF EXISTS public.labelos_audit_member_update(uuid, uuid, uuid, jsonb, text, jsonb, jsonb);

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

NOTIFY pgrst, 'reload schema';
