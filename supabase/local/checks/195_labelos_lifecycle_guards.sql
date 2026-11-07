-- Behaviour checks for 195_labelos_lifecycle_guards.sql (LABEL-75), run by
-- scripts/local-db/check.sh in its own copy of the throwaway database.
-- Proves: a sole owner's account cannot be deleted (a second owner lifts it);
-- split_lines hides signature_asset_id / signed_by from the API roles;
-- activity_events cannot be truncated; the rewritten member-read policy gives
-- the same rows as before; an organization is deleted only past its grace.

\set O   '''a1950000-0000-4000-8000-000000000001'''
\set O2  '''a1950000-0000-4000-8000-000000000002'''
\set M   '''a1950000-0000-4000-8000-000000000003'''
\set L   '''b1950000-0000-4000-8000-000000000001'''
\set L2  '''b1950000-0000-4000-8000-000000000002'''

INSERT INTO auth.users (id, email) VALUES (:O, 'o195@local.test'), (:O2, 'o2195@local.test'), (:M, 'm195@local.test');
INSERT INTO public.organizations (id, name, slug, kind, created_by) VALUES
  (:L, 'Label L', 'label-l-195', 'label', :O),
  (:L2, 'Label L2', 'label-l2-195', 'label', :O2);
INSERT INTO public.org_members (org_id, user_id, role, functions, scope) VALUES
  (:L, :O, 'owner', '{}', 'org'),
  (:L, :M, 'member', '{marketing}', 'org'),
  (:L2, :O2, 'owner', '{}', 'org');

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
GRANT EXECUTE ON FUNCTION public.check_eq(text, anyelement, anyelement), public.check_raises(text, text, text), public.as_user(text)
  TO anon, authenticated, service_role;

-- ── 1. sole owner ────────────────────────────────────────────────────────

SELECT public.check_raises('the only owner of an org cannot delete their account',
  $$DELETE FROM auth.users WHERE id = 'a1950000-0000-4000-8000-000000000002'$$,
  'transfer ownership or delete the organization first');
SELECT public.check_eq('…and the account is still there', (SELECT count(*)::int FROM auth.users WHERE id = :O2), 1);
DELETE FROM auth.users WHERE id = :M; -- a plain member can delete their account
SELECT public.check_eq('…and was removed', (SELECT count(*)::int FROM auth.users WHERE id = :M), 0);

-- A second owner lifts it.
INSERT INTO public.org_members (org_id, user_id, role, functions, scope) VALUES (:L, :O2, 'owner', '{}', 'org');
DELETE FROM auth.users WHERE id = :O;
SELECT public.check_eq('with a second owner the first can go', (SELECT count(*)::int FROM auth.users WHERE id = :O), 0);
SELECT public.check_raises('…and now the remaining one is the sole owner of both',
  $$DELETE FROM auth.users WHERE id = 'a1950000-0000-4000-8000-000000000002'$$,
  'transfer ownership or delete the organization first');

-- ── 2. split_lines column grant ──────────────────────────────────────────

SELECT public.check_eq('authenticated holds no table-wide SELECT on split_lines',
  has_table_privilege('authenticated', 'public.split_lines', 'SELECT'), false);
SELECT public.check_eq('anon neither', has_table_privilege('anon', 'public.split_lines', 'SELECT'), false);
SELECT public.check_eq('signature_asset_id is hidden from authenticated',
  has_column_privilege('authenticated', 'public.split_lines', 'signature_asset_id', 'SELECT'), false);
SELECT public.check_eq('signed_by is hidden from authenticated',
  has_column_privilege('authenticated', 'public.split_lines', 'signed_by', 'SELECT'), false);
SELECT public.check_eq('signed_by is hidden from anon',
  has_column_privilege('anon', 'public.split_lines', 'signed_by', 'SELECT'), false);
SELECT public.check_eq('share is still readable (the own-line reader’s line)',
  has_column_privilege('authenticated', 'public.split_lines', 'share', 'SELECT'), true);
SELECT public.check_eq('service_role keeps the whole table',
  has_table_privilege('service_role', 'public.split_lines', 'SELECT'), true);

-- ── 3. activity_events cannot be truncated ───────────────────────────────

