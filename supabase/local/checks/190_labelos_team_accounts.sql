-- Behaviour checks for 190_labelos_team_accounts.sql (doc 25 phase 1), run by
-- scripts/local-db/check.sh (npm run db:local:check). Every check RAISEs on failure.
--
-- Proven:
--   - create writes the membership (scope from role / artist list), the
--     managed row and `member.account_created`, and refuses a second create
--     and an owner role; the seat cap holds;
--   - reset / switch-off are refused for: the actor themselves, an account
--     the org did not create, an account that is also in another org, the
--     producer, an owner when the actor is an admin, and an ADMIN when the
--     actor is an admin (peer admins cannot sign in as each other);
--   - an allowed reset flags must_change_password, writes its event and
--     revokes every session; a switch-off revokes them too; the person's own
--     change clears the flag and revokes every session but the current one;
--   - labelos_my_password_pending answers about the caller only, and anon
--     cannot call it;
--   - the API roles cannot execute any other function or read the table at
--     all (service-role only; every read is a server route).

\set O  '''a1900000-0000-4000-8000-000000000001'''
\set AD '''a1900000-0000-4000-8000-000000000002'''
\set MK '''a1900000-0000-4000-8000-000000000003'''
\set SH '''a1900000-0000-4000-8000-000000000004'''
\set PR '''a1900000-0000-4000-8000-000000000005'''
\set NM '''a1900000-0000-4000-8000-000000000006'''
\set A2 '''a1900000-0000-4000-8000-000000000007'''
\set S1 '''c1900000-0000-4000-8000-000000000001'''
\set S2 '''c1900000-0000-4000-8000-000000000002'''
\set S3 '''c1900000-0000-4000-8000-000000000003'''
\set LA '''b1900000-0000-4000-8000-000000000001'''
\set LB '''b1900000-0000-4000-8000-000000000002'''

INSERT INTO auth.users (id, email) VALUES
  (:O, 'o190@local.test'), (:AD, 'ad190@local.test'), (:MK, 'mk190@local.test'),
  (:SH, 'sh190@local.test'), (:PR, 'pr190@local.test'), (:NM, 'nm190@local.test'),
  (:A2, 'a2190@local.test');
INSERT INTO public.creator_profiles (user_id, display_name, slug) VALUES (:PR, 'Prod 190', 'prod-190');
INSERT INTO public.organizations (id, name, slug, kind, created_by) VALUES
  (:LA, 'Label A', 'label-a-190', 'label', :O),
  (:LB, 'Label B', 'label-b-190', 'label', :O);
INSERT INTO public.org_members (org_id, user_id, role, functions, scope) VALUES
  (:LA, :O, 'owner', '{}', 'org'),
  (:LB, :O, 'owner', '{}', 'org'),
  (:LA, :AD, 'admin', '{}', 'org');

CREATE FUNCTION public.check_eq(label text, got anyelement, want anyelement) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'CHECK FAILED: % — got %, want %', label, got, want;
  END IF;
END $$;

SET ROLE service_role;
SELECT public.check_eq('create marketing', public.labelos_audit_team_account_create(:LA, :O, :MK, 'member', '{marketing}', '{}', '{"role":"member"}'), '{"ok": true}'::jsonb);
SELECT public.check_eq('create twice', public.labelos_audit_team_account_create(:LA, :O, :MK, 'member', '{marketing}', '{}', '{}'), '{"error": "already_member"}'::jsonb);
SELECT public.check_eq('never owner', public.labelos_audit_team_account_create(:LA, :O, :NM, 'owner', '{}', '{}', '{}'), '{"error": "bad_role"}'::jsonb);
-- SH: created by A, but also a member of B (joined there on their own).
SELECT public.check_eq('create shared', public.labelos_audit_team_account_create(:LA, :O, :SH, 'member', '{legal}', '{}', '{}'), '{"ok": true}'::jsonb);
RESET ROLE;
INSERT INTO public.org_members (org_id, user_id, role, functions, scope) VALUES (:LB, :SH, 'member', '{}', 'org');
-- PR: the producer, who somehow ended up managed by A (data only, to prove the guard).
INSERT INTO public.org_members (org_id, user_id, role, functions, scope) VALUES (:LA, :PR, 'member', '{}', 'org');
INSERT INTO public.org_managed_accounts (org_id, user_id, created_by) VALUES (:LA, :PR, :O);

