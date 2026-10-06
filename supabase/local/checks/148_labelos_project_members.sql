-- Behaviour checks for 148_labelos_project_members.sql, run by
-- scripts/local-db/check.sh (npm run db:local:check) in its own copy of the
-- throwaway database. Every check RAISEs on failure; psql stops at the first.
--
-- Cast:
--   label L   : owner OWN; AR (A&R: share.external); MKT (marketing: no
--               share.external); SC (A&R, artists-scoped to C1 only)
--   label L2  : owner X2
--   EXT_V / EXT_C / EXT_E : external viewer / contributor / editor of LP1
--   EXT_O     : an external member of L2's project only
--   NOBODY    : no membership anywhere
--   projects  : LP1 (artist C1), LP2 (artist C2) in L; XP1 in L2; PP1 is a
--               producer project (org_id NULL)
-- The point of this file: an external member reaches their ONE project and
-- nothing else, in SQL as well as in the routes; revocation and expiry are
-- immediate; and every audit function does its mutation AND its event in one
-- transaction, executable by service_role only.

\set OWN  '''a1480000-0000-4000-8000-000000000001'''
\set AR   '''a1480000-0000-4000-8000-000000000002'''
\set MKT  '''a1480000-0000-4000-8000-000000000003'''
\set SC   '''a1480000-0000-4000-8000-000000000004'''
\set X2   '''a1480000-0000-4000-8000-000000000005'''
\set EXTV '''a1480000-0000-4000-8000-000000000011'''
\set EXTC '''a1480000-0000-4000-8000-000000000012'''
\set EXTE '''a1480000-0000-4000-8000-000000000013'''
\set EXTO '''a1480000-0000-4000-8000-000000000014'''
\set NOBODY '''a1480000-0000-4000-8000-000000000015'''
\set UNV  '''a1480000-0000-4000-8000-000000000016'''
\set EXTP2 '''a1480000-0000-4000-8000-000000000017'''
\set L    '''b1480000-0000-4000-8000-000000000001'''
\set L2   '''b1480000-0000-4000-8000-000000000002'''
\set C1   '''c1480000-0000-4000-8000-0000000000c1'''
\set C2   '''c1480000-0000-4000-8000-0000000000c2'''
\set LP1  '''d1480000-0000-4000-8000-000000000011'''
\set LP2  '''d1480000-0000-4000-8000-000000000012'''
\set XP1  '''d1480000-0000-4000-8000-000000000021'''
\set PP1  '''d1480000-0000-4000-8000-000000000031'''
\set S1   '''e1480000-0000-4000-8000-000000000011'''

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  (:OWN, 'own148@local.test', now()), (:AR, 'ar148@local.test', now()), (:MKT, 'mkt148@local.test', now()),
  (:SC, 'sc148@local.test', now()), (:X2, 'x2148@local.test', now()),
  (:EXTV, 'extv148@local.test', now()), (:EXTC, 'extc148@local.test', now()), (:EXTE, 'exte148@local.test', now()),
  (:EXTO, 'exto148@local.test', now()), (:NOBODY, 'nobody148@local.test', now()),
  (:UNV, 'unv148@local.test', NULL), (:EXTP2, 'extp2148@local.test', now());
INSERT INTO public.organizations (id, name, slug, kind, created_by) VALUES
  (:L, 'Label L', 'label-l-148', 'label', :OWN),
  (:L2, 'Label L2', 'label-l2-148', 'label', :X2);
INSERT INTO public.org_members (org_id, user_id, role, functions, scope) VALUES
  (:L, :OWN, 'owner', '{}', 'org'),
  (:L, :AR, 'member', '{a_and_r}', 'org'),
  (:L, :MKT, 'member', '{marketing}', 'org'),
  (:L, :SC, 'member', '{a_and_r}', 'artists'),
  (:L2, :X2, 'owner', '{}', 'org');
INSERT INTO public.contacts (id, user_id, org_id, name, email, category) VALUES
  (:C1, NULL, :L, 'Nova', 'nova148@local.test', 'artist'),
  (:C2, NULL, :L, 'Kilo', 'kilo148@local.test', 'artist');
INSERT INTO public.member_artist_scopes (org_id, user_id, contact_id) VALUES (:L, :SC, :C1);
INSERT INTO public.projects (id, user_id, org_id, name, inbox_for_contact_id) VALUES
  (:LP1, NULL, :L, 'Nova EP', :C1),
  (:LP2, NULL, :L, 'Inbox · Kilo', :C2),
  (:XP1, NULL, :L2, 'L2 project', NULL);
