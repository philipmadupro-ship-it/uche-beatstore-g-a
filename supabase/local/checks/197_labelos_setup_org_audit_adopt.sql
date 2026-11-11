-- Behaviour checks for 197_labelos_setup_org_audit_adopt.sql (review G12), run by
-- scripts/local-db/check.sh (npm run db:local:check). Every check RAISEs on failure.
--
-- Proven:
--   - a created org has exactly ONE `org.created` event, audit-class, written
--     with it (actor = the creator, payload names the kind and setting keys);
--   - the idempotent "already set up" answer writes no second event;
--   - a refused call (bad settings) leaves neither org nor event;
--   - an operator-created licensee (created_by NULL, setup_done = false) is
--     ADOPTED by its owner: no second org, settings merged, setup_done = true,
--     the operator's name kept, an audit `org.settings_changed`, and a second
--     call answers the same org without another event;
--   - a caller who does not own the unfinished org does not adopt it;
--   - an owner whose licensee is already set up gets it back (created false)
--     and no second org, and its settings are not touched.

\set A '''a1970000-0000-4000-8000-000000000001'''
\set B '''a1970000-0000-4000-8000-000000000002'''
\set C '''a1970000-0000-4000-8000-000000000003'''
\set D '''a1970000-0000-4000-8000-000000000004'''

INSERT INTO auth.users (id, email) VALUES (:A, 'a197@local.test'), (:B, 'b197@local.test'), (:C, 'c197@local.test'), (:D, 'd197@local.test');

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

-- ── M1: org.created inside the function ──────────────────────────────────
SET ROLE service_role;
SELECT public.labelos_setup_org(:A, 'label', 'Label 197', '{"legal_gate":"off"}'::jsonb) AS first \gset
SELECT public.labelos_setup_org(:A, 'label', 'Label 197 again') AS again \gset
SELECT public.check_raises('bad settings', $$SELECT public.labelos_setup_org('a1970000-0000-4000-8000-000000000004', 'label', 'Bad 197', '{"nope":1}'::jsonb)$$, 'unknown setting');
RESET ROLE;

SELECT public.check_eq('created', (:'first'::jsonb ->> 'created')::boolean, true);
SELECT public.check_eq('one org.created', (SELECT count(*) FROM public.activity_events WHERE org_id = (:'first'::jsonb ->> 'org_id')::uuid AND verb = 'org.created'), 1::bigint);
SELECT public.check_eq('org.created is audit-class',
  (SELECT audit FROM public.activity_events WHERE org_id = (:'first'::jsonb ->> 'org_id')::uuid AND verb = 'org.created'), true);
SELECT public.check_eq('org.created actor', (SELECT actor_id FROM public.activity_events WHERE org_id = (:'first'::jsonb ->> 'org_id')::uuid AND verb = 'org.created'), :A::uuid);
SELECT public.check_eq('org.created payload',
  (SELECT payload FROM public.activity_events WHERE org_id = (:'first'::jsonb ->> 'org_id')::uuid AND verb = 'org.created'),
  '{"kind":"label","source":"setup","settings":["legal_gate"]}'::jsonb);
SELECT public.check_eq('again: same org, not created', (:'again'::jsonb ->> 'org_id') || (:'again'::jsonb ->> 'created'), (:'first'::jsonb ->> 'org_id') || 'false');
SELECT public.check_eq('again: still one org.created', (SELECT count(*) FROM public.activity_events WHERE org_id = (:'first'::jsonb ->> 'org_id')::uuid AND verb = 'org.created'), 1::bigint);
SELECT public.check_eq('refused call: no org', (SELECT count(*) FROM public.organizations WHERE created_by = :D), 0::bigint);

