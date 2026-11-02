-- Rollback for 187_labelos_atomic_audit_functions.sql (LABEL-73).
--
-- Lives outside supabase/migrations/ on purpose: scripts/apply-migrations.sh
-- applies every *.sql in that folder. Run by hand only.
--
-- Puts back, word for word, the definitions 187 replaced (157 approval decide,
-- 171 has_org_cap, 167 member update, 154 connection accept)
-- and drops everything 187 added. The routes fall back to their previous path
-- (change, then event, with a put-back) when a function is missing, so a
-- rolled-back database keeps working.

DROP FUNCTION IF EXISTS public.labelos_audit_org_settings_atomic(uuid, uuid, jsonb, jsonb);
DROP TRIGGER IF EXISTS contacts_artist_cap ON public.contacts;
DROP FUNCTION IF EXISTS public.contacts_artist_cap();
DROP FUNCTION IF EXISTS public.labelos_artist_cap_ok(uuid, uuid);
DROP FUNCTION IF EXISTS public.labelos_audit_digest_channel_remove(uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS public.labelos_audit_digest_channel_set(uuid, uuid, text, jsonb);
DROP FUNCTION IF EXISTS public.labelos_audit_org_export(uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS public.labelos_audit_org_restore(uuid, uuid, timestamptz, jsonb);
DROP FUNCTION IF EXISTS public.labelos_audit_org_delete(uuid, uuid, timestamptz, jsonb);
DROP FUNCTION IF EXISTS public.labelos_audit_release_import(uuid, uuid, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.labelos_audit_release_store(uuid, uuid, uuid, boolean, text, jsonb, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.labelos_audit_release_deliver(uuid, uuid, uuid, text, timestamptz, jsonb, jsonb, jsonb, text);
DROP FUNCTION IF EXISTS public.labelos_release_latest_approval(uuid, text);
DROP FUNCTION IF EXISTS public.labelos_release_items_key(uuid);

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
