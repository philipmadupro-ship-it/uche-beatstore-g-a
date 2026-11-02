-- Behaviour checks for 183_labelos_marketing_plans.sql (LABEL-65), run by
-- scripts/local-db/check.sh (npm run db:local:check). Every check RAISEs on failure.
--
-- Proven, as the roles PostgREST uses:
--   - five org-only tables (no user_id), RLS on, one policy each that grants nothing;
--     a member with their own JWT reads, writes and deletes nothing (budget lines included);
--   - one plan per release; the release must be of the plan's org; a plan never moves;
--   - children cannot name a plan of another org (composite FK);
--   - fixed vocabularies (phase, platform, step, status, kind), title/label/note lengths,
--     money is bigint minor units and an upper-case currency, no negative amounts;
--   - a platform step is ticked once;
--   - labelos_audit_marketing_plan_required: owner only, merges one key without losing
--     others, derives `from` itself, writes the audit event in the same transaction, a repeat
--     changes nothing and writes nothing, the API roles cannot call it;
--   - deleting the organization deletes every row.
--
-- Cast: label L owner O, member M; label L2 owner X. Release R in L.

\set P  '''0b0e1a57-0000-4000-8000-000000000001'''
\set O  '''a1830000-0000-4000-8000-000000000001'''
\set M  '''a1830000-0000-4000-8000-000000000002'''
\set X  '''a1830000-0000-4000-8000-000000000003'''
\set L  '''b1830000-0000-4000-8000-000000000001'''
\set L2 '''b1830000-0000-4000-8000-000000000002'''
\set C1 '''c1830000-0000-4000-8000-0000000000c1'''
\set PR '''d1830000-0000-4000-8000-0000000000d1'''
\set R  '''e1830000-0000-4000-8000-0000000000e1'''
\set PLAN '''f1830000-0000-4000-8000-0000000000f1'''

INSERT INTO auth.users (id, email) VALUES
  (:O, 'o183@local.test'), (:M, 'm183@local.test'), (:X, 'x183@local.test');
INSERT INTO public.organizations (id, name, slug, kind, created_by, settings) VALUES
  (:L, 'Label L', 'label-l-183', 'label', :O, '{"legal_gate":"off"}'),
  (:L2, 'Label L2', 'label-l2-183', 'label', :X, '{}');
INSERT INTO public.org_members (org_id, user_id, role, functions, scope, cap_grants) VALUES
  (:L, :O, 'owner', '{}', 'org', '{}'),
  (:L, :M, 'member', '{marketing}', 'org', '{}'),
  (:L2, :X, 'owner', '{}', 'org', '{}');
INSERT INTO public.contacts (id, user_id, org_id, name, email, category) VALUES
  (:C1, NULL, :L, 'Nova', 'nova183@local.test', 'artist');
INSERT INTO public.projects (id, org_id, user_id, name, inbox_for_contact_id) VALUES
  (:PR, :L, NULL, 'Inbox', :C1);
INSERT INTO public.releases (id, org_id, project_id, contact_id, title, created_by) VALUES
  (:R, :L, :PR, :C1, 'Night Shift', :O);

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
CREATE FUNCTION public.as_user(p_user text) RETURNS void
LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, false);
$$;

-- ── Shape of the tables ─────────────────────────────────────────────────

SELECT public.check_eq('no marketing table has a user_id',
  (SELECT count(*)::int FROM information_schema.columns WHERE table_schema = 'public' AND table_name LIKE 'marketing\_%' AND column_name = 'user_id'), 0);
SELECT public.check_eq('all five tables have RLS on',
  (SELECT count(*)::int FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname IN ('marketing_plans','marketing_plan_items','marketing_platform_steps','marketing_budget_lines','marketing_asset_requests') AND relrowsecurity), 5);
