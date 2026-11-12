-- Rollback for 171_labelos_departments_capabilities.sql (LABEL-49).
--
-- Lives outside supabase/migrations/ on purpose: scripts/apply-migrations.sh
-- applies every *.sql in that folder. Run by hand only.
--
-- Puts back 170's has_org_cap, word for word. The department functions
-- (pr, executive, artistic_director, contracts) and capabilities stay on any
-- org_members row that was given them, but 170 does not know those names, so
-- they grant nothing (fail closed); the `finance` function grants nothing
-- again, and finance.read no longer implies catalog.read. Remove the values
-- by hand if the rollback is meant to be permanent.

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
  -- ENTITLEMENTS (170, LABEL-47): src/lib/labelos/entitlements.ts + account.ts.
  -- CAPABILITY_MODULE: [capability, module]. A capability a module owns needs
  -- the module; every other capability is core and needs nothing.
  capability_modules constant text[] := ARRAY[
    ['contracts.read', 'contracts'], ['finance.read', 'finance']
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

NOTIFY pgrst, 'reload schema';
