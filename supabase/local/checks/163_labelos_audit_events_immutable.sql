-- Behaviour checks for 163_labelos_audit_events_immutable.sql (LABEL-43,
-- review G1 F6), run by scripts/local-db/check.sh (npm run db:local:check) in
-- its own copy of the throwaway database. Every check RAISEs on failure; psql
-- stops at the first.
--
-- What is proven:
--   - an audit event cannot be UPDATEd or DELETEd by the service role (what
--     every route holds), nor by the superuser — a trigger, not a grant;
--   - turning an audit row into an everyday one first is refused too, and so
--     is promoting an everyday row to audit (a forged, back-dated record);
--   - everyday (audit = false) events are untouched: `prune-org-events`'
--     exact delete still removes old ones and never an audit row;
--   - the LABEL-39 purge still works: deleting the organization row cascades
--     through its audit events, and another org's audit event survives;
--   - deleting a person's account (auth.users, actor_id ON DELETE SET NULL)
--     still works: the audit event stays, without the person; nulling the
--     actor of a person who still exists is refused;
--   - the API roles still hold no UPDATE / DELETE privilege at all (136).
--
-- Against 136's state (before 163) the first check fails: the service role
-- updates an audit event.
--
-- Cast: label L (owner O, member A who will delete their account), label L2
--   (owner X).

\set O   '''a1630000-0000-4000-8000-000000000001'''
\set A   '''a1630000-0000-4000-8000-000000000002'''
\set X   '''a1630000-0000-4000-8000-000000000003'''
\set L   '''b1630000-0000-4000-8000-000000000001'''
\set L2  '''b1630000-0000-4000-8000-000000000002'''
\set E1  '''e1630000-0000-4000-8000-000000000001'''
\set E2  '''e1630000-0000-4000-8000-000000000002'''
\set E3  '''e1630000-0000-4000-8000-000000000003'''
\set E4  '''e1630000-0000-4000-8000-000000000004'''
\set E5  '''e1630000-0000-4000-8000-000000000005'''
\set E6  '''e1630000-0000-4000-8000-000000000006'''
\set E7  '''e1630000-0000-4000-8000-000000000007'''

INSERT INTO auth.users (id, email) VALUES (:O, 'o163@local.test'), (:A, 'a163@local.test'), (:X, 'x163@local.test');
INSERT INTO public.organizations (id, name, slug, kind, created_by) VALUES
  (:L, 'Label L', 'label-l-163', 'label', :O),
  (:L2, 'Label L2', 'label-l2-163', 'label', :X);
INSERT INTO public.org_members (org_id, user_id, role, functions, scope) VALUES
  (:L, :O, 'owner', '{}', 'org'),
  (:L, :A, 'member', '{a_and_r}', 'org'),
  (:L2, :X, 'owner', '{}', 'org');
INSERT INTO public.activity_events (id, org_id, actor_id, verb, audit, visibility, created_at) VALUES
  (:E1, :L, :O, 'member.role_changed', true, 'internal', now()),                       -- audit, recent
  (:E2, :L, :O, 'invitation.created', true, 'internal', now() - interval '30 months'), -- audit, old
  (:E3, :L, :O, 'song.created', false, 'artist', now() - interval '30 months'),        -- everyday, old: pruned
  (:E4, :L, :O, 'song.created', false, 'artist', now()),                               -- everyday, recent: kept
  (:E5, :L, :A, 'member.scope_changed', true, 'internal', now()),                      -- audit by A
  (:E6, :L, :A, 'song.updated', false, 'artist', now()),                               -- everyday by A
  (:E7, :L2, :X, 'member.removed', true, 'internal', now() - interval '30 months');    -- L2's audit

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
CREATE FUNCTION public.rows_changed(stmt text) RETURNS int
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  EXECUTE stmt;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
-- The events left, as "id-suffix:actor?" sorted, e.g. "1:a,7:a" (a = has an actor, - = none).
CREATE FUNCTION public.events_left() RETURNS text
LANGUAGE sql AS $$
  SELECT coalesce(string_agg(right(id::text, 1) || ':' || CASE WHEN actor_id IS NULL THEN '-' ELSE 'a' END, ',' ORDER BY id), '')
  FROM public.activity_events WHERE org_id IN ('b1630000-0000-4000-8000-000000000001', 'b1630000-0000-4000-8000-000000000002')
$$;
GRANT EXECUTE ON FUNCTION public.check_eq(text, anyelement, anyelement), public.check_raises(text, text, text),
  public.rows_changed(text), public.events_left() TO anon, authenticated, service_role;

-- ── The service role (every route) cannot change or delete an audit row ──

SET ROLE service_role;
SELECT public.check_raises('service_role cannot UPDATE an audit event',
  $$UPDATE public.activity_events SET payload = '{"rewritten":true}' WHERE id = 'e1630000-0000-4000-8000-000000000001'$$,
  'audit event is never changed');
SELECT public.check_raises('… nor turn it into an everyday event (so the prune would take it)',
  $$UPDATE public.activity_events SET audit = false WHERE id = 'e1630000-0000-4000-8000-000000000001'$$,
  'audit event is never changed');
SELECT public.check_raises('… nor take its actor off while the person still exists',
  $$UPDATE public.activity_events SET actor_id = NULL WHERE id = 'e1630000-0000-4000-8000-000000000001'$$,
  'audit event is never changed');
