-- 137_labelos_producer_org.sql
-- Label OS (LABEL-07): a personal `producer` org for the existing producer.
--
-- LABEL OS — NOT APPLIED. Apply at the final merge of the Label OS branch
-- into main, after 136 (docs/bstudio-label-os/16-execution-runbook.md).
--
-- Data only (11-migration-strategy.md M2). Every creator_profiles owner — the
-- producer, never a buyer (buyers have no creator_profiles row) — gets one
-- `organizations` row (kind `producer`, name = display_name or "My studio")
-- and an `owner` row in `org_members`. No org_id is written to any existing
-- table: backfilling tracks / projects / contacts is M7, out of scope.
--
-- One function does it, for both callers:
--   - this migration, once per existing creator_profiles row (below);
--   - POST /api/profile, through `ensurePersonalOrg`
--     (src/lib/labelos/personal-org.ts), so a producer created later gets
--     one too.
-- It is idempotent and safe under concurrency: a transaction-scoped advisory
-- lock per user serialises two simultaneous calls, and the second sees the
-- first one's org and creates nothing. "Already has an org" means OWNS or
-- CREATED any producer-kind org (created: an ownership transfer must not
-- trigger a second org; soft-deleted included: an org in its 30-day grace
-- period is not replaced behind the producer's back).
--
-- The function runs as postgres (the owner of 136's tables), so 136's
-- column-level grants and the absence of an org_members INSERT policy do not
-- apply to it. Only service_role may execute it; a signed-in user cannot
-- call it through PostgREST. 136's "≥1 owner" trigger fires on UPDATE and
-- DELETE only, so the inserts here never trip it.
--
-- Idempotent: CREATE OR REPLACE; the backfill skips producers that already
-- own a producer org, so a replay inserts nothing.

-- ── labelos_slugify(text) ───────────────────────────────────────────────
-- Lower-case ASCII words joined by single dashes, at most 40 characters,
-- matching organizations.slug's CHECK. Empty when nothing usable is left
-- (e.g. a name written only in non-Latin script); the caller falls back.

CREATE OR REPLACE FUNCTION public.labelos_slugify(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT btrim(
    left(
      btrim(regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', '-', 'g'), '-'),
      40
    ),
    '-'
  );
$$;

-- ── labelos_ensure_producer_org(user) ───────────────────────────────────
-- Returns jsonb:
--   {"org_id": "<uuid>", "created": true|false}   the producer's org
--   {"skipped": "not_producer"}                    no creator_profiles row

CREATE OR REPLACE FUNCTION public.labelos_ensure_producer_org(p_user uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_profile_slug text;
  v_display_name text;
  v_org          uuid;
  v_name         text;
  v_base         text;
  v_slug         text;
  v_try          int := 1;
BEGIN
  IF p_user IS NULL THEN
    RETURN jsonb_build_object('skipped', 'not_producer');
  END IF;

  -- Serialise per user. Two concurrent profile saves (or a save racing this
  -- migration) queue here; the second then sees the first one's org below,
  -- since each statement in a READ COMMITTED plpgsql function takes a new
  -- snapshot.
  PERFORM pg_advisory_xact_lock(hashtextextended('labelos.producer_org:' || p_user::text, 0));

  SELECT cp.slug, cp.display_name
    INTO v_profile_slug, v_display_name
  FROM public.creator_profiles cp
  WHERE cp.user_id = p_user;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('skipped', 'not_producer');
  END IF;

  -- Owns a producer org, or created one: a producer who transferred their
  -- org's ownership (136 allows it) must not get a second org on the next
  -- profile save.
  SELECT o.id INTO v_org
  FROM public.organizations o
  WHERE o.kind = 'producer'
    AND (
      o.created_by = p_user
      OR EXISTS (
        SELECT 1 FROM public.org_members om
        WHERE om.org_id = o.id AND om.user_id = p_user AND om.role = 'owner'
      )
    )
  ORDER BY (o.deleted_at IS NULL) DESC, o.created_at, o.id
  LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('org_id', v_org, 'created', false);
  END IF;

  v_name := coalesce(nullif(btrim(v_display_name), ''), 'My studio');
  v_base := coalesce(
    nullif(public.labelos_slugify(v_profile_slug), ''),
    nullif(public.labelos_slugify(v_display_name), ''),
    'studio'
  );

  -- organizations.slug is unique across every org. Try the base, then
  -- base-2, base-3 …; catching unique_violation also covers another user's
  -- org claiming the same slug between the check and the insert.
  LOOP
    v_slug := CASE WHEN v_try = 1 THEN v_base ELSE v_base || '-' || v_try END;
    IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE slug = v_slug) THEN
      BEGIN
        INSERT INTO public.organizations (name, slug, kind, created_by)
        VALUES (v_name, v_slug, 'producer', p_user)
        RETURNING id INTO v_org;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        NULL; -- taken meanwhile: next candidate
      END;
    END IF;
    v_try := v_try + 1;
    IF v_try > 1000 THEN
      RAISE EXCEPTION 'no free organization slug for base %', v_base;
    END IF;
  END LOOP;

  INSERT INTO public.org_members (org_id, user_id, role, scope)
  VALUES (v_org, p_user, 'owner', 'org');

  RETURN jsonb_build_object('org_id', v_org, 'created', true);
END;
$fn$;

ALTER FUNCTION public.labelos_slugify(text) OWNER TO postgres;
ALTER FUNCTION public.labelos_ensure_producer_org(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_slugify(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.labelos_ensure_producer_org(uuid) FROM PUBLIC;
-- Supabase grants EXECUTE on new public functions to anon/authenticated by
-- default privileges; take it back explicitly.
REVOKE ALL ON FUNCTION public.labelos_slugify(text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.labelos_ensure_producer_org(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_ensure_producer_org(uuid) TO service_role;

-- ── Backfill ─────────────────────────────────────────────────────────────
-- Every existing producer. A replay finds each one's org and inserts nothing.

DO $$
BEGIN
  PERFORM public.labelos_ensure_producer_org(cp.user_id)
  FROM public.creator_profiles cp
  ORDER BY cp.created_at, cp.user_id;
END $$;

NOTIFY pgrst, 'reload schema';
