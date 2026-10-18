-- Behaviour checks for 172_labelos_org_settings.sql (LABEL-51), run by
-- scripts/local-db/check.sh (npm run db:local:check). Every check RAISEs on failure.
--
-- Cast: OW owner of label L, AD admin of L (holds every capability, is not the
-- owner), M member of L, OW2 owner of label L2.
--
-- Proven: only service_role can call the function; it refuses a non-owner
-- (including an admin), a missing or soft-deleted org; it validates every key;
-- it merges (untouched keys stay), writes `org.settings_changed` as an internal
-- audit event in the SAME transaction, and writes nothing when the event cannot
-- be written (payload rejected after the update is rolled back with the call).

\set OW  '''a1720000-0000-4000-8000-000000000001'''
\set AD  '''a1720000-0000-4000-8000-000000000002'''
\set M   '''a1720000-0000-4000-8000-000000000003'''
\set OW2 '''a1720000-0000-4000-8000-000000000004'''
\set L   '''b1720000-0000-4000-8000-000000000001'''
\set L2  '''b1720000-0000-4000-8000-000000000002'''

INSERT INTO auth.users (id, email) VALUES
  (:OW, 'ow172@local.test'), (:AD, 'ad172@local.test'), (:M, 'm172@local.test'), (:OW2, 'ow2172@local.test');
INSERT INTO public.organizations (id, name, slug, kind, created_by, settings) VALUES
  (:L, 'Label', 'label-172', 'label', :OW, '{"legal_gate":"on","attention_release_days":30}'),
  (:L2, 'Label Two', 'label-two-172', 'label', :OW2, '{}');
INSERT INTO public.org_members (org_id, user_id, role, functions, scope) VALUES
  (:L, :OW, 'owner', '{}', 'org'),
  (:L, :AD, 'admin', '{}', 'org'),
  (:L, :M, 'member', '{legal}', 'org'),
  (:L2, :OW2, 'owner', '{}', 'org');

CREATE FUNCTION public.check_eq(label text, got anyelement, want anyelement) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'CHECK FAILED: % — got %, want %', label, got, want;
  END IF;