SELECT public.check_eq('membership row', (SELECT role || ':' || scope || ':' || array_to_string(functions, ',') FROM public.org_members WHERE org_id = :LA AND user_id = :MK), 'member:org:marketing');
SELECT public.check_eq('managed row flags a change', (SELECT must_change_password FROM public.org_managed_accounts WHERE user_id = :MK), true);
SELECT public.check_eq('created event', (SELECT count(*) FROM public.activity_events WHERE org_id = :LA AND verb = 'member.account_created' AND subject_id = :MK), 1::bigint);
SELECT public.check_eq('event carries no secret', (SELECT count(*) FROM public.activity_events WHERE verb LIKE 'member.%' AND payload::text ~* 'password'), 0::bigint);

SET ROLE service_role;
SELECT public.check_eq('self', public.labelos_team_account_target(:LA, :MK, :MK), 'self');
SELECT public.check_eq('not managed (the admin joined some other way)', public.labelos_team_account_target(:LA, :O, :AD), 'not_managed');
SELECT public.check_eq('in another org', public.labelos_team_account_target(:LA, :O, :SH), 'shared');
SELECT public.check_eq('the producer', public.labelos_team_account_target(:LA, :O, :PR), 'shared');
SELECT public.check_eq('other org cannot touch it', public.labelos_team_account_target(:LB, :O, :MK), 'not_managed');
SELECT public.check_eq('allowed', public.labelos_team_account_target(:LA, :AD, :MK), NULL::text);
SELECT public.check_eq('reset refused when shared', public.labelos_audit_team_account_reset(:LA, :O, :SH), '{"error": "shared"}'::jsonb);
RESET ROLE;
UPDATE public.org_managed_accounts SET must_change_password = false WHERE user_id = :MK;
-- MK is signed in on two devices; the org's owner is signed in too.
INSERT INTO auth.sessions (id, user_id) VALUES (:S1, :MK), (:S2, :MK), (:S3, :O);
SET ROLE service_role;
SELECT public.check_eq('reset', public.labelos_audit_team_account_reset(:LA, :AD, :MK), '{"ok": true, "sessions_revoked": true}'::jsonb);
RESET ROLE;
SELECT public.check_eq('reset ends every sign-in of that person', (SELECT count(*) FROM auth.sessions WHERE user_id = :MK), 0::bigint);
SELECT public.check_eq('and nobody else''s', (SELECT count(*) FROM auth.sessions WHERE user_id = :O), 1::bigint);

-- Flagged: the person's own session reports it, and only about themself.
SELECT set_config('request.jwt.claims', json_build_object('sub', :MK, 'role', 'authenticated')::text, false);
SET ROLE authenticated;
SELECT public.check_eq('pending for the caller', public.labelos_my_password_pending(), true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object('sub', :AD, 'role', 'authenticated')::text, false);
SET ROLE authenticated;
SELECT public.check_eq('not pending for someone else', public.labelos_my_password_pending(), false);
RESET ROLE;
SELECT set_config('request.jwt.claims', '', false);

-- They change it from one of two new sessions: the other one ends.
INSERT INTO auth.sessions (id, user_id) VALUES (:S1, :MK), (:S2, :MK);
SET ROLE service_role;
SELECT public.check_eq('own change answers the org', public.labelos_team_account_password_changed(:MK, :S1), 'b1900000-0000-4000-8000-000000000001'::uuid);
SELECT public.check_eq('own change, unmanaged', public.labelos_team_account_password_changed(:NM), NULL::uuid);
RESET ROLE;
SELECT public.check_eq('own change keeps only the current session', (SELECT array_agg(id)::text FROM auth.sessions WHERE user_id = :MK), '{c1900000-0000-4000-8000-000000000001}');
SELECT set_config('request.jwt.claims', json_build_object('sub', :MK, 'role', 'authenticated')::text, false);
SET ROLE authenticated;
SELECT public.check_eq('no longer pending', public.labelos_my_password_pending(), false);
RESET ROLE;
SELECT set_config('request.jwt.claims', '', false);

SET ROLE service_role;
SELECT public.check_eq('switch off', public.labelos_audit_team_account_set_disabled(:LA, :O, :MK, true), '{"ok": true, "sessions_revoked": true}'::jsonb);
RESET ROLE;
SELECT public.check_eq('switch-off ends the last sign-in', (SELECT count(*) FROM auth.sessions WHERE user_id = :MK), 0::bigint);
SELECT public.check_eq('reset flagged then cleared', (SELECT must_change_password FROM public.org_managed_accounts WHERE user_id = :MK), false);
SELECT public.check_eq('disabled', (SELECT disabled_at IS NOT NULL FROM public.org_managed_accounts WHERE user_id = :MK), true);
SELECT public.check_eq('events', (SELECT count(*) FROM public.activity_events WHERE org_id = :LA AND verb IN ('member.password_reset', 'member.account_disabled') AND audit), 2::bigint);

