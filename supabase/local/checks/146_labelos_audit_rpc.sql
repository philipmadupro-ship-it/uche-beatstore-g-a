-- Behaviour checks for 146_labelos_audit_rpc.sql, run by
-- scripts/local-db/check.sh (npm run db:local:check) in its own copy of the
-- throwaway database. Every check RAISEs on failure; psql stops at the first.
--
-- Cast:
--   OWN  owner of label org L          MEM  an artists-scoped member of L
--   NEW  a member we change/remove     C1,C2 roster artists of L
-- The point of this file: each audit function does the mutation AND the
-- event in one transaction, so if the event cannot be written the mutation
-- is NOT there afterwards; and `authenticated` cannot call any of them.

\set OWN '''a1460000-0000-4000-8000-000000000001'''
\set MEM '''a1460000-0000-4000-8000-000000000002'''
\set NEW '''a1460000-0000-4000-8000-000000000003'''
\set L   '''b1460000-0000-4000-8000-000000000001'''
\set C1  '''c1460000-0000-4000-8000-0000000000c1'''
\set C2  '''c1460000-0000-4000-8000-0000000000c2'''

INSERT INTO auth.users (id, email) VALUES
  (:OWN, 'o146@local.test'), (:MEM, 'm146@local.test'), (:NEW, 'n146@local.test');
INSERT INTO public.organizations (id, name, slug, kind, created_by) VALUES (:L, 'Label L', 'label-l-146', 'label', :OWN);
INSERT INTO public.org_members (org_id, user_id, role, functions, scope) VALUES
  (:L, :OWN, 'owner', '{}', 'org'),
  (:L, :MEM, 'member', '{marketing}', 'artists'),
  (:L, :NEW, 'member', '{a_and_r}', 'org');
INSERT INTO public.contacts (id, user_id, org_id, name, email, category) VALUES
  (:C1, NULL, :L, 'Nova', 'nova146@local.test', 'artist'),
  (:C2, NULL, :L, 'Kai',  'kai146@local.test',  'artist');
INSERT INTO public.member_artist_scopes (org_id, user_id, contact_id) VALUES (:L, :MEM, :C1);

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
GRANT EXECUTE ON FUNCTION public.check_eq(text, anyelement, anyelement), public.check_raises(text, text, text)
  TO anon, authenticated, service_role;

-- ── Grants: service_role only ───────────────────────────────────────────

SELECT public.check_eq('execute grants on ' || p.oid::regprocedure::text,
  (has_function_privilege('service_role', p.oid, 'EXECUTE'),
   has_function_privilege('authenticated', p.oid, 'EXECUTE'),
   has_function_privilege('anon', p.oid, 'EXECUTE'))::text,
  '(t,f,f)')
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname IN ('labelos_audit_member_update', 'labelos_audit_member_remove', 'labelos_audit_member_artists_set',
                    'labelos_audit_invitation_create', 'labelos_audit_invitation_revoke');
SELECT public.check_eq('all five functions exist',
  (SELECT count(*)::int FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'labelos\_audit\_%' AND proname <> 'labelos_audit_insert'
     -- 148 (LABEL-21) adds the project-member family; it is checked in 148's own file.
     AND proname NOT LIKE 'labelos\_audit\_project\_%' AND proname <> 'labelos_audit_insert_project'
     -- 153 (LABEL-27) adds credit decisions; checked in 153's own file.
     AND proname NOT LIKE 'labelos\_audit\_credit\_%'), 5);
SELECT public.check_eq('the private event helper has no caller but its owner',
  (SELECT (has_function_privilege('service_role', p.oid, 'EXECUTE'), has_function_privilege('authenticated', p.oid, 'EXECUTE'))::text
   FROM pg_proc p WHERE p.proname = 'labelos_audit_insert'),
  '(f,f)');

SET ROLE authenticated;
SELECT public.check_raises('authenticated cannot call member_update',
  $$SELECT public.labelos_audit_member_update('b1460000-0000-4000-8000-000000000001', 'a1460000-0000-4000-8000-000000000001', 'a1460000-0000-4000-8000-000000000003', '{"role":"admin"}', 'member.role_changed', '{}')$$,
  'permission denied');
SELECT public.check_raises('authenticated cannot call member_remove',
  $$SELECT public.labelos_audit_member_remove('b1460000-0000-4000-8000-000000000001', 'a1460000-0000-4000-8000-000000000001', 'a1460000-0000-4000-8000-000000000003', '{}')$$,
  'permission denied');
RESET ROLE;
SET ROLE anon;
SELECT public.check_raises('anon cannot call invitation_revoke',
  $$SELECT public.labelos_audit_invitation_revoke('b1460000-0000-4000-8000-000000000001', 'a1460000-0000-4000-8000-000000000001', gen_random_uuid(), '{}')$$,
  'permission denied');