END $$;
CREATE FUNCTION public.check_raises(label text, stmt text, pattern text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM ~* pattern THEN RETURN; END IF;
    RAISE EXCEPTION 'CHECK FAILED: % — raised "%", wanted /%/', label, SQLERRM, pattern;
  END;
  RAISE EXCEPTION 'CHECK FAILED: % — statement succeeded, wanted /%/', label, pattern;
END $$;
GRANT EXECUTE ON FUNCTION public.check_eq(text, anyelement, anyelement), public.check_raises(text, text, text) TO anon, authenticated, service_role;

-- ── the API roles cannot call it ─────────────────────────────────────────
SET ROLE authenticated;
SELECT public.check_raises('authenticated cannot call the function',
  $$SELECT public.labelos_audit_org_settings('b1720000-0000-4000-8000-000000000001', 'a1720000-0000-4000-8000-000000000001', '{"legal_gate":"off"}', '{}')$$, 'permission denied');
RESET ROLE;
SET ROLE anon;
SELECT public.check_raises('anon cannot call the function',
  $$SELECT public.labelos_audit_org_settings('b1720000-0000-4000-8000-000000000001', 'a1720000-0000-4000-8000-000000000001', '{"legal_gate":"off"}', '{}')$$, 'permission denied');
RESET ROLE;

SET ROLE service_role;

-- ── only the owner ───────────────────────────────────────────────────────
SELECT public.check_eq('an admin is refused', public.labelos_audit_org_settings(:L, :AD, '{"legal_gate":"off"}', '{"keys":["legal_gate"]}') ->> 'error', 'not_owner');
SELECT public.check_eq('a member is refused', public.labelos_audit_org_settings(:L, :M, '{"legal_gate":"off"}', '{"keys":["legal_gate"]}') ->> 'error', 'not_owner');
SELECT public.check_eq('another org''s owner is refused', public.labelos_audit_org_settings(:L, :OW2, '{"legal_gate":"off"}', '{"keys":["legal_gate"]}') ->> 'error', 'not_owner');
SELECT public.check_eq('no actor is refused', public.labelos_audit_org_settings(:L, NULL, '{"legal_gate":"off"}', '{"keys":["legal_gate"]}') ->> 'error', 'not_owner');
SELECT public.check_eq('an unknown org is not found', public.labelos_audit_org_settings('b1720000-0000-4000-8000-0000000000ff', :OW, '{}', '{}') ->> 'error', 'not_found');
SELECT public.check_eq('refusals changed nothing', (SELECT settings ->> 'legal_gate' FROM public.organizations WHERE id = :L), 'on');
SELECT public.check_eq('refusals wrote no event', (SELECT count(*) FROM public.activity_events WHERE org_id = :L AND verb = 'org.settings_changed'), 0::bigint);

-- ── validation ───────────────────────────────────────────────────────────
SELECT public.check_raises('unknown key', $$SELECT public.labelos_audit_org_settings('b1720000-0000-4000-8000-000000000001', 'a1720000-0000-4000-8000-000000000001', '{"name":"x"}', '{}')$$, 'unknown setting');
SELECT public.check_raises('gate must be on/off', $$SELECT public.labelos_audit_org_settings('b1720000-0000-4000-8000-000000000001', 'a1720000-0000-4000-8000-000000000001', '{"legal_gate":"maybe"}', '{}')$$, 'on" or "off');
SELECT public.check_raises('days out of range', $$SELECT public.labelos_audit_org_settings('b1720000-0000-4000-8000-000000000001', 'a1720000-0000-4000-8000-000000000001', '{"attention_release_days":0}', '{}')$$, 'whole number of days');
SELECT public.check_raises('days not fractional', $$SELECT public.labelos_audit_org_settings('b1720000-0000-4000-8000-000000000001', 'a1720000-0000-4000-8000-000000000001', '{"attention_stalled_days":2.5}', '{}')$$, 'whole number of days');
SELECT public.check_raises('unknown department', $$SELECT public.labelos_audit_org_settings('b1720000-0000-4000-8000-000000000001', 'a1720000-0000-4000-8000-000000000001', '{"departments_off":["nope"]}', '{}')$$, 'unknown department');
SELECT public.check_raises('the data export cannot be switched off', $$SELECT public.labelos_audit_org_settings('b1720000-0000-4000-8000-000000000001', 'a1720000-0000-4000-8000-000000000001', '{"departments_off":["export"]}', '{}')$$, 'unknown department');
SELECT public.check_raises('boolean required', $$SELECT public.labelos_audit_org_settings('b1720000-0000-4000-8000-000000000001', 'a1720000-0000-4000-8000-000000000001', '{"require_signed_master_split":"yes"}', '{}')$$, 'boolean');

-- ── the change: merged, with its event, once ─────────────────────────────
SELECT public.check_eq('the owner turns the legal gate off',
  public.labelos_audit_org_settings(:L, :OW, '{"legal_gate":"off","departments_off":["finance"]}',
    '{"keys":["legal_gate","departments_off"],"changes":{"legal_gate":{"from":"on","to":"off"}}}') -> 'settings' ->> 'legal_gate', 'off');
SELECT public.check_eq('a key not in the patch is kept', (SELECT settings ->> 'attention_release_days' FROM public.organizations WHERE id = :L), '30');
SELECT public.check_eq('departments are stored', (SELECT settings -> 'departments_off' ->> 0 FROM public.organizations WHERE id = :L), 'finance');
SELECT public.check_eq('one audit event, internal, by the owner',
  (SELECT count(*) FROM public.activity_events WHERE org_id = :L AND verb = 'org.settings_changed' AND audit AND visibility = 'internal' AND actor_id = :OW), 1::bigint);
SELECT public.check_eq('the event names the keys', (SELECT payload -> 'keys' ->> 0 FROM public.activity_events WHERE org_id = :L AND verb = 'org.settings_changed'), 'legal_gate');
SELECT public.check_eq('the other org is untouched', (SELECT settings FROM public.organizations WHERE id = :L2), '{}'::jsonb);
SELECT public.check_eq('and has no event', (SELECT count(*) FROM public.activity_events WHERE org_id = :L2), 0::bigint);

-- ── one transaction: an event that cannot be written takes the change with it
SELECT public.check_raises('a secret-looking payload key is refused and the change rolls back',
  $$SELECT public.labelos_audit_org_settings('b1720000-0000-4000-8000-000000000001', 'a1720000-0000-4000-8000-000000000001', '{"marketing_gate":"off"}', '{"password":"x"}')$$, 'secret-looking');
SELECT public.check_eq('marketing gate unchanged after the failed call', coalesce((SELECT settings ->> 'marketing_gate' FROM public.organizations WHERE id = :L), 'unset'), 'unset');

-- ── a soft-deleted org is gone ───────────────────────────────────────────
RESET ROLE;
UPDATE public.organizations SET deleted_at = now() WHERE id = :L2;
SET ROLE service_role;
SELECT public.check_eq('a soft-deleted org is not found', public.labelos_audit_org_settings(:L2, :OW2, '{"legal_gate":"off"}', '{}') ->> 'error', 'not_found');
RESET ROLE;
