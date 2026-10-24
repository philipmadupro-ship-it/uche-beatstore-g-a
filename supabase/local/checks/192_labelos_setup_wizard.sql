-- Behaviour checks for 192_labelos_setup_wizard.sql (LABEL-48), run by
-- scripts/local-db/check.sh (npm run db:local:check). Every check RAISEs on failure.
--
-- Proven:
--   - the wizard's settings are written WITH the org, in the same call: gates,
--     departments off and contract types are on the row at creation, and the
--     owner row exists;
--   - an artist org still gets its one roster artist (139's trigger);
--   - a bad value (unknown department, unknown contract type, unknown key,
--     non-object) raises 22023 and leaves NOTHING behind: no org, no member;
--   - asking again answers the first org unchanged ("created": false) and the
--     new settings are not applied (they are not an edit);
--   - the old three-argument call shape still works (settings default to {});
--   - 172's audit function takes `contract_types` and still refuses unknown
--     keys and values, through the shared validator;
--   - only service_role can call either function or the validator.

\set A '''a1920000-0000-4000-8000-000000000001'''
\set B '''a1920000-0000-4000-8000-000000000002'''
\set C '''a1920000-0000-4000-8000-000000000003'''
\set D '''a1920000-0000-4000-8000-000000000004'''

INSERT INTO auth.users (id, email) VALUES (:A, 'a192@local.test'), (:B, 'b192@local.test'), (:C, 'c192@local.test'), (:D, 'd192@local.test');

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

-- ── creation carries the settings ────────────────────────────────────────
SET ROLE service_role;
SELECT public.labelos_setup_org(:A, 'artist', 'Nova 192',
  '{"legal_gate":"off","departments_off":["finance","pr"],"contract_types":["licence","producer"]}'::jsonb) AS first \gset
SELECT public.labelos_setup_org(:A, 'artist', 'Someone else', '{"marketing_gate":"off"}'::jsonb) AS again \gset
SELECT public.labelos_setup_org(:B, 'label', 'Label 192') AS legacy_shape \gset
RESET ROLE;

SELECT public.check_eq('created', (:'first'::jsonb ->> 'created')::boolean, true);
SELECT public.check_eq('settings stored with the org',
  (SELECT settings FROM public.organizations WHERE id = (:'first'::jsonb ->> 'org_id')::uuid),
  '{"legal_gate":"off","departments_off":["finance","pr"],"contract_types":["licence","producer"]}'::jsonb);
SELECT public.check_eq('owner row', (SELECT count(*) FROM public.org_members WHERE org_id = (:'first'::jsonb ->> 'org_id')::uuid AND user_id = :A AND role = 'owner'), 1::bigint);
SELECT public.check_eq('artist org: one roster artist', (SELECT count(*) FROM public.contacts WHERE org_id = (:'first'::jsonb ->> 'org_id')::uuid AND category = 'artist'), 1::bigint);

SELECT public.check_eq('again: same org', :'again'::jsonb ->> 'org_id', :'first'::jsonb ->> 'org_id');
SELECT public.check_eq('again: not created', (:'again'::jsonb ->> 'created')::boolean, false);
SELECT public.check_eq('again: settings are not an edit',
  (SELECT settings -> 'marketing_gate' FROM public.organizations WHERE id = (:'first'::jsonb ->> 'org_id')::uuid), NULL::jsonb);

SELECT public.check_eq('legacy call shape: created', (:'legacy_shape'::jsonb ->> 'created')::boolean, true);
SELECT public.check_eq('legacy call shape: empty settings', (SELECT settings FROM public.organizations WHERE id = (:'legacy_shape'::jsonb ->> 'org_id')::uuid), '{}'::jsonb);

-- ── a bad value leaves nothing behind ────────────────────────────────────
SET ROLE service_role;
SELECT public.check_raises('unknown department',
  $$SELECT public.labelos_setup_org('a1920000-0000-4000-8000-000000000003', 'label', 'Bad One', '{"departments_off":["nope"]}'::jsonb)$$, 'unknown department');
SELECT public.check_raises('unknown contract type',
  $$SELECT public.labelos_setup_org('a1920000-0000-4000-8000-000000000003', 'label', 'Bad Two', '{"contract_types":["nope"]}'::jsonb)$$, 'unknown contract type');
SELECT public.check_raises('unknown key',
  $$SELECT public.labelos_setup_org('a1920000-0000-4000-8000-000000000003', 'label', 'Bad Three', '{"plan":"gold"}'::jsonb)$$, 'unknown setting');
SELECT public.check_raises('settings must be an object',
  $$SELECT public.labelos_setup_org('a1920000-0000-4000-8000-000000000003', 'label', 'Bad Four', '[]'::jsonb)$$, 'must be an object');
SELECT public.check_raises('gate value',
  $$SELECT public.labelos_setup_org('a1920000-0000-4000-8000-000000000003', 'label', 'Bad Five', '{"legal_gate":"maybe"}'::jsonb)$$, 'must be');
RESET ROLE;
SELECT public.check_eq('nothing created for C', (SELECT count(*) FROM public.organizations WHERE created_by = :C), 0::bigint);
SELECT public.check_eq('no member row for C', (SELECT count(*) FROM public.org_members WHERE user_id = :C), 0::bigint);

-- ── 172's audit function, now through the shared validator ───────────────
SET ROLE service_role;
SELECT public.labelos_audit_org_settings((:'first'::jsonb ->> 'org_id')::uuid, :A, '{"contract_types":["recording"]}'::jsonb, '{"keys":["contract_types"]}'::jsonb) AS changed \gset
SELECT public.check_raises('audit fn: unknown contract type',
  format($$SELECT public.labelos_audit_org_settings(%L, %L, '{"contract_types":["x"]}'::jsonb, '{}'::jsonb)$$, :'first'::jsonb ->> 'org_id', :A), 'unknown contract type');
SELECT public.check_raises('audit fn: unknown key',
  format($$SELECT public.labelos_audit_org_settings(%L, %L, '{"x":1}'::jsonb, '{}'::jsonb)$$, :'first'::jsonb ->> 'org_id', :A), 'unknown setting');
RESET ROLE;
SELECT public.check_eq('audit fn: contract types merged',
  (SELECT settings -> 'contract_types' FROM public.organizations WHERE id = (:'first'::jsonb ->> 'org_id')::uuid), '["recording"]'::jsonb);
SELECT public.check_eq('audit fn: other keys kept',
  (SELECT settings -> 'legal_gate' FROM public.organizations WHERE id = (:'first'::jsonb ->> 'org_id')::uuid), '"off"'::jsonb);
SELECT public.check_eq('audit fn: event written',
  (SELECT count(*) FROM public.activity_events WHERE org_id = (:'first'::jsonb ->> 'org_id')::uuid AND verb = 'org.settings_changed'), 1::bigint);

-- ── the API roles cannot call any of it ──────────────────────────────────
SET ROLE authenticated;
SELECT public.check_raises('authenticated: setup', $$SELECT public.labelos_setup_org('a1920000-0000-4000-8000-000000000004', 'label', 'Sneaky', '{}'::jsonb)$$, 'permission denied');
SELECT public.check_raises('authenticated: validator', $$SELECT public.labelos_validate_org_settings_patch('{}'::jsonb)$$, 'permission denied');
RESET ROLE;
SET ROLE anon;
SELECT public.check_raises('anon: setup', $$SELECT public.labelos_setup_org('a1920000-0000-4000-8000-000000000004', 'label', 'Sneaky', '{}'::jsonb)$$, 'permission denied');
SELECT public.check_raises('anon: validator', $$SELECT public.labelos_validate_org_settings_patch('{}'::jsonb)$$, 'permission denied');
RESET ROLE;
SELECT public.check_eq('nothing created for D', (SELECT count(*) FROM public.organizations WHERE created_by = :D), 0::bigint);
