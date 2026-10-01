-- 136_labelos_org_core.sql
-- Label OS (LABEL-03): tenant tables and the SQL authorization helpers.
--
-- LABEL OS — NOT APPLIED. Apply at the final merge of the Label OS branch
-- into main (docs/bstudio-label-os/16-execution-runbook.md). Nothing in the
-- producer app, the store or checkout reads these tables.
--
-- Five new tables (organizations, org_members, org_invitations,
-- user_profiles, activity_events) and two helpers (org_role, has_org_cap).
-- No existing table is touched.
--
-- Tenancy here is `org_id`, not `user_id`: every policy keys on the org
-- through a SECURITY DEFINER membership helper, the pattern of
-- `public.is_producer()` in 119. The helpers run as their owner (postgres,
-- which owns these tables), so a policy on org_members that calls them does
-- not recurse into org_members' own RLS.
--
-- Writes are deliberately narrow. Every app write goes through the service
-- role (LABEL-05 onwards). Through RLS:
--   - nobody inserts an org_members row: joining an org happens ONLY through
--     the service-role invitation-accept route (LABEL-08), never by a user
--     inserting themselves;
--   - members.manage (owner/admin) may change a member's role, functions,
--     scope and per-member overrides, and remove members — but only an owner
--     may touch an owner row, since making or unmaking an owner is the
--     owner-only "ownership transfer" (15-product-decisions, LABEL-02
--     follow-up), and the user/org a membership belongs to can never be
--     rewritten (column-level UPDATE grant);
--   - activity_events is append-only: no UPDATE/DELETE policy or grant.
--
-- Idempotent: CREATE ... IF NOT EXISTS, CREATE OR REPLACE, DROP ... IF EXISTS
-- before CREATE POLICY / CREATE CONSTRAINT TRIGGER.

-- ── organizations ────────────────────────────────────────────────────────
-- The tenant. `kind` decides which roles and functions exist (D1, 06 §2.4b).
-- `settings` holds per-org switches (release gates). `deleted_at` starts the
-- 30-day grace period (D10); a soft-deleted org grants nobody anything.

CREATE TABLE IF NOT EXISTS public.organizations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL CHECK (length(btrim(name)) > 0),
  slug        text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  kind        text NOT NULL CHECK (kind IN ('artist', 'producer', 'label')),
  settings    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

-- ── org_members ──────────────────────────────────────────────────────────
-- `functions` are the member's preset bundles (06 §2.2). `cap_grants` /
-- `cap_revokes` are the per-member switches an owner/admin sets on top of
-- them (LABEL-02 follow-up): revoke beats grant, and has_org_cap ignores
-- them for owner/admin. Values the capability model does not know grant
-- nothing, so they are not constrained here (one list to keep in parity,
-- not two).

CREATE TABLE IF NOT EXISTS public.org_members (
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role        text NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'artist')),
  functions   text[] NOT NULL DEFAULT '{}',
  scope       text NOT NULL DEFAULT 'org' CHECK (scope IN ('org', 'artists')),
  cap_grants  text[] NOT NULL DEFAULT '{}',
  cap_revokes text[] NOT NULL DEFAULT '{}',
  invited_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  joined_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id),
  -- 06 §2.5: role `artist` is always artist-scoped.
  CONSTRAINT org_members_artist_is_scoped CHECK (role <> 'artist' OR scope = 'artists')
);

-- Every membership helper call is a lookup by (user, org).
CREATE INDEX IF NOT EXISTS idx_org_members_user_org
  ON public.org_members (user_id, org_id);

-- ── org_invitations ──────────────────────────────────────────────────────
-- Replaces the dormant `invites` for Label OS. Only the sha-256 of the token
-- is stored. `email` is stored normalised (lib/contacts/email.ts). The
-- create / accept / revoke flow is LABEL-08; external project invites
-- (`project_id`, `project_role`) are LABEL-21.