-- An owner cannot be reset by an admin (data only: create never makes an owner).
UPDATE public.org_members SET role = 'owner' WHERE org_id = :LA AND user_id = :MK;
SET ROLE service_role;
SELECT public.check_eq('owner only by an owner', public.labelos_team_account_target(:LA, :AD, :MK), 'owner_only');
RESET ROLE;
UPDATE public.org_members SET role = 'member' WHERE org_id = :LA AND user_id = :MK;

-- Peer admins: an admin account the org made is reset or switched off only by an owner.
SET ROLE service_role;
SELECT public.check_eq('create an admin account', public.labelos_audit_team_account_create(:LA, :O, :A2, 'admin', '{}', '{}', '{}'), '{"ok": true}'::jsonb);
SELECT public.check_eq('an admin cannot reset an admin', public.labelos_team_account_target(:LA, :AD, :A2), 'owner_only');
SELECT public.check_eq('nor switch one off', public.labelos_audit_team_account_set_disabled(:LA, :AD, :A2, true), '{"error": "owner_only"}'::jsonb);
SELECT public.check_eq('an owner can', public.labelos_team_account_target(:LA, :O, :A2), NULL::text);
RESET ROLE;

-- Seat cap: staff in A (O, AD, MK, SH, PR, A2 → 6) against a cap of 5.
INSERT INTO public.org_entitlements (org_id, modules, max_seats) VALUES (:LA, '{}', 5);
SET ROLE service_role;
SELECT public.check_eq('seat cap', public.labelos_audit_team_account_create(:LA, :O, :NM, 'member', '{}', '{}', '{}'), '{"error": "seat_limit"}'::jsonb);
SELECT public.check_eq('an artist takes no seat', public.labelos_audit_team_account_create(:LA, :O, :NM, 'artist', '{}', '{}', '{}'), '{"ok": true}'::jsonb);
RESET ROLE;
SELECT public.check_eq('artist is artist-scoped', (SELECT scope FROM public.org_members WHERE org_id = :LA AND user_id = :NM), 'artists');


DO $$
DECLARE r text; denied int := 0;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    EXECUTE format('SET LOCAL ROLE %I', r);
    BEGIN
      PERFORM public.labelos_audit_team_account_create('b1900000-0000-4000-8000-000000000001', 'a1900000-0000-4000-8000-000000000001', 'a1900000-0000-4000-8000-000000000006', 'admin', '{}', '{}', '{}');
      RAISE EXCEPTION 'CHECK FAILED: % created', r;
    EXCEPTION WHEN insufficient_privilege THEN denied := denied + 1;
    END;
    BEGIN
      PERFORM public.labelos_audit_team_account_reset('b1900000-0000-4000-8000-000000000001', 'a1900000-0000-4000-8000-000000000001', 'a1900000-0000-4000-8000-000000000003');
      RAISE EXCEPTION 'CHECK FAILED: % reset', r;
    EXCEPTION WHEN insufficient_privilege THEN denied := denied + 1;
    END;
    BEGIN
      PERFORM public.labelos_revoke_auth_sessions('a1900000-0000-4000-8000-000000000001');
      RAISE EXCEPTION 'CHECK FAILED: % revoked sessions', r;
    EXCEPTION WHEN insufficient_privilege THEN denied := denied + 1;
    END;
    BEGIN
      PERFORM count(*) FROM public.org_managed_accounts;
      RAISE EXCEPTION 'CHECK FAILED: % read', r;
    EXCEPTION WHEN insufficient_privilege THEN denied := denied + 1;
    END;
    RESET ROLE;
  END LOOP;
  IF denied <> 8 THEN RAISE EXCEPTION 'CHECK FAILED: expected 8 denials, got %', denied; END IF;
END $$;

-- The self-check is for signed-in callers only.
DO $$
BEGIN
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM public.labelos_my_password_pending();
    RAISE EXCEPTION 'CHECK FAILED: anon asked';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
END $$;

-- Deleting the org removes its managed rows.
DELETE FROM public.organizations WHERE id = :LA;
SELECT public.check_eq('cascade', (SELECT count(*) FROM public.org_managed_accounts WHERE org_id = :LA), 0::bigint);