RESET ROLE;

-- ── member_update: mutation + event together ────────────────────────────

SET ROLE service_role;
SELECT public.labelos_audit_member_update(:L, :OWN, :NEW, '{"role":"admin","functions":[]}', 'member.role_changed',
  '{"role":{"from":"member","to":"admin"}}');
RESET ROLE;
SELECT public.check_eq('role changed', (SELECT role FROM public.org_members WHERE org_id = :L AND user_id = :NEW), 'admin');
SELECT public.check_eq('functions changed', (SELECT functions FROM public.org_members WHERE org_id = :L AND user_id = :NEW), '{}'::text[]);
SELECT public.check_eq('one audit event, internal',
  (SELECT (count(*), bool_and(audit), min(visibility))::text FROM public.activity_events
   WHERE org_id = :L AND verb = 'member.role_changed' AND subject_id = :NEW AND actor_id = :OWN), '(1,t,internal)');
SELECT public.check_raises('unknown verb refused',
  $$SELECT public.labelos_audit_member_update('b1460000-0000-4000-8000-000000000001', 'a1460000-0000-4000-8000-000000000001', 'a1460000-0000-4000-8000-000000000003', '{"role":"member"}', 'song.created', '{}')$$,
  'unknown member verb');
SELECT public.check_eq('a change that keeps the member limited leaves the list alone',
  (public.labelos_audit_member_update(:L, :OWN, :MEM, '{"functions":["finance"]}', 'member.capabilities_changed', '{}') -> 'member' ->> 'scope', (SELECT count(*)::int FROM public.member_artist_scopes WHERE org_id = :L AND user_id = :MEM))::text,
  '(artists,1)');
SELECT public.check_eq('and restores marketing',
  public.labelos_audit_member_update(:L, :OWN, :MEM, '{"functions":["marketing"]}', 'member.capabilities_changed', '{}') -> 'member' ->> 'role', 'member');
SELECT public.check_eq('a missing member answers not_found',
  public.labelos_audit_member_update(:L, :OWN, gen_random_uuid(), '{"role":"member"}', 'member.role_changed', '{}') ->> 'error', 'not_found');