CREATE TABLE IF NOT EXISTS public.org_invitations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email        text NOT NULL CHECK (email = lower(btrim(email)) AND length(email) > 0),
  role         text NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'artist')),
  functions    text[] NOT NULL DEFAULT '{}',
  artist_ids   uuid[] NOT NULL DEFAULT '{}',
  project_id   uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  project_role text CHECK (project_role IN ('viewer', 'commenter', 'contributor', 'editor')),
  token_hash   text NOT NULL UNIQUE,
  expires_at   timestamptz NOT NULL,
  accepted_at  timestamptz,
  revoked_at   timestamptz,
  invited_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT org_invitations_project_role_pair
    CHECK ((project_id IS NULL) = (project_role IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_org_invitations_org
  ON public.org_invitations (org_id, created_at DESC);

-- ── user_profiles ────────────────────────────────────────────────────────
-- Neutral display identity for members. creator_profiles stays the
-- storefront row and the producer marker, and is not overloaded further.

CREATE TABLE IF NOT EXISTS public.user_profiles (
  user_id                uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name           text,
  avatar_url             text,
  last_seen_overview_at  timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- ── activity_events ──────────────────────────────────────────────────────
-- Schema only; written by LABEL-05's recordEvent, read by LABEL-08/19.
-- Append-only (05 §6 rule 6). Context keys are denormalised so feeds filter
-- by index without joins; artist/song/release have no FK yet because those
-- tables do not exist (LABEL-10 onwards adds them). `audit` rows are kept
-- for the life of the org, the rest 24 months (D9). `visibility = 'internal'`
-- is business-internal (08 §B4).

CREATE TABLE IF NOT EXISTS public.activity_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  verb         text NOT NULL CHECK (verb ~ '^[a-z_]+\.[a-z_]+$'),
  artist_id    uuid,
  project_id   uuid,
  song_id      uuid,
  release_id   uuid,
  subject_type text,
  subject_id   uuid,
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  audit        boolean NOT NULL DEFAULT false,
  visibility   text NOT NULL DEFAULT 'internal' CHECK (visibility IN ('internal', 'artist')),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_events_org_created
  ON public.activity_events (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_events_artist_created
  ON public.activity_events (artist_id, created_at DESC)
  WHERE artist_id IS NOT NULL;

-- ── org_role(org) ────────────────────────────────────────────────────────
-- The caller's role in the org, or NULL when not a member (or the org is
-- soft-deleted). Membership test for policies: `org_role(org_id) IS NOT NULL`.

CREATE OR REPLACE FUNCTION public.org_role(p_org uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT om.role
  FROM public.org_members om
  JOIN public.organizations o ON o.id = om.org_id
  WHERE om.org_id = p_org
    AND om.user_id = auth.uid()
    AND o.deleted_at IS NULL;
$$;

-- ── has_org_cap(org, cap) ────────────────────────────────────────────────
-- Does the caller hold this capability in this org? The SQL twin of
-- capabilitiesFor() in src/lib/labelos/capabilities.ts, which is the source
-- of truth. Every grant is DATA in the constants below, never a branch, and
-- src/lib/labelos/capabilities.sql.test.ts parses them and holds them equal
-- to the TypeScript tables. Change the TypeScript first, then these arrays.
--
-- Pairs are 2-D arrays of [key, value]. Everything fails closed: an unknown
-- capability, kind, role or function grants nothing.
--
-- Algorithm (same order as capabilitiesFor):
--   1. the role must be offered by the org kind;
--   2. granted = role grants (+ each offered function's preset, for roles
--      that use functions) (+ cap_grants, for roles that take overrides);
--   3. revoked = cap_revokes plus everything that transitively implies one;
--   4. granted is closed under IMPLIES;
--   5. the cap must be granted, inside the kind's ceiling, not NEVER_GRANTABLE
--      for the role, and not revoked.

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
    'members.manage', 'org.manage', 'finance.read', 'business.read.internal'
  ];
  org_kinds constant text[] := ARRAY['artist', 'producer', 'label'];
  roles_by_org_kind constant text[] := ARRAY[
    ['artist', 'owner'], ['artist', 'admin'], ['artist', 'member'],
    ['producer', 'owner'], ['producer', 'admin'], ['producer', 'member'],
    ['label', 'owner'], ['label', 'admin'], ['label', 'member'], ['label', 'artist']
  ];
  functions_by_org_kind constant text[] := ARRAY[
    ['artist', 'artist_manager'], ['artist', 'producer'], ['artist', 'engineer'],
    ['artist', 'marketing'], ['artist', 'legal'], ['artist', 'operations'],
    ['producer', 'producer'], ['producer', 'engineer'],
    ['producer', 'artist_manager'], ['producer', 'operations'],
    ['label', 'a_and_r'], ['label', 'project_manager'], ['label', 'marketing'],
    ['label', 'legal'], ['label', 'finance'], ['label', 'artist_manager'],
    ['label', 'producer'], ['label', 'engineer'], ['label', 'operations']
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
    ['a_and_r', 'tasks.write'],
    ['project_manager', 'catalog.write'], ['project_manager', 'audio.finished'],
    ['project_manager', 'audio.working'], ['project_manager', 'review.write'],
    ['project_manager', 'rights.read'], ['project_manager', 'release.write'],
    ['project_manager', 'release.approve.metadata'],
    ['project_manager', 'share.external'],
    ['project_manager', 'business.read.internal'],
    ['project_manager', 'tasks.write'],
    ['marketing', 'catalog.read'], ['marketing', 'audio.finished'],
    ['marketing', 'release.approve.artwork'],
    ['marketing', 'release.approve.marketing'],
    ['marketing', 'business.read.internal'], ['marketing', 'tasks.write'],
    ['legal', 'catalog.read'], ['legal', 'audio.finished'],
    ['legal', 'rights.write'], ['legal', 'contracts.read'],
    ['legal', 'release.approve.legal'], ['legal', 'business.read.internal'],
    ['legal', 'tasks.write'],
    ['artist_manager', 'catalog.write'], ['artist_manager', 'audio.finished'],
    ['artist_manager', 'audio.working'], ['artist_manager', 'review.write'],
    ['artist_manager', 'rights.read'], ['artist_manager', 'tasks.write'],
    ['producer', 'catalog.write'], ['producer', 'audio.finished'],
    ['producer', 'audio.working'], ['producer', 'rights.read.own_line'],
    ['producer', 'tasks.write'],
    ['engineer', 'catalog.write'], ['engineer', 'audio.finished'],
    ['engineer', 'audio.working'], ['engineer', 'rights.read.own_line'],
    ['engineer', 'tasks.write']
  ];
  -- IMPLIES: [wider, narrower].
  implies constant text[] := ARRAY[
    ['catalog.write', 'catalog.read'], ['audio.finished', 'catalog.read'],
    ['audio.working', 'catalog.read'], ['review.comment', 'catalog.read'],
    ['rights.read.own_line', 'catalog.read'], ['contracts.read', 'catalog.read'],
    ['release.write', 'catalog.read'], ['release.approve.master', 'catalog.read'],
    ['release.approve.artwork', 'catalog.read'],
    ['release.approve.legal', 'catalog.read'],
    ['release.approve.marketing', 'catalog.read'],
    ['release.approve.metadata', 'catalog.read'], ['tasks.write', 'catalog.read'],
    ['share.external', 'catalog.read'], ['business.read.internal', 'catalog.read'],
    ['rights.write', 'rights.read'], ['rights.read', 'rights.read.own_line'],
    ['review.write', 'review.comment']
  ];
  never_grantable constant text[] := ARRAY[
    ['member', 'members.manage'], ['member', 'org.manage'],
    ['artist', 'members.manage'], ['artist', 'org.manage'],
    ['artist', 'business.read.internal'], ['artist', 'contracts.read']
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
BEGIN
  IF p_org IS NULL OR p_cap IS NULL OR NOT (p_cap = ANY (all_capabilities)) THEN
    RETURN false;
  END IF;

  SELECT o.kind, om.role, om.functions, om.cap_grants, om.cap_revokes
    INTO v_kind, v_role, v_functions, v_grants, v_revokes
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
  RETURN NOT (p_cap = ANY (revoked));
END;
$fn$;

ALTER FUNCTION public.org_role(uuid) OWNER TO postgres;
ALTER FUNCTION public.has_org_cap(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.org_role(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_org_cap(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.org_role(uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.has_org_cap(uuid, text) TO authenticated, anon;

-- ── ≥1 owner per org ─────────────────────────────────────────────────────
-- Deferred to commit, so a service-role ownership transfer can demote the
-- old owner before promoting the new one inside one transaction. (Through
-- RLS the order is forced the other way: once demoted, the old owner may no
-- longer write owner rows.) Skipped when the org itself is gone (deleting an
-- org cascades to its members).

CREATE OR REPLACE FUNCTION public.org_members_keep_an_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.role = 'owner'
     AND EXISTS (SELECT 1 FROM public.organizations WHERE id = OLD.org_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.org_members
       WHERE org_id = OLD.org_id AND role = 'owner'
     ) THEN
    RAISE EXCEPTION 'organization % must keep at least one owner', OLD.org_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;

ALTER FUNCTION public.org_members_keep_an_owner() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.org_members_keep_an_owner() FROM PUBLIC;

DROP TRIGGER IF EXISTS org_members_keep_an_owner ON public.org_members;
CREATE CONSTRAINT TRIGGER org_members_keep_an_owner
  AFTER UPDATE OR DELETE ON public.org_members
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.org_members_keep_an_owner();

-- ── RLS ──────────────────────────────────────────────────────────────────

ALTER TABLE public.organizations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_members     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_events ENABLE ROW LEVEL SECURITY;

-- Members read their orgs. Org writes (create, rename, settings, delete) go
-- through service-role routes; a member-writable row would let anyone with
-- org.manage flip `kind` or `deleted_at` straight through PostgREST.
DROP POLICY IF EXISTS organizations_member_read ON public.organizations;
CREATE POLICY organizations_member_read ON public.organizations
  FOR SELECT
  USING ((SELECT public.org_role(id)) IS NOT NULL);

-- Members read their co-members.
DROP POLICY IF EXISTS org_members_member_read ON public.org_members;
CREATE POLICY org_members_member_read ON public.org_members
  FOR SELECT
  USING ((SELECT public.org_role(org_id)) IS NOT NULL);

-- members.manage changes and removes members. An owner row (before or
-- after the change) needs an owner. There is NO insert policy: see header.
DROP POLICY IF EXISTS org_members_manage_update ON public.org_members;
CREATE POLICY org_members_manage_update ON public.org_members
  FOR UPDATE
  USING (
    (SELECT public.has_org_cap(org_id, 'members.manage'))
    AND (role <> 'owner' OR (SELECT public.org_role(org_id)) = 'owner')
  )
  WITH CHECK (
    (SELECT public.has_org_cap(org_id, 'members.manage'))
    AND (role <> 'owner' OR (SELECT public.org_role(org_id)) = 'owner')
  );

DROP POLICY IF EXISTS org_members_manage_delete ON public.org_members;
CREATE POLICY org_members_manage_delete ON public.org_members
  FOR DELETE
  USING (
    (SELECT public.has_org_cap(org_id, 'members.manage'))
    AND (role <> 'owner' OR (SELECT public.org_role(org_id)) = 'owner')
  );

-- Belt and braces for "no self-join": the table grant is gone too, and an
-- UPDATE may only touch the columns an owner/admin manages — never org_id
-- or user_id, or rewriting user_id would add a person without consent.
REVOKE INSERT ON public.org_members FROM anon, authenticated;
REVOKE UPDATE ON public.org_members FROM anon, authenticated;
GRANT UPDATE (role, functions, scope, cap_grants, cap_revokes)
  ON public.org_members TO authenticated;

-- Invitations are visible to whoever may manage members. Create / revoke /
-- accept are service-role routes (LABEL-08).
DROP POLICY IF EXISTS org_invitations_manage_read ON public.org_invitations;
CREATE POLICY org_invitations_manage_read ON public.org_invitations
  FOR SELECT
  USING ((SELECT public.has_org_cap(org_id, 'members.manage')));

-- A profile is visible to its user and to anyone sharing a live org with
-- them. Writes go through service-role routes.
DROP POLICY IF EXISTS user_profiles_self_or_co_member_read ON public.user_profiles;
CREATE POLICY user_profiles_self_or_co_member_read ON public.user_profiles
  FOR SELECT
  USING (
    user_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.org_members them
      WHERE them.user_id = user_profiles.user_id
        AND (SELECT public.org_role(them.org_id)) IS NOT NULL
    )
  );

-- Members who can see the catalogue read its history (08 §B4); business-
-- internal events additionally need business.read.internal. Scope (which
-- artists) narrows this further once LABEL-10 exists. No INSERT, UPDATE or
-- DELETE policy: events are written by the service role and never changed.
DROP POLICY IF EXISTS activity_events_member_read ON public.activity_events;
CREATE POLICY activity_events_member_read ON public.activity_events
  FOR SELECT
  USING (
    (SELECT public.has_org_cap(org_id, 'catalog.read'))
    AND (visibility = 'artist' OR (SELECT public.has_org_cap(org_id, 'business.read.internal')))
  );

REVOKE UPDATE, DELETE ON public.activity_events FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