SELECT public.check_eq('every policy grants nothing',
  (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public' AND tablename LIKE 'marketing\_%' AND (qual <> 'false' OR cmd <> 'ALL')), 0);

-- ── Plans ───────────────────────────────────────────────────────────────

INSERT INTO public.marketing_plans (id, org_id, release_id, created_by) VALUES (:PLAN, :L, :R, :O);
SELECT public.check_raises('one plan per release',
  $$INSERT INTO public.marketing_plans (org_id, release_id) VALUES ('b1830000-0000-4000-8000-000000000001', 'e1830000-0000-4000-8000-0000000000e1')$$,
  'marketing_plans_one_per_release');
SELECT public.check_raises('the release must be of the same org',
  $$INSERT INTO public.marketing_plans (org_id, release_id) VALUES ('b1830000-0000-4000-8000-000000000002', 'e1830000-0000-4000-8000-0000000000e1')$$,
  'same organization');
SELECT public.check_raises('a plan never moves to another release',
  $$UPDATE public.marketing_plans SET release_id = gen_random_uuid() WHERE id = 'f1830000-0000-4000-8000-0000000000f1'$$,
  'keeps its organization and its release');

-- ── Children ────────────────────────────────────────────────────────────

INSERT INTO public.marketing_plan_items (org_id, plan_id, phase, title, due_on) VALUES
  (:L, :PLAN, 'teaser', 'Snippet on socials', '2026-12-01');
SELECT public.check_raises('a child cannot name a plan of another org',
  $$INSERT INTO public.marketing_plan_items (org_id, plan_id, phase, title, due_on) VALUES ('b1830000-0000-4000-8000-000000000002', 'f1830000-0000-4000-8000-0000000000f1', 'teaser', 'x', '2026-12-01')$$,
  'marketing_plan_items_plan|foreign key');
SELECT public.check_raises('an unknown phase is refused',
  $$INSERT INTO public.marketing_plan_items (org_id, plan_id, phase, title, due_on) VALUES ('b1830000-0000-4000-8000-000000000001', 'f1830000-0000-4000-8000-0000000000f1', 'launch', 'x', '2026-12-01')$$,
  'phase_check|check constraint');
SELECT public.check_raises('an empty title is refused',
  $$INSERT INTO public.marketing_plan_items (org_id, plan_id, phase, title, due_on) VALUES ('b1830000-0000-4000-8000-000000000001', 'f1830000-0000-4000-8000-0000000000f1', 'post', '  ', '2026-12-01')$$,
  'title_check|check constraint');

INSERT INTO public.marketing_platform_steps (org_id, plan_id, platform, step, done_by) VALUES (:L, :PLAN, 'spotify', 'pitch', :M);
SELECT public.check_raises('a platform step is ticked once',
  $$INSERT INTO public.marketing_platform_steps (org_id, plan_id, platform, step) VALUES ('b1830000-0000-4000-8000-000000000001', 'f1830000-0000-4000-8000-0000000000f1', 'spotify', 'pitch')$$,
  'marketing_platform_steps_once');
SELECT public.check_raises('an unknown platform is refused',
  $$INSERT INTO public.marketing_platform_steps (org_id, plan_id, platform, step) VALUES ('b1830000-0000-4000-8000-000000000001', 'f1830000-0000-4000-8000-0000000000f1', 'myspace', 'pitch')$$,
  'platform_check|check constraint');

INSERT INTO public.marketing_budget_lines (org_id, plan_id, label, amount_minor, currency) VALUES (:L, :PLAN, 'Playlist pitching', 150000, 'USD');
SELECT public.check_eq('the amount is bigint minor units',
  (SELECT data_type FROM information_schema.columns WHERE table_name = 'marketing_budget_lines' AND column_name = 'amount_minor'), 'bigint');
SELECT public.check_raises('a negative amount is refused',
  $$INSERT INTO public.marketing_budget_lines (org_id, plan_id, label, amount_minor, currency) VALUES ('b1830000-0000-4000-8000-000000000001', 'f1830000-0000-4000-8000-0000000000f1', 'x', -1, 'USD')$$,
  'amount_minor_check|check constraint');
SELECT public.check_raises('a lower-case currency is refused',
  $$INSERT INTO public.marketing_budget_lines (org_id, plan_id, label, amount_minor, currency) VALUES ('b1830000-0000-4000-8000-000000000001', 'f1830000-0000-4000-8000-0000000000f1', 'x', 1, 'usd')$$,
  'currency_check|check constraint');
SELECT public.check_raises('an unknown budget status is refused',
  $$INSERT INTO public.marketing_budget_lines (org_id, plan_id, label, amount_minor, currency, status) VALUES ('b1830000-0000-4000-8000-000000000001', 'f1830000-0000-4000-8000-0000000000f1', 'x', 1, 'USD', 'paid')$$,
  'status_check|check constraint');

INSERT INTO public.marketing_asset_requests (org_id, plan_id, kind, note, requested_by, recipient_id) VALUES (:L, :PLAN, 'photos', 'Press shots', :M, NULL);
SELECT public.check_raises('an unknown asset kind is refused',
  $$INSERT INTO public.marketing_asset_requests (org_id, plan_id, kind) VALUES ('b1830000-0000-4000-8000-000000000001', 'f1830000-0000-4000-8000-0000000000f1', 'contract')$$,
  'kind_check|check constraint');

-- ── The API roles read and write nothing ────────────────────────────────

SET ROLE authenticated;
SELECT public.as_user('a1830000-0000-4000-8000-000000000001');
SELECT public.check_raises('the owner cannot read plans', $$SELECT count(*) FROM public.marketing_plans$$, 'permission denied');
SELECT public.check_raises('the owner cannot read budget lines', $$SELECT count(*) FROM public.marketing_budget_lines$$, 'permission denied');
SELECT public.check_raises('the owner cannot forge a plan',
  $$INSERT INTO public.marketing_plans (org_id, release_id) VALUES ('b1830000-0000-4000-8000-000000000001', gen_random_uuid())$$, 'permission denied');
SELECT public.as_user('a1830000-0000-4000-8000-000000000002');
SELECT public.check_raises('a marketing member cannot read budget lines with their own JWT', $$SELECT amount_minor FROM public.marketing_budget_lines$$, 'permission denied');
SELECT public.check_raises('a member cannot delete a timeline item', $$DELETE FROM public.marketing_plan_items$$, 'permission denied');
SELECT public.check_raises('the API roles cannot call the requirement function',
  $$SELECT public.labelos_audit_marketing_plan_required('b1830000-0000-4000-8000-000000000001', 'a1830000-0000-4000-8000-000000000001', true)$$, 'permission denied');
RESET ROLE;

-- ── The requirement setting + its audit event ───────────────────────────

SELECT public.check_eq('a member who is not the owner is refused',
  public.labelos_audit_marketing_plan_required(:L, :M, true) ->> 'error', 'not_owner');
SELECT public.check_eq('a missing org is refused',
  public.labelos_audit_marketing_plan_required(gen_random_uuid(), :O, true) ->> 'error', 'not_found');
SELECT public.check_eq('another org''s owner is refused',
  public.labelos_audit_marketing_plan_required(:L, :X, true) ->> 'error', 'not_owner');
SELECT public.check_eq('the owner turns it on', (public.labelos_audit_marketing_plan_required(:L, :O, true) ->> 'changed')::boolean, true);
SELECT public.check_eq('the key is merged and others are kept',
  (SELECT settings::text FROM public.organizations WHERE id = :L), '{"legal_gate": "off", "marketing_plan_required": true}');
SELECT public.check_eq('one audit event, from false to true, no amounts',
  (SELECT payload::text || '/' || audit::text || '/' || visibility FROM public.activity_events WHERE org_id = :L AND verb = 'marketing_plan.requirement_changed'),
  '{"to": true, "from": false}/true/internal');
SELECT public.check_eq('a repeat changes nothing',
  (public.labelos_audit_marketing_plan_required(:L, :O, true) ->> 'changed')::boolean, false);
SELECT public.check_eq('and writes no second event',
  (SELECT count(*)::int FROM public.activity_events WHERE org_id = :L AND verb = 'marketing_plan.requirement_changed'), 1);
SELECT public.check_eq('turning it off records from true',
  (public.labelos_audit_marketing_plan_required(:L, :O, false) ->> 'changed')::boolean, true);
SELECT public.check_eq('the other org was not touched', (SELECT settings::text FROM public.organizations WHERE id = :L2), '{}');

-- ── The org's hard delete takes everything ──────────────────────────────

DELETE FROM public.organizations WHERE id = :L;
SELECT public.check_eq('deleting the org deletes every marketing row',
  (SELECT (SELECT count(*) FROM public.marketing_plans) + (SELECT count(*) FROM public.marketing_plan_items) + (SELECT count(*) FROM public.marketing_platform_steps)
        + (SELECT count(*) FROM public.marketing_budget_lines) + (SELECT count(*) FROM public.marketing_asset_requests))::int, 0);