-- Widening a scoped member clears their artist list, named in the event —
-- decided by the function from the row, with no flag from the caller.
SELECT public.labelos_audit_member_update(:L, :OWN, :MEM, '{"scope":"org"}', 'member.scope_changed', '{"scope":{"from":"artists","to":"org"}}');
SELECT public.check_eq('artist list cleared', (SELECT count(*)::int FROM public.member_artist_scopes WHERE org_id = :L AND user_id = :MEM), 0);
SELECT public.check_eq('the cleared ids are in the event',
  (SELECT payload #>> '{contact_ids,from,0}' FROM public.activity_events WHERE verb = 'member.scope_changed' AND subject_id = :MEM), 'c1460000-0000-4000-8000-0000000000c1');
-- put MEM back as it was
SELECT public.labelos_audit_member_update(:L, :OWN, :MEM, '{"scope":"artists"}', 'member.scope_changed', '{}');
INSERT INTO public.member_artist_scopes (org_id, user_id, contact_id) VALUES (:L, :MEM, :C1);

-- ── THE ACCEPTANCE CRITERION: a failing audit insert rolls the mutation back ──
-- An unrelated trigger makes every activity_events insert fail, which is what
-- a full disk, a bad payload or a dropped partition looks like to the function.

CREATE FUNCTION public.fail_audit_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'audit insert refused (check)'; END $$;
CREATE TRIGGER zz_fail_audit BEFORE INSERT ON public.activity_events
  FOR EACH ROW EXECUTE FUNCTION public.fail_audit_insert();

SELECT public.check_raises('member_update: failing audit insert raises',
  $$SELECT public.labelos_audit_member_update('b1460000-0000-4000-8000-000000000001', 'a1460000-0000-4000-8000-000000000001', 'a1460000-0000-4000-8000-000000000003', '{"role":"member","functions":["marketing"]}', 'member.role_changed', '{}')$$,
  'audit insert refused');
SELECT public.check_eq('member_update rolled back (role)', (SELECT role FROM public.org_members WHERE org_id = :L AND user_id = :NEW), 'admin');
SELECT public.check_eq('member_update rolled back (functions)', (SELECT functions FROM public.org_members WHERE org_id = :L AND user_id = :NEW), '{}'::text[]);

SELECT public.check_raises('member_update with a scope clear: failing audit insert raises',
  $$SELECT public.labelos_audit_member_update('b1460000-0000-4000-8000-000000000001', 'a1460000-0000-4000-8000-000000000001', 'a1460000-0000-4000-8000-000000000002', '{"scope":"org"}', 'member.scope_changed', '{}')$$,
  'audit insert refused');
SELECT public.check_eq('the scope change rolled back', (SELECT scope FROM public.org_members WHERE org_id = :L AND user_id = :MEM), 'artists');
SELECT public.check_eq('the artist list came back', (SELECT count(*)::int FROM public.member_artist_scopes WHERE org_id = :L AND user_id = :MEM), 1);

SELECT public.check_eq('member_artists_set refuses a member who sees the whole org (and writes nothing)',
  (public.labelos_audit_member_artists_set(:L, :OWN, :NEW, ARRAY[:C1]::uuid[], '{}') ->> 'error',
   (SELECT count(*)::int FROM public.member_artist_scopes WHERE org_id = :L AND user_id = :NEW),
   (SELECT count(*)::int FROM public.activity_events WHERE verb = 'member.artists_changed' AND subject_id = :NEW))::text,
  '(not_scoped,0,0)');
SELECT public.check_eq('member_artists_set on a missing member answers not_found',
  public.labelos_audit_member_artists_set(:L, :OWN, gen_random_uuid(), '{}'::uuid[], '{}') ->> 'error', 'not_found');
SELECT public.check_raises('member_artists_set: failing audit insert raises',
  $$SELECT public.labelos_audit_member_artists_set('b1460000-0000-4000-8000-000000000001', 'a1460000-0000-4000-8000-000000000001', 'a1460000-0000-4000-8000-000000000002', ARRAY['c1460000-0000-4000-8000-0000000000c2']::uuid[], '{}')$$,
  'audit insert refused');
SELECT public.check_eq('the artist list is unchanged',
  (SELECT array_agg(contact_id) FROM public.member_artist_scopes WHERE org_id = :L AND user_id = :MEM), ARRAY[:C1]::uuid[]);

SELECT public.check_raises('member_remove: failing audit insert raises',
  $$SELECT public.labelos_audit_member_remove('b1460000-0000-4000-8000-000000000001', 'a1460000-0000-4000-8000-000000000001', 'a1460000-0000-4000-8000-000000000002', '{}')$$,
  'audit insert refused');
SELECT public.check_eq('the member is still there', (SELECT count(*)::int FROM public.org_members WHERE org_id = :L AND user_id = :MEM), 1);
SELECT public.check_eq('and so is their artist list', (SELECT count(*)::int FROM public.member_artist_scopes WHERE org_id = :L AND user_id = :MEM), 1);

SELECT public.check_raises('invitation_create: failing audit insert raises',
  $$SELECT public.labelos_audit_invitation_create('b1460000-0000-4000-8000-000000000001', 'a1460000-0000-4000-8000-000000000001', 'x146@local.test', 'member', '{}', '{}', repeat('a', 64), now() + interval '7 days', '{}')$$,
  'audit insert refused');
SELECT public.check_eq('no invitation was left behind', (SELECT count(*)::int FROM public.org_invitations WHERE org_id = :L), 0);

-- A pending invitation to revoke, created while the trigger is off.
ALTER TABLE public.activity_events DISABLE TRIGGER zz_fail_audit;
SELECT public.labelos_audit_invitation_create(:L, :OWN, 'r146@local.test', 'member', '{marketing}', '{}', repeat('b', 64), now() + interval '7 days', '{"email":"r146@local.test"}');
ALTER TABLE public.activity_events ENABLE TRIGGER zz_fail_audit;
SELECT public.check_raises('invitation_revoke: failing audit insert raises',
  $$SELECT public.labelos_audit_invitation_revoke('b1460000-0000-4000-8000-000000000001', 'a1460000-0000-4000-8000-000000000001', (SELECT id FROM public.org_invitations WHERE email = 'r146@local.test'), '{}')$$,
  'audit insert refused');
SELECT public.check_eq('the invitation is still pending', (SELECT revoked_at IS NULL FROM public.org_invitations WHERE email = 'r146@local.test'), true);

DROP TRIGGER zz_fail_audit ON public.activity_events;
DROP FUNCTION public.fail_audit_insert();

-- A secret-looking payload key fails the same way, without any trigger.
SELECT public.check_raises('a secret-looking key is refused',
  $$SELECT public.labelos_audit_member_remove('b1460000-0000-4000-8000-000000000001', 'a1460000-0000-4000-8000-000000000001', 'a1460000-0000-4000-8000-000000000003', '{"invite_token":"x"}')$$,
  'secret-looking');
SELECT public.check_eq('and the member stays', (SELECT count(*)::int FROM public.org_members WHERE org_id = :L AND user_id = :NEW), 1);

-- ── the happy paths ─────────────────────────────────────────────────────

SELECT public.check_eq('member_artists_set replaces the list',
  public.labelos_audit_member_artists_set(:L, :OWN, :MEM, ARRAY[:C2, :C2]::uuid[], '{"added":["c2"],"removed":["c1"],"count":1}') -> 'contact_ids' ->> 0,
  'c1460000-0000-4000-8000-0000000000c2');
SELECT public.check_eq('the list is now C2 only',
  (SELECT array_agg(contact_id) FROM public.member_artist_scopes WHERE org_id = :L AND user_id = :MEM), ARRAY[:C2]::uuid[]);
SELECT public.check_eq('member.artists_changed recorded',
  (SELECT count(*)::int FROM public.activity_events WHERE verb = 'member.artists_changed' AND subject_id = :MEM AND audit), 1);
SELECT public.check_raises('a contact of another org is refused by 139''s trigger',
  $$SELECT public.labelos_audit_member_artists_set('b1460000-0000-4000-8000-000000000001', 'a1460000-0000-4000-8000-000000000001', 'a1460000-0000-4000-8000-000000000002', ARRAY[gen_random_uuid()]::uuid[], '{}')$$,
  '.');
SELECT public.check_eq('the failed set left C2', (SELECT count(*)::int FROM public.member_artist_scopes WHERE org_id = :L AND user_id = :MEM), 1);

SELECT public.check_eq('invitation_create: a second pending one for the address is refused',
  public.labelos_audit_invitation_create(:L, :OWN, 'r146@local.test', 'member', '{}', '{}', repeat('c', 64), now() + interval '7 days', '{}') ->> 'error', 'pending');
SELECT public.check_eq('exactly one invitation.created for it',
  (SELECT count(*)::int FROM public.activity_events WHERE verb = 'invitation.created' AND payload ->> 'email' = 'r146@local.test'), 1);
SELECT public.check_eq('invitation_revoke revokes',
  public.labelos_audit_invitation_revoke(:L, :OWN, (SELECT id FROM public.org_invitations WHERE email = 'r146@local.test'), '{"email":"r146@local.test"}') ? 'revoked_at', true);
SELECT public.check_eq('and says not_pending the second time',
  public.labelos_audit_invitation_revoke(:L, :OWN, (SELECT id FROM public.org_invitations WHERE email = 'r146@local.test'), '{}') ->> 'error', 'not_pending');
SELECT public.check_eq('one invitation.revoked',
  (SELECT count(*)::int FROM public.activity_events WHERE verb = 'invitation.revoked' AND org_id = :L), 1);
SELECT public.check_eq('a revoked address may be invited again',
  public.labelos_audit_invitation_create(:L, :OWN, 'r146@local.test', 'member', '{}', '{}', repeat('d', 64), now() + interval '7 days', '{}') ? 'invitation', true);

SELECT public.check_eq('member_remove removes (and the list goes with them)',
  public.labelos_audit_member_remove(:L, :OWN, :MEM, '{"role":"member"}') ->> 'removed', 'true');
SELECT public.check_eq('gone', (SELECT count(*)::int FROM public.org_members WHERE org_id = :L AND user_id = :MEM), 0);
SELECT public.check_eq('list gone', (SELECT count(*)::int FROM public.member_artist_scopes WHERE org_id = :L AND user_id = :MEM), 0);
SELECT public.check_eq('member.removed recorded', (SELECT count(*)::int FROM public.activity_events WHERE verb = 'member.removed' AND subject_id = :MEM AND audit), 1);
SELECT public.check_eq('removing again says not_found',
  public.labelos_audit_member_remove(:L, :OWN, :MEM, '{}') ->> 'error', 'not_found');

-- ── org.created backfill ────────────────────────────────────────────────
-- L was created after the migration ran, so it has none: re-run the
-- migration's statement. It adds one for L (dated to the org, source
-- backfill), none for orgs that have one, and none the second time.

SELECT public.check_eq('L has no org.created yet', (SELECT count(*)::int FROM public.activity_events WHERE org_id = :L AND verb = 'org.created'), 0);
INSERT INTO public.activity_events (org_id, actor_id, verb, subject_type, subject_id, payload, audit, visibility, created_at)
SELECT o.id, o.created_by, 'org.created', 'org', o.id,
       jsonb_build_object('kind', o.kind, 'source', 'backfill'),
       false, 'internal', o.created_at
FROM public.organizations o
WHERE NOT EXISTS (SELECT 1 FROM public.activity_events e WHERE e.org_id = o.id AND e.verb = 'org.created');
SELECT public.check_eq('the backfill wrote one for L',
  (SELECT (count(*), min(payload ->> 'source'), bool_and(NOT audit))::text FROM public.activity_events WHERE org_id = :L AND verb = 'org.created'), '(1,backfill,t)');
SELECT public.check_eq('no org lacks an org.created',
  (SELECT count(*)::int FROM public.organizations o WHERE NOT EXISTS (SELECT 1 FROM public.activity_events e WHERE e.org_id = o.id AND e.verb = 'org.created')), 0);