SELECT public.check_raises('TRUNCATE activity_events is refused',
  $$TRUNCATE public.activity_events$$, 'never truncated');

-- ── 4. the member-read policy, same rows as before ──────────────────────

INSERT INTO auth.users (id, email) VALUES (:M, 'm195@local.test') ON CONFLICT DO NOTHING;
INSERT INTO public.org_members (org_id, user_id, role, functions, scope) VALUES (:L2, :M, 'member', '{producer}', 'org')
  ON CONFLICT DO NOTHING;
INSERT INTO public.activity_events (org_id, actor_id, verb, subject_type, subject_id, payload, audit, visibility) VALUES
  (:L2, :O2, 'project.created', 'project', :L2, '{}', false, 'artist'),
  (:L2, :O2, 'org.settings_changed', 'org', :L2, '{}', false, 'internal'),
  (:L,  :O2, 'project.created', 'project', :L, '{}', false, 'artist');

SELECT public.as_user(:M::text);
SET ROLE authenticated;
SELECT public.check_eq('a producer-function member reads the artist-visible event of their org only',
  (SELECT string_agg(verb || ':' || visibility, ',' ORDER BY verb) FROM public.activity_events WHERE org_id = :L2), 'project.created:artist');
SELECT public.check_eq('the other org’s event is invisible to a non-member',
  (SELECT count(*)::int FROM public.activity_events WHERE org_id = :L), 0);
RESET ROLE;
SELECT public.as_user(:O2::text);
SET ROLE authenticated;
SELECT public.check_eq('an owner reads both of their org’s events (and not the other org’s)',
  (SELECT count(*)::int FROM public.activity_events WHERE org_id = :L2), 2);
RESET ROLE;

-- ── 5. organization deleted only past the grace ──────────────────────────

SELECT public.check_raises('a live org cannot be deleted',
  $$DELETE FROM public.organizations WHERE id = 'b1950000-0000-4000-8000-000000000002'$$, 'deleted only by the purge');
UPDATE public.organizations SET deleted_at = now() - interval '3 days' WHERE id = :L2;
SELECT public.check_raises('an org inside its grace cannot be deleted',
  $$DELETE FROM public.organizations WHERE id = 'b1950000-0000-4000-8000-000000000002'$$, 'deleted only by the purge');
UPDATE public.organizations SET deleted_at = now() - interval '31 days' WHERE id = :L2;
DELETE FROM public.organizations WHERE id = :L2;
SELECT public.check_eq('an org past its grace is deleted', (SELECT count(*)::int FROM public.organizations WHERE id = :L2), 0);
SELECT public.check_eq('…and its events went with it', (SELECT count(*)::int FROM public.activity_events WHERE org_id = :L2), 0);
UPDATE public.organizations SET deleted_at = now() - interval '31 days' WHERE id = :L;
DELETE FROM public.organizations WHERE id = :L;

-- ── 6. a console-created org's org.created is audit-class ────────────────

\set OP '''a1950000-0000-4000-8000-0000000000f1'''
INSERT INTO auth.users (id, email) VALUES (:OP, 'op195@local.test');
INSERT INTO public.platform_admins (user_id, note) VALUES (:OP, 'check');
SET ROLE service_role;
SELECT public.labelos_platform_create_licensee(:OP, 'Console Label', 'console-label-195', 'label', '{}'::text[], NULL, NULL, '{"x":1}'::jsonb);
RESET ROLE;
SELECT public.check_eq('the console org’s org.created is an audit event',
  (SELECT audit FROM public.activity_events WHERE verb = 'org.created' AND org_id = (SELECT id FROM public.organizations WHERE slug = 'console-label-195')), true);
SELECT public.check_raises('…and refuses UPDATE',
  $$UPDATE public.activity_events SET payload = '{}' WHERE verb = 'org.created' AND org_id = (SELECT id FROM public.organizations WHERE slug = 'console-label-195')$$, 'never changed');
SELECT public.check_raises('…and DELETE while the org exists',
  $$DELETE FROM public.activity_events WHERE verb = 'org.created' AND org_id = (SELECT id FROM public.organizations WHERE slug = 'console-label-195')$$, 'never deleted');