SELECT public.check_raises('… nor re-date it',
  $$UPDATE public.activity_events SET created_at = now() - interval '40 months' WHERE id = 'e1630000-0000-4000-8000-000000000001'$$,
  'audit event is never changed');
SELECT public.check_raises('service_role cannot DELETE an audit event',
  $$DELETE FROM public.activity_events WHERE id = 'e1630000-0000-4000-8000-000000000001'$$,
  'audit event is never deleted');
SELECT public.check_raises('… nor every audit event of an org at once (a live org: not a purge)',
  $$DELETE FROM public.activity_events WHERE org_id = 'b1630000-0000-4000-8000-000000000001' AND audit$$,
  'audit event is never deleted');
SELECT public.check_raises('… and the refusal is all-or-nothing: a mixed delete removes nothing',
  $$DELETE FROM public.activity_events WHERE org_id = 'b1630000-0000-4000-8000-000000000001'$$,
  'audit event is never deleted');
SELECT public.check_eq('… so every event is still there', public.events_left(), '1:a,2:a,3:a,4:a,5:a,6:a,7:a');
SELECT public.check_raises('… nor promote an everyday event to audit (a forged, back-dated record)',
  $$UPDATE public.activity_events SET audit = true, verb = 'member.removed', created_at = now() - interval '3 months' WHERE id = 'e1630000-0000-4000-8000-000000000004'$$,
  'never becomes an audit event');
-- Otherwise everyday rows are not the trigger's business.
SELECT public.check_eq('service_role may still update an everyday event',
  public.rows_changed($$UPDATE public.activity_events SET payload = '{"x":1}' WHERE id = 'e1630000-0000-4000-8000-000000000004'$$), 1);
RESET ROLE;

-- The superuser too: it is a trigger, not a privilege.
SELECT public.check_raises('the superuser cannot UPDATE an audit event either',
  $$UPDATE public.activity_events SET verb = 'x.y' WHERE id = 'e1630000-0000-4000-8000-000000000002'$$,
  'audit event is never changed');
SELECT public.check_raises('… nor DELETE one',
  $$DELETE FROM public.activity_events WHERE id = 'e1630000-0000-4000-8000-000000000002'$$,
  'audit event is never deleted');

-- The API roles still hold no write privilege at all (136).
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', :O, 'role', 'authenticated')::text, false);
SELECT public.check_raises('authenticated: no UPDATE privilege', $$UPDATE public.activity_events SET verb = 'x.y'$$, 'permission denied');
SELECT public.check_raises('authenticated: no DELETE privilege', $$DELETE FROM public.activity_events$$, 'permission denied');
RESET ROLE;

-- ── prune-org-events keeps working (lib/labelos/org-lifecycle-store.ts) ──

SET ROLE service_role;
SELECT public.check_eq('the prune''s delete removes the old everyday event, and only it',
  public.rows_changed($$DELETE FROM public.activity_events
    WHERE id IN (SELECT id FROM public.activity_events WHERE audit = false AND created_at < now() - interval '24 months')
      AND audit = false AND created_at < now() - interval '24 months'$$), 1);
SELECT public.check_eq('… audit events of any age stay, and recent everyday ones', public.events_left(), '1:a,2:a,4:a,5:a,6:a,7:a');
RESET ROLE;

-- ── Deleting an account (erasure): the event stays, without the person ──

DELETE FROM public.org_members WHERE user_id = :A;
DELETE FROM auth.users WHERE id = :A;
SELECT public.check_eq('deleting A''s account nulls the actor on A''s audit and everyday events, and keeps both',
  public.events_left(), '1:a,2:a,4:a,5:-,6:-,7:a');
SELECT public.check_eq('… and nothing else about A''s audit event changed',
  (SELECT verb || '/' || audit || '/' || visibility FROM public.activity_events WHERE id = :E5), 'member.scope_changed/true/internal');
SET ROLE service_role;
SELECT public.check_raises('the now actor-less audit event is still immutable',
  $$UPDATE public.activity_events SET payload = '{"x":1}' WHERE id = 'e1630000-0000-4000-8000-000000000005'$$,
  'audit event is never changed');
RESET ROLE;

-- ── The purge (purge-deleted-orgs) still works: the org row cascades ────

UPDATE public.organizations SET deleted_at = now() - interval '31 days' WHERE id = :L;
SET ROLE service_role;
SELECT public.check_raises('a soft-deleted org is not a purge: its audit events still cannot be deleted directly',
  $$DELETE FROM public.activity_events WHERE org_id = 'b1630000-0000-4000-8000-000000000001'$$,
  'audit event is never deleted');
SELECT public.check_eq('deleting the organization row (the purge) deletes it',
  public.rows_changed($$DELETE FROM public.organizations WHERE id = 'b1630000-0000-4000-8000-000000000001'$$), 1);
SELECT public.check_eq('… with every one of its events, audit included; L2''s audit event survives', public.events_left(), '7:a');
SELECT public.check_raises('… and L2''s audit event is still immutable',
  $$DELETE FROM public.activity_events WHERE id = 'e1630000-0000-4000-8000-000000000007'$$,
  'audit event is never deleted');
RESET ROLE;