INSERT INTO public.projects (id, user_id, name) VALUES (:PP1, '0b0e1a57-0000-4000-8000-000000000001', 'Producer project');
INSERT INTO public.tracks (id, user_id, org_id, created_by, title, type, audio_url, song_stage) VALUES
  (:S1, NULL, :L, :AR, 'Nova single', 'song', 'r2://private/s1', 'selected');
INSERT INTO public.project_tracks (project_id, track_id, position) VALUES (:LP1, :S1, 0);

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
CREATE FUNCTION public.as_user(p_user text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, false);
$$;
CREATE FUNCTION public.rows_seen(stmt text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  EXECUTE format('SELECT count(*) FROM (%s) q', stmt) INTO n;
  RETURN n;
END $$;
CREATE FUNCTION pg_temp.h(t text) RETURNS text LANGUAGE sql AS $$ SELECT encode(sha256(convert_to(t, 'UTF8')), 'hex') $$;
GRANT EXECUTE ON FUNCTION public.check_eq(text, anyelement, anyelement), public.check_raises(text, text, text),
  public.as_user(text), public.rows_seen(text) TO anon, authenticated, service_role;

-- ── The table: shape, constraints, triggers ─────────────────────────────

SELECT public.check_eq('RLS is on', (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.project_members'::regclass), true);
SELECT public.check_eq('the API roles have SELECT and nothing else',
  (SELECT string_agg(grantee || ':' || privilege_type, ',' ORDER BY grantee, privilege_type)
   FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = 'project_members' AND grantee IN ('anon', 'authenticated')),
  'authenticated:SELECT');

INSERT INTO public.project_members (org_id, project_id, user_id, role, allow_downloads, invited_by) VALUES
  (:L, :LP1, :EXTV, 'viewer', false, :AR),
  (:L, :LP1, :EXTC, 'contributor', false, :AR),
  (:L, :LP1, :EXTE, 'editor', false, :AR),
  (:L2, :XP1, :EXTO, 'viewer', false, :X2);
INSERT INTO public.project_members (org_id, project_id, user_id, role, allow_downloads, invited_by) VALUES
  (:L, :LP2, :EXTP2, 'viewer', false, :AR);

SELECT public.check_raises('a role outside the four is refused',
  format($$INSERT INTO public.project_members (org_id, project_id, user_id, role) VALUES (%L, %L, %L, 'owner')$$, 'b1480000-0000-4000-8000-000000000001', 'd1480000-0000-4000-8000-000000000012', 'a1480000-0000-4000-8000-000000000015'),
  'check constraint|violates');
SELECT public.check_raises('the project must be a project of the row''s org',
  format($$INSERT INTO public.project_members (org_id, project_id, user_id, role) VALUES (%L, %L, %L, 'viewer')$$, 'b1480000-0000-4000-8000-000000000001', 'd1480000-0000-4000-8000-000000000021', 'a1480000-0000-4000-8000-000000000015'),
  'not a project of organization');
SELECT public.check_raises('a producer project cannot be shared as an org project',
  format($$INSERT INTO public.project_members (org_id, project_id, user_id, role) VALUES (%L, %L, %L, 'viewer')$$, 'b1480000-0000-4000-8000-000000000001', 'd1480000-0000-4000-8000-000000000031', 'a1480000-0000-4000-8000-000000000015'),
  'not a project of organization');
SELECT public.check_raises('one membership per person per project',
  format($$INSERT INTO public.project_members (org_id, project_id, user_id, role) VALUES (%L, %L, %L, 'viewer')$$, 'b1480000-0000-4000-8000-000000000001', 'd1480000-0000-4000-8000-000000000011', 'a1480000-0000-4000-8000-000000000011'),
  'duplicate key');
SELECT public.check_raises('who / where never change',
  format($$UPDATE public.project_members SET project_id = %L WHERE user_id = %L$$, 'd1480000-0000-4000-8000-000000000012', 'a1480000-0000-4000-8000-000000000011'),
  'cannot change');
SELECT public.check_raises('org of a membership never changes',
  format($$UPDATE public.project_members SET org_id = %L WHERE user_id = %L$$, 'b1480000-0000-4000-8000-000000000002', 'a1480000-0000-4000-8000-000000000011'),
  'cannot change');

-- ── can_see_project ─────────────────────────────────────────────────────

SET ROLE authenticated;

SELECT public.as_user(:EXTV);
SELECT public.check_eq('an external member sees their project', public.can_see_project(:LP1), true);
SELECT public.check_eq('...not another project of the same org', public.can_see_project(:LP2), false);
SELECT public.check_eq('...not a project of another org', public.can_see_project(:XP1), false);
SELECT public.check_eq('...not a producer project', public.can_see_project(:PP1), false);

SELECT public.as_user(:EXTO);
SELECT public.check_eq('a member of L2''s project does not see L''s', public.can_see_project(:LP1), false);
SELECT public.check_eq('...and sees their own', public.can_see_project(:XP1), true);

SELECT public.as_user(:NOBODY);
SELECT public.check_eq('a stranger sees nothing', public.can_see_project(:LP1) OR public.can_see_project(:XP1), false);

SELECT public.as_user(:AR);
SELECT public.check_eq('an org member (whole org) sees every project of the org', public.can_see_project(:LP1) AND public.can_see_project(:LP2), true);
SELECT public.check_eq('...but not another org''s', public.can_see_project(:XP1), false);

SELECT public.as_user(:SC);
SELECT public.check_eq('an artists-scoped member sees the project of their artist', public.can_see_project(:LP1), true);
SELECT public.check_eq('...and not the other artist''s', public.can_see_project(:LP2), false);

RESET ROLE;
SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
SELECT public.check_eq('anon sees nothing', public.can_see_project(:LP1), false);
RESET ROLE;

-- Revocation and expiry take effect on the very next read.
SELECT public.as_user(:EXTV);
UPDATE public.project_members SET expires_at = now() - interval '1 second' WHERE user_id = :EXTV;
SET ROLE authenticated;
SELECT public.check_eq('an expired membership sees nothing', public.can_see_project(:LP1), false);
SELECT public.check_eq('...nor reads its own row', public.rows_seen('SELECT 1 FROM public.project_members'), 0);
RESET ROLE;
UPDATE public.project_members SET expires_at = now() + interval '1 day' WHERE user_id = :EXTV;
SET ROLE authenticated;
SELECT public.check_eq('a future expiry is live', public.can_see_project(:LP1), true);
RESET ROLE;
UPDATE public.organizations SET deleted_at = now() WHERE id = :L2;
SET ROLE authenticated;
SELECT public.as_user(:EXTO);
SELECT public.check_eq('a soft-deleted org takes its external members with it', public.can_see_project(:XP1), false);
RESET ROLE;
UPDATE public.organizations SET deleted_at = NULL WHERE id = :L2;

-- ── RLS on project_members: own row, or share.external ──────────────────

SET ROLE authenticated;
SELECT public.as_user(:EXTC);
SELECT public.check_eq('an external member reads their own row only',
  public.rows_seen('SELECT 1 FROM public.project_members'), 1);
SELECT public.check_eq('...and it is theirs',
  (SELECT user_id::text FROM public.project_members), 'a1480000-0000-4000-8000-000000000012');
SELECT public.as_user(:AR);
SELECT public.check_eq('an A&R member (share.external, whole org) reads every membership of L',
  public.rows_seen('SELECT 1 FROM public.project_members'), 4);
SELECT public.as_user(:SC);
SELECT public.check_eq('an artists-scoped A&R reads only the memberships of the projects their artist reaches (LP1, not LP2)',
  (SELECT string_agg(DISTINCT project_id::text, ',') FROM public.project_members), 'd1480000-0000-4000-8000-000000000011');
SELECT public.check_eq('...and three of them', public.rows_seen('SELECT 1 FROM public.project_members'), 3);
SELECT public.as_user(:MKT);
SELECT public.check_eq('marketing (no share.external) reads none',
  public.rows_seen('SELECT 1 FROM public.project_members'), 0);
SELECT public.as_user(:X2);
SELECT public.check_eq('another org''s owner reads only their own org''s',
  (SELECT string_agg(user_id::text, ',') FROM public.project_members), 'a1480000-0000-4000-8000-000000000014');
SELECT public.as_user(:NOBODY);
SELECT public.check_eq('a stranger reads none', public.rows_seen('SELECT 1 FROM public.project_members'), 0);

-- No writes through the API roles, whoever they are.
SELECT public.as_user(:OWN);
SELECT public.check_raises('an owner cannot insert a membership through the API',
  format($$INSERT INTO public.project_members (org_id, project_id, user_id, role) VALUES (%L, %L, %L, 'viewer')$$, 'b1480000-0000-4000-8000-000000000001', 'd1480000-0000-4000-8000-000000000012', 'a1480000-0000-4000-8000-000000000015'),
  'permission denied');
SELECT public.as_user(:EXTV);
SELECT public.check_raises('an external member cannot promote themselves',
  $$UPDATE public.project_members SET role = 'editor'$$, 'permission denied');
SELECT public.check_raises('...nor delete the row to reset it',
  $$DELETE FROM public.project_members$$, 'permission denied');

-- An external member's own JWT reads NONE of the project's material:
-- tracks, projects and the #44 rows keep 141's org_member_read/guard.
SELECT public.check_eq('...they read no track of the project', public.rows_seen('SELECT 1 FROM public.tracks'), 0);
SELECT public.check_eq('...no project', public.rows_seen('SELECT 1 FROM public.projects'), 0);
SELECT public.check_eq('...no project row of anyone',  public.rows_seen('SELECT 1 FROM public.project_tracks'), 0);
SELECT public.check_eq('...no file',  public.rows_seen('SELECT 1 FROM public.project_assets'), 0);
SELECT public.check_eq('...no comment',  public.rows_seen('SELECT 1 FROM public.project_comments'), 0);
SELECT public.check_eq('...no org contact (the artist)', public.rows_seen('SELECT 1 FROM public.contacts'), 0);
SELECT public.check_eq('...no activity', public.rows_seen('SELECT 1 FROM public.activity_events'), 0);
SELECT public.check_eq('...no org', public.rows_seen('SELECT 1 FROM public.organizations'), 0);
SELECT public.check_eq('...no invitation', public.rows_seen('SELECT 1 FROM public.org_invitations'), 0);
SELECT public.check_eq('...no org membership row', public.rows_seen('SELECT 1 FROM public.org_members'), 0);
RESET ROLE;

-- ── Grants on the new functions ─────────────────────────────────────────

SELECT public.check_eq('execute grants on ' || p.oid::regprocedure::text,
  (has_function_privilege('service_role', p.oid, 'EXECUTE'),
   has_function_privilege('authenticated', p.oid, 'EXECUTE'),
   has_function_privilege('anon', p.oid, 'EXECUTE'))::text,
  '(t,f,f)')
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname IN ('labelos_audit_project_invitation_create', 'labelos_audit_project_member_update',
                    'labelos_audit_project_member_remove', 'labelos_user_has_cap', 'labelos_accept_invitation',
                    'labelos_audit_invitation_create');
SELECT public.check_eq('the private project event helper has no caller but its owner',
  (SELECT (has_function_privilege('service_role', p.oid, 'EXECUTE'), has_function_privilege('authenticated', p.oid, 'EXECUTE'))::text
   FROM pg_proc p WHERE p.proname = 'labelos_audit_insert_project'),
  '(f,f)');
SELECT public.check_eq('can_see_project is callable by the roles a policy runs as',
  (has_function_privilege('authenticated', 'public.can_see_project(uuid)', 'EXECUTE'),
   has_function_privilege('anon', 'public.can_see_project(uuid)', 'EXECUTE'))::text, '(t,t)');
SET ROLE authenticated;
SELECT public.check_raises('authenticated cannot call project_member_remove',
  format($$SELECT public.labelos_audit_project_member_remove(%L, %L, %L, %L, '{}')$$, 'b1480000-0000-4000-8000-000000000001', 'a1480000-0000-4000-8000-000000000001', 'd1480000-0000-4000-8000-000000000011', 'a1480000-0000-4000-8000-000000000011'),
  'permission denied');
SELECT public.check_raises('authenticated cannot ask labelos_user_has_cap about anyone',
  format($$SELECT public.labelos_user_has_cap(%L, %L, 'share.external')$$, 'b1480000-0000-4000-8000-000000000001', 'a1480000-0000-4000-8000-000000000002'),
  'permission denied');
RESET ROLE;

-- ── labelos_user_has_cap is has_org_cap for someone else, and tidy ──────

SELECT public.check_eq('A&R holds share.external', public.labelos_user_has_cap(:L, :AR, 'share.external'), true);
SELECT public.check_eq('marketing does not', public.labelos_user_has_cap(:L, :MKT, 'share.external'), false);
SELECT public.check_eq('an external member holds nothing in the org', public.labelos_user_has_cap(:L, :EXTC, 'catalog.read'), false);
SELECT public.check_eq('...nor in an org they are not in', public.labelos_user_has_cap(:L2, :AR, 'share.external'), false);

-- The caller's own identity is put back, claims and the legacy sub alike.
SELECT set_config('request.jwt.claims', json_build_object('sub', :OWN::text, 'role', 'service_role')::text, false);
SELECT set_config('request.jwt.claim.sub', :OWN::text, false);
SELECT public.check_eq('a call about another user answers for THAT user', public.labelos_user_has_cap(:L, :AR, 'share.external'), true);
SELECT public.check_eq('...and leaves the caller as they were (claims)', auth.uid(), :OWN::uuid);
SELECT public.check_eq('...and the legacy sub', current_setting('request.jwt.claim.sub', true), :OWN::text);
SELECT public.check_eq('...even when the capability is refused', public.labelos_user_has_cap(:L, :MKT, 'share.external'), false);
SELECT public.check_eq('...the caller is still the caller', auth.uid(), :OWN::uuid);
SELECT set_config('request.jwt.claims', '{}', false);
SELECT set_config('request.jwt.claim.sub', '', false);

-- ── Project invitations: create, pending, revoke — each with its event ──

SELECT public.check_eq('create answers an invitation',
  (public.labelos_audit_project_invitation_create(:L, :AR, :LP1, 'guest@local.test', 'contributor', true, pg_temp.h('g1'),
     now() + interval '7 days', '{"email":"guest@local.test","role":"contributor","project_id":"d1480000-0000-4000-8000-000000000011"}'))->'invitation'->>'project_role',
  'contributor');
SELECT public.check_eq('the invitation row carries project, role and downloads',
  (SELECT (project_id::text, project_role, project_allow_downloads, role)::text FROM public.org_invitations WHERE token_hash = pg_temp.h('g1')),
  '(d1480000-0000-4000-8000-000000000011,contributor,t,member)');
SELECT public.check_eq('and exactly one audit event, with the project on it',
  (SELECT count(*)::int FROM public.activity_events WHERE verb = 'invitation.created' AND project_id = :LP1 AND audit AND visibility = 'internal'), 1);
SELECT public.check_eq('a second pending invitation to the same project and address is refused',
  (public.labelos_audit_project_invitation_create(:L, :AR, :LP1, 'guest@local.test', 'viewer', false, pg_temp.h('g1b'),
     now() + interval '7 days', '{}'))->>'error', 'pending');
SELECT public.check_eq('...but another project is fine',
  (public.labelos_audit_project_invitation_create(:L, :AR, :LP2, 'guest@local.test', 'viewer', false, pg_temp.h('g2'),
     now() + interval '7 days', '{}'))->'invitation'->>'project_role', 'viewer');
SELECT public.check_eq('a project of another org is not found',
  (public.labelos_audit_project_invitation_create(:L, :AR, :XP1, 'guest@local.test', 'viewer', false, pg_temp.h('g3'),
     now() + interval '7 days', '{}'))->>'error', 'not_found');
SELECT public.check_eq('a producer project is not found',
  (public.labelos_audit_project_invitation_create(:L, :AR, :PP1, 'guest@local.test', 'viewer', false, pg_temp.h('g4'),
     now() + interval '7 days', '{}'))->>'error', 'not_found');
SELECT public.check_raises('an unknown project role is refused',
  format($$SELECT public.labelos_audit_project_invitation_create(%L, %L, %L, 'z@local.test', 'owner', false, %L, now() + interval '7 days', '{}')$$,
    'b1480000-0000-4000-8000-000000000001', 'a1480000-0000-4000-8000-000000000002', 'd1480000-0000-4000-8000-000000000011', pg_temp.h('g5')),
  'unknown project role');
-- A failed audit insert undoes the invitation: nothing half-made.
SELECT public.check_raises('a payload that looks like a secret rolls the whole invitation back',
  format($$SELECT public.labelos_audit_project_invitation_create(%L, %L, %L, 'secret@local.test', 'viewer', false, %L, now() + interval '7 days', '{"token":"x"}')$$,
    'b1480000-0000-4000-8000-000000000001', 'a1480000-0000-4000-8000-000000000002', 'd1480000-0000-4000-8000-000000000011', pg_temp.h('g6')),
  'secret-looking');
SELECT public.check_eq('...no invitation row was left behind',
  (SELECT count(*)::int FROM public.org_invitations WHERE email = 'secret@local.test'), 0);

-- A pending PROJECT invitation does not block an ORG invitation to the same address, and the reverse.
SELECT public.check_eq('an org invitation is allowed beside a pending project invitation',
  (public.labelos_audit_invitation_create(:L, :OWN, 'guest@local.test', 'member', '{marketing}', '{}', pg_temp.h('org-g'),
     now() + interval '7 days', '{}'))->'invitation'->>'role', 'member');
SELECT public.check_eq('...and a second ORG invitation is still refused',
  (public.labelos_audit_invitation_create(:L, :OWN, 'guest@local.test', 'member', '{}', '{}', pg_temp.h('org-g2'),
     now() + interval '7 days', '{}'))->>'error', 'pending');

-- Revoke (146's function) revokes a project invitation with its event.
SELECT public.check_eq('revoke works on a project invitation',
  ((public.labelos_audit_invitation_revoke(:L, :AR,
     (SELECT id FROM public.org_invitations WHERE token_hash = pg_temp.h('g2')), '{"email":"guest@local.test"}'))->>'revoked_at') IS NOT NULL, true);

-- ── Accepting ───────────────────────────────────────────────────────────
-- guest@local.test → GUEST, a user with that address.
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('a1480000-0000-4000-8000-0000000000a1', 'guest@local.test', now());

SELECT public.check_eq('a stranger''s account cannot accept', public.labelos_accept_invitation(pg_temp.h('g1'), :NOBODY)->>'error', 'email_mismatch');
SELECT public.check_eq('a revoked project invitation is refused',
  public.labelos_accept_invitation(pg_temp.h('g2'), 'a1480000-0000-4000-8000-0000000000a1')->>'error', 'revoked');
SELECT public.check_eq('an unknown token is not found',
  public.labelos_accept_invitation(pg_temp.h('nope'), 'a1480000-0000-4000-8000-0000000000a1')->>'error', 'not_found');

-- Unverified address.
INSERT INTO public.org_invitations (org_id, email, role, project_id, project_role, token_hash, expires_at, invited_by)
VALUES (:L, 'unv148@local.test', 'member', :LP1, 'viewer', pg_temp.h('unv'), now() + interval '7 days', :AR);
SELECT public.check_eq('an unverified address cannot accept',
  public.labelos_accept_invitation(pg_temp.h('unv'), :UNV)->>'error', 'email_unverified');

-- Expired.
INSERT INTO public.org_invitations (org_id, email, role, project_id, project_role, token_hash, expires_at, invited_by)
VALUES (:L, 'guest@local.test', 'member', :LP2, 'viewer', pg_temp.h('old'), now() - interval '1 second', :AR);
SELECT public.check_eq('an expired project invitation is refused',
  public.labelos_accept_invitation(pg_temp.h('old'), 'a1480000-0000-4000-8000-0000000000a1')->>'error', 'expired');

-- The inviter lost share.external (marketing never had it): withdrawn.
INSERT INTO public.org_invitations (org_id, email, role, project_id, project_role, token_hash, expires_at, invited_by)
VALUES (:L, 'guest@local.test', 'member', :LP2, 'viewer', pg_temp.h('mkt'), now() + interval '7 days', :MKT);
SELECT public.check_eq('an invitation from someone without share.external reads as withdrawn',
  public.labelos_accept_invitation(pg_temp.h('mkt'), 'a1480000-0000-4000-8000-0000000000a1')->>'error', 'revoked');
SELECT public.check_eq('...and left no membership',
  (SELECT count(*)::int FROM public.project_members WHERE user_id = 'a1480000-0000-4000-8000-0000000000a1'), 0);

-- The real thing.
SELECT public.check_eq('accepting joins the PROJECT',
  public.labelos_accept_invitation(pg_temp.h('g1'), 'a1480000-0000-4000-8000-0000000000a1'),
  '{"status": "joined", "org_id": "b1480000-0000-4000-8000-000000000001", "project_id": "d1480000-0000-4000-8000-000000000011"}'::jsonb);
SELECT public.check_eq('the membership has the invited role and downloads setting',
  (SELECT (role, allow_downloads, invited_by::text)::text FROM public.project_members WHERE user_id = 'a1480000-0000-4000-8000-0000000000a1' AND project_id = :LP1),
  '(contributor,t,a1480000-0000-4000-8000-000000000002)');
SELECT public.check_eq('the invitee is NOT an org member',
  (SELECT count(*)::int FROM public.org_members WHERE user_id = 'a1480000-0000-4000-8000-0000000000a1'), 0);
SELECT public.check_eq('project.member_added is recorded, once, with the project',
  (SELECT count(*)::int FROM public.activity_events
   WHERE verb = 'project.member_added' AND project_id = :LP1 AND actor_id = 'a1480000-0000-4000-8000-0000000000a1' AND audit), 1);
SELECT public.check_eq('and no member.joined (that is the org path)',
  (SELECT count(*)::int FROM public.activity_events WHERE verb = 'member.joined' AND actor_id = 'a1480000-0000-4000-8000-0000000000a1'), 0);
SELECT public.check_eq('accepting twice is idempotent for the member',
  public.labelos_accept_invitation(pg_temp.h('g1'), 'a1480000-0000-4000-8000-0000000000a1')->>'status', 'already_member');
SELECT public.check_eq('...without a second event',
  (SELECT count(*)::int FROM public.activity_events WHERE verb = 'project.member_added' AND actor_id = 'a1480000-0000-4000-8000-0000000000a1'), 1);
SET ROLE authenticated;
SELECT public.as_user('a1480000-0000-4000-8000-0000000000a1');
SELECT public.check_eq('the new member sees their project through can_see_project', public.can_see_project(:LP1), true);
SELECT public.check_eq('...and not its sibling', public.can_see_project(:LP2), false);
RESET ROLE;

-- An EXPIRED membership is renewed by a new invitation (role, downloads, expiry cleared);
-- a LIVE one keeps what it has.
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES ('a1480000-0000-4000-8000-0000000000c1', 'back@local.test', now());
INSERT INTO public.project_members (org_id, project_id, user_id, role, allow_downloads, expires_at, invited_by)
VALUES (:L, :LP1, 'a1480000-0000-4000-8000-0000000000c1', 'viewer', false, now() - interval '1 day', :AR);
INSERT INTO public.org_invitations (org_id, email, role, project_id, project_role, project_allow_downloads, token_hash, expires_at, invited_by)
VALUES (:L, 'back@local.test', 'member', :LP1, 'editor', true, pg_temp.h('back'), now() + interval '7 days', :AR);
SELECT public.check_eq('a new invitation to an EXPIRED member joins them again',
  public.labelos_accept_invitation(pg_temp.h('back'), 'a1480000-0000-4000-8000-0000000000c1')->>'status', 'joined');
SELECT public.check_eq('...with the invited role and downloads, and no expiry',
  (SELECT (role, allow_downloads, expires_at IS NULL)::text FROM public.project_members WHERE user_id = 'a1480000-0000-4000-8000-0000000000c1'), '(editor,t,t)');
SELECT public.check_eq('...and the event says it was a renewal',
  (SELECT payload->>'renewed' FROM public.activity_events WHERE verb = 'project.member_added' AND actor_id = 'a1480000-0000-4000-8000-0000000000c1'), 'true');
INSERT INTO public.org_invitations (org_id, email, role, project_id, project_role, project_allow_downloads, token_hash, expires_at, invited_by)
VALUES (:L, 'back@local.test', 'member', :LP1, 'viewer', false, pg_temp.h('back2'), now() + interval '7 days', :AR);
SELECT public.check_eq('an invitation to someone already LIVE on the project changes nothing',
  public.labelos_accept_invitation(pg_temp.h('back2'), 'a1480000-0000-4000-8000-0000000000c1')->>'status', 'already_member');
SELECT public.check_eq('...their role stays',
  (SELECT role FROM public.project_members WHERE user_id = 'a1480000-0000-4000-8000-0000000000c1'), 'editor');

UPDATE public.project_members SET expires_at = now() - interval '1 second' WHERE user_id = 'a1480000-0000-4000-8000-0000000000c1';
SELECT public.check_eq('an expired member clicking a SPENT link is told it is used, not that they still have access',
  public.labelos_accept_invitation(pg_temp.h('back'), 'a1480000-0000-4000-8000-0000000000c1')->>'error', 'used');
DELETE FROM public.project_members WHERE user_id = 'a1480000-0000-4000-8000-0000000000c1';

-- The same account may later be removed; and the spent link does not readmit.
SELECT public.check_eq('remove answers removed',
  (public.labelos_audit_project_member_remove(:L, :AR, :LP1, 'a1480000-0000-4000-8000-0000000000a1', '{"role":"contributor"}'))->>'removed', 'true');
SELECT public.check_eq('...with its event',
  (SELECT count(*)::int FROM public.activity_events WHERE verb = 'project.member_removed' AND project_id = :LP1 AND audit), 1);
SELECT public.check_eq('...and the spent link does not readmit',
  public.labelos_accept_invitation(pg_temp.h('g1'), 'a1480000-0000-4000-8000-0000000000a1')->>'error', 'used');
SELECT public.check_eq('removing someone who is not a member is not_found',
  (public.labelos_audit_project_member_remove(:L, :AR, :LP1, 'a1480000-0000-4000-8000-0000000000a1', '{}'))->>'error', 'not_found');
SET ROLE authenticated;
SELECT public.as_user('a1480000-0000-4000-8000-0000000000a1');
SELECT public.check_eq('removed: the very next read sees nothing', public.can_see_project(:LP1), false);
RESET ROLE;

-- ── Member update ───────────────────────────────────────────────────────

SELECT public.check_eq('update answers the new role',
  (public.labelos_audit_project_member_update(:L, :AR, :LP1, :EXTV, '{"role":"commenter","allow_downloads":true}',
     '{"role":{"from":"viewer","to":"commenter"}}'))->'member'->>'role', 'commenter');
SELECT public.check_eq('...and the row has it',
  (SELECT (role, allow_downloads)::text FROM public.project_members WHERE user_id = :EXTV), '(commenter,t)');
SELECT public.check_eq('...with one project.member_changed event',
  (SELECT count(*)::int FROM public.activity_events WHERE verb = 'project.member_changed' AND project_id = :LP1 AND audit), 1);
SELECT public.check_eq('an expiry can be set and cleared',
  (public.labelos_audit_project_member_update(:L, :AR, :LP1, :EXTV, '{"expires_at":null}', '{}'))->'member'->>'expires_at', NULL);
SELECT public.check_eq('updating a non-member is not_found',
  (public.labelos_audit_project_member_update(:L, :AR, :LP1, :NOBODY, '{"role":"viewer"}', '{}'))->>'error', 'not_found');
SELECT public.check_raises('an empty patch is refused',
  format($$SELECT public.labelos_audit_project_member_update(%L, %L, %L, %L, '{}', '{}')$$,
    'b1480000-0000-4000-8000-000000000001', 'a1480000-0000-4000-8000-000000000002', 'd1480000-0000-4000-8000-000000000011', 'a1480000-0000-4000-8000-000000000011'),
  'empty project member patch');
SELECT public.check_raises('a failed audit insert undoes the role change',
  format($$SELECT public.labelos_audit_project_member_update(%L, %L, %L, %L, '{"role":"editor"}', '{"secret":"x"}')$$,
    'b1480000-0000-4000-8000-000000000001', 'a1480000-0000-4000-8000-000000000002', 'd1480000-0000-4000-8000-000000000011', 'a1480000-0000-4000-8000-000000000011'),
  'secret-looking');
SELECT public.check_eq('...the role is what it was',
  (SELECT role FROM public.project_members WHERE user_id = :EXTV), 'commenter');
SELECT public.check_raises('a failed audit insert undoes a removal',
  format($$SELECT public.labelos_audit_project_member_remove(%L, %L, %L, %L, '{"password":"x"}')$$,
    'b1480000-0000-4000-8000-000000000001', 'a1480000-0000-4000-8000-000000000002', 'd1480000-0000-4000-8000-000000000011', 'a1480000-0000-4000-8000-000000000012'),
  'secret-looking');
SELECT public.check_eq('...the member is still there',
  (SELECT count(*)::int FROM public.project_members WHERE user_id = :EXTC), 1);

-- ── The org path of accept is still 139's ───────────────────────────────
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('a1480000-0000-4000-8000-0000000000b1', 'orgguest@local.test', now());
SELECT public.labelos_audit_invitation_create(:L, :OWN, 'orgguest@local.test', 'member', '{marketing}', '{}', pg_temp.h('og'), now() + interval '7 days', '{}');
SELECT public.check_eq('an org invitation still makes an org member',
  public.labelos_accept_invitation(pg_temp.h('og'), 'a1480000-0000-4000-8000-0000000000b1')->>'status', 'joined');
SELECT public.check_eq('...in org_members, with the function',
  (SELECT (role, functions)::text FROM public.org_members WHERE user_id = 'a1480000-0000-4000-8000-0000000000b1'), '(member,{marketing})');
SELECT public.check_eq('...and no project membership',
  (SELECT count(*)::int FROM public.project_members WHERE user_id = 'a1480000-0000-4000-8000-0000000000b1'), 0);

-- Deleting a project takes its memberships and invitations with it.
DELETE FROM public.projects WHERE id = :LP2;
SELECT public.check_eq('a deleted project leaves no invitations',
  (SELECT count(*)::int FROM public.org_invitations WHERE project_id = :LP2), 0);

-- D3: what a leaver uploaded stays in the project, credited to them.
INSERT INTO public.tracks (id, user_id, org_id, created_by, title, type, audio_url)
VALUES ('e1480000-0000-4000-8000-000000000099', NULL, :L, :EXTC, 'Version by EXTC', 'song', 'r2://private/v1');
INSERT INTO public.project_tracks (project_id, track_id, position) VALUES (:LP1, 'e1480000-0000-4000-8000-000000000099', 1);
SELECT public.labelos_audit_project_member_remove(:L, :AR, :LP1, :EXTC, '{}');
SELECT public.check_eq('the leaver''s upload is still in the project, credited to them (D3)',
  (SELECT (t.created_by::text, pt.project_id::text)::text
   FROM public.tracks t JOIN public.project_tracks pt ON pt.track_id = t.id
   WHERE t.id = 'e1480000-0000-4000-8000-000000000099'),
  '(a1480000-0000-4000-8000-000000000012,d1480000-0000-4000-8000-000000000011)');

NOTIFY pgrst, 'reload schema';