-- ── adoption of an operator-created licensee ─────────────────────────────
INSERT INTO public.organizations (id, name, slug, kind, created_by) VALUES ('b1970000-0000-4000-8000-000000000001', 'Licensee 197', 'licensee-197', 'label', NULL);
INSERT INTO public.org_entitlements (org_id, modules, setup_done) VALUES ('b1970000-0000-4000-8000-000000000001', '{}', false);
INSERT INTO public.org_members (org_id, user_id, role, scope) VALUES ('b1970000-0000-4000-8000-000000000001', :B, 'owner', 'org');
-- C is only an admin there; D owns a finished licensee.
INSERT INTO public.org_members (org_id, user_id, role, scope) VALUES ('b1970000-0000-4000-8000-000000000001', :C, 'admin', 'org');
INSERT INTO public.organizations (id, name, slug, kind, created_by) VALUES ('b1970000-0000-4000-8000-000000000002', 'Done 197', 'done-197', 'label', NULL);
INSERT INTO public.org_entitlements (org_id, modules, setup_done) VALUES ('b1970000-0000-4000-8000-000000000002', '{}', true);
INSERT INTO public.org_members (org_id, user_id, role, scope) VALUES ('b1970000-0000-4000-8000-000000000002', :D, 'owner', 'org');

SET ROLE service_role;
SELECT public.labelos_setup_org(:C, 'label', 'C tries', '{}'::jsonb) AS stranger \gset
SELECT public.labelos_setup_org(:B, 'label', 'Wizard name', '{"departments_off":["pr"]}'::jsonb) AS adopted \gset
SELECT public.labelos_setup_org(:B, 'label', 'Wizard name', '{"departments_off":["finance"]}'::jsonb) AS adopted2 \gset
SELECT public.labelos_setup_org(:D, 'label', 'D own', '{}'::jsonb) AS finished \gset
RESET ROLE;

SELECT public.check_eq('admin does not adopt: new org', (:'stranger'::jsonb ->> 'created')::boolean, true);
SELECT public.check_eq('adopted: the licensee', :'adopted'::jsonb ->> 'org_id', 'b1970000-0000-4000-8000-000000000001');
SELECT public.check_eq('adopted: flag', (:'adopted'::jsonb ->> 'adopted')::boolean, true);
SELECT public.check_eq('adopted: not created', (:'adopted'::jsonb ->> 'created')::boolean, false);
SELECT public.check_eq('adopted: setup_done', (SELECT setup_done FROM public.org_entitlements WHERE org_id = 'b1970000-0000-4000-8000-000000000001'), true);
SELECT public.check_eq('adopted: settings merged', (SELECT settings FROM public.organizations WHERE id = 'b1970000-0000-4000-8000-000000000001'), '{"departments_off":["pr"]}'::jsonb);
SELECT public.check_eq('adopted: operator name kept', (SELECT name FROM public.organizations WHERE id = 'b1970000-0000-4000-8000-000000000001'), 'Licensee 197');
SELECT public.check_eq('adopted: one audit event',
  (SELECT count(*) FROM public.activity_events WHERE org_id = 'b1970000-0000-4000-8000-000000000001' AND verb = 'org.settings_changed' AND audit AND payload ->> 'source' = 'setup'), 1::bigint);
SELECT public.check_eq('adopted: no second org for B', (SELECT count(*) FROM public.org_members WHERE user_id = :B), 1::bigint);
SELECT public.check_eq('second call: same org, settings not an edit', (:'adopted2'::jsonb ->> 'org_id') || (:'adopted2'::jsonb ->> 'created'), 'b1970000-0000-4000-8000-000000000001false');
SELECT public.check_eq('second call: settings unchanged', (SELECT settings FROM public.organizations WHERE id = 'b1970000-0000-4000-8000-000000000001'), '{"departments_off":["pr"]}'::jsonb);
SELECT public.check_eq('second call: still one event',
  (SELECT count(*) FROM public.activity_events WHERE org_id = 'b1970000-0000-4000-8000-000000000001' AND verb = 'org.settings_changed'), 1::bigint);
SELECT public.check_eq('finished licensee: answered, not adopted, no second org',
  (:'finished'::jsonb ->> 'org_id') || (:'finished'::jsonb ->> 'created'), 'b1970000-0000-4000-8000-000000000002false');
SELECT public.check_eq('finished licensee: D still has one org', (SELECT count(*) FROM public.org_members WHERE user_id = :D), 1::bigint);
SELECT public.check_eq('finished licensee untouched', (SELECT settings FROM public.organizations WHERE id = 'b1970000-0000-4000-8000-000000000002'), '{}'::jsonb);

SET ROLE authenticated;
SELECT public.check_raises('authenticated: setup', $$SELECT public.labelos_setup_org('a1970000-0000-4000-8000-000000000004', 'label', 'Sneaky', '{}'::jsonb)$$, 'permission denied');
RESET ROLE;
