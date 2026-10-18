-- 172_labelos_org_settings.sql (LABEL-51, doc 21 §2 item 3, §5.2 #5)
--
-- The organization settings screen's write: `organizations.settings` changes
-- WITH its audit event in one transaction.
--
--  * labelos_audit_org_settings(p_org, p_actor, p_patch, p_payload) —
--    SECURITY DEFINER, service_role EXECUTE only, like 146's functions. It
--    re-checks what the database can know for itself: the org is live and the
--    actor holds role `owner` in it (a capability does not stand in: owner-only
--    is a role, 06 §2.1). It merges `p_patch` into `settings` under a row lock
--    (a key not in the patch is left as it is) and records `org.settings_changed`
--    (an audit event, internal) in the same transaction, so if the event cannot
--    be written the change is not there.
--
--    The patch is validated here as well as in the route, so the function is
--    safe to call from anywhere: only the six owner-editable keys are accepted
--    (legal_gate / marketing_gate 'on'|'off', require_signed_master_split a
--    boolean, attention_release_days / attention_stalled_days whole days 1..365,
--    departments_off an array of known department names). Anything else raises
--    22023. The route checks that a department switched off is part of the
--    org's licence (org_entitlements); a department switch only narrows what the
--    licence grants, it never widens it.
--
--    Answers {"settings": <merged jsonb>} or {"error": "not_found" | "not_owner"}.
--
-- No table, no policy, no column: `organizations.settings` exists since 136 and
-- its readers (release readiness, Needs attention) are total over it.
--
-- Idempotent: CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.labelos_audit_org_settings(
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
  v_key text;
  v_val jsonb;
  v_elem jsonb;
  v_modules constant text[] := ARRAY['contracts', 'finance', 'marketing', 'pr', 'executive', 'artistic', 'store', 'search', 'digest'];
  v_settings jsonb;
BEGIN
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'settings patch must be an object' USING ERRCODE = '22023';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'audit payload must be an object' USING ERRCODE = '22023';
  END IF;

  FOR v_key, v_val IN SELECT key, value FROM jsonb_each(p_patch) LOOP
    IF v_key IN ('legal_gate', 'marketing_gate') THEN
      IF v_val NOT IN ('"on"'::jsonb, '"off"'::jsonb) THEN
        RAISE EXCEPTION '% must be "on" or "off"', v_key USING ERRCODE = '22023';
      END IF;
    ELSIF v_key = 'require_signed_master_split' THEN
      IF jsonb_typeof(v_val) <> 'boolean' THEN
        RAISE EXCEPTION '% must be a boolean', v_key USING ERRCODE = '22023';
      END IF;
    ELSIF v_key IN ('attention_release_days', 'attention_stalled_days') THEN
      IF jsonb_typeof(v_val) <> 'number' OR (v_val #>> '{}') !~ '^[0-9]{1,3}$'
         OR (v_val #>> '{}')::int NOT BETWEEN 1 AND 365 THEN
        RAISE EXCEPTION '% must be a whole number of days from 1 to 365', v_key USING ERRCODE = '22023';
      END IF;
    ELSIF v_key = 'departments_off' THEN
      IF jsonb_typeof(v_val) <> 'array' THEN
        RAISE EXCEPTION 'departments_off must be an array' USING ERRCODE = '22023';
      END IF;
      FOR v_elem IN SELECT value FROM jsonb_array_elements(v_val) LOOP
        IF jsonb_typeof(v_elem) <> 'string' OR NOT ((v_elem #>> '{}') = ANY (v_modules)) THEN
          RAISE EXCEPTION 'departments_off holds an unknown department' USING ERRCODE = '22023';
        END IF;
      END LOOP;
    ELSE
      RAISE EXCEPTION 'unknown setting %', v_key USING ERRCODE = '22023';
    END IF;
  END LOOP;

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

  v_settings := coalesce(v_settings, '{}'::jsonb) || p_patch;
  UPDATE public.organizations SET settings = v_settings WHERE id = p_org;

  PERFORM public.labelos_audit_insert(p_org, p_actor, 'org.settings_changed', 'org', p_org, p_payload);

  RETURN jsonb_build_object('settings', v_settings);
END;
$fn$;

ALTER FUNCTION public.labelos_audit_org_settings(uuid, uuid, jsonb, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_audit_org_settings(uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_audit_org_settings(uuid, uuid, jsonb, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
