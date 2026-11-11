-- Behaviour checks for 199_labelos_press_share_audit.sql (review G16), run by
-- scripts/local-db/check.sh (npm run db:local:check). Every check RAISEs on failure.
--
-- Proven: service_role only; create stores the SHA-256 hash and writes ONE audit `press_kit.shared` event in the same
-- transaction (no token anywhere); the live-link cap; unknown kit / other org is not_found; revoke stamps once, writes
-- `press_kit.share_revoked`, a second revoke / a wrong kit is not_found with no second event; an event that cannot be
-- written (a secret-looking payload key) leaves no link / no revoke behind; the events are audit = true, internal.

\set P  '''0b0e1a57-0000-4000-8000-000000000001'''
\set O  '''a1990000-0000-4000-8000-000000000001'''
\set M  '''a1990000-0000-4000-8000-000000000002'''
\set X  '''a1990000-0000-4000-8000-000000000003'''
\set L  '''b1990000-0000-4000-8000-000000000001'''
\set L2 '''b1990000-0000-4000-8000-000000000002'''
\set C1 '''c1990000-0000-4000-8000-0000000000c1'''
\set CP '''c1990000-0000-4000-8000-0000000000c2'''
\set CS '''c1990000-0000-4000-8000-0000000000c3'''
\set CX '''c1990000-0000-4000-8000-0000000000c4'''
\set PR '''d1990000-0000-4000-8000-0000000000d1'''
\set PR2 '''d1990000-0000-4000-8000-0000000000d2'''
\set R  '''e1990000-0000-4000-8000-0000000000e1'''
\set R2 '''e1990000-0000-4000-8000-0000000000e2'''
\set KIT '''f1990000-0000-4000-8000-0000000000f1'''
\set A1 '''91990000-0000-4000-8000-0000000000a1'''
\set A2 '''91990000-0000-4000-8000-0000000000a2'''
\set A3 '''91990000-0000-4000-8000-0000000000a3'''
\set A4 '''91990000-0000-4000-8000-0000000000a4'''

INSERT INTO auth.users (id, email) VALUES
  (:O, 'o199@local.test'), (:M, 'm199@local.test'), (:X, 'x199@local.test');
INSERT INTO public.organizations (id, name, slug, kind, created_by, settings) VALUES
  (:L, 'Label L', 'label-l-199', 'label', :O, '{}'),
  (:L2, 'Label L2', 'label-l2-199', 'label', :X, '{}');
INSERT INTO public.org_members (org_id, user_id, role, functions, scope, cap_grants) VALUES
  (:L, :O, 'owner', '{}', 'org', '{}'),
  (:L, :M, 'member', '{pr}', 'org', '{}'),
  (:L2, :X, 'owner', '{}', 'org', '{}');
INSERT INTO public.contacts (id, user_id, org_id, name, email, category, secondary_category) VALUES
  (:C1, NULL, :L, 'Nova', 'nova199@local.test', 'artist', NULL),
  (:CP, NULL, :L, 'Pat Press', 'pat199@local.test', 'press', NULL),
  (:CS, NULL, :L, 'Sam Second', 'sam199@local.test', 'artist', 'press'),
  (:CX, NULL, :L2, 'Xena Press', 'xena199@local.test', 'press', NULL);
INSERT INTO public.projects (id, org_id, user_id, name, inbox_for_contact_id) VALUES
  (:PR, :L, NULL, 'Inbox', :C1),
  (:PR2, :L, NULL, 'Other project', NULL);
INSERT INTO public.releases (id, org_id, project_id, contact_id, title, created_by) VALUES
  (:R, :L, :PR, :C1, 'Night Shift', :O),
  (:R2, :L, :PR2, :C1, 'Other release', :O);
INSERT INTO public.project_assets (id, user_id, created_by, project_id, kind, sensitivity, url) VALUES
  (:A1, NULL, :O, :PR, 'photo', 'normal', 'r2://private/p1'),
  (:A2, NULL, :O, :PR, 'artwork', 'restricted', 'r2://private/p2'),
  (:A3, NULL, :O, :PR2, 'photo', 'normal', 'r2://private/p3'),
  (:A4, NULL, :O, :PR, 'lyrics', 'normal', 'r2://private/p4');

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



SELECT public.check_eq('API roles cannot execute either function',
  (SELECT count(*)::int FROM pg_proc p WHERE p.proname IN ('labelos_audit_press_share_create','labelos_audit_press_share_revoke')
    AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE') OR NOT has_function_privilege('service_role', p.oid, 'EXECUTE'))), 0);

INSERT INTO public.press_kits (id, org_id, release_id, created_by) VALUES (:KIT, :L, :R, :O);
CREATE TEMP TABLE c1 AS SELECT public.labelos_audit_press_share_create(:L, :O, :KIT, repeat('a', 64), 'Pitchfork', now() + interval '7 days', 2, jsonb_build_object('artist_id', :C1, 'project_id', :PR), '{}') AS r;
SELECT public.check_eq('a share was made', (SELECT r -> 'share' ->> 'label' FROM c1), 'Pitchfork');
SELECT public.check_eq('stored by hash only', (SELECT token_hash FROM public.press_kit_shares WHERE org_id = :L), repeat('a', 64));
SELECT public.check_eq('one audit event with the share id and no token',
  (SELECT count(*)::int FROM public.activity_events WHERE org_id = :L AND verb = 'press_kit.shared' AND audit AND visibility = 'internal'
     AND subject_id = :R AND release_id = :R AND artist_id = :C1 AND project_id = :PR
     AND payload = jsonb_build_object('shareId', (SELECT r -> 'share' ->> 'id' FROM c1), 'expires', true)), 1);

SELECT public.check_eq('an unknown kit is not_found',
  (SELECT public.labelos_audit_press_share_create(:L, :O, 'f1990000-0000-4000-8000-0000000000ff', repeat('b', 64), 'x', NULL, 2, '{}', '{}') ->> 'error'), 'not_found');
SELECT public.check_eq('another org cannot reach the kit',
  (SELECT public.labelos_audit_press_share_create(:L2, :X, :KIT, repeat('b', 64), 'x', NULL, 2, '{}', '{}') ->> 'error'), 'not_found');
SELECT public.check_raises('a secret-looking payload key is refused and leaves no link',
  format($$SELECT public.labelos_audit_press_share_create(%L, %L, %L, %L, 'x', NULL, 2, '{}', '{"token":"x"}')$$, 'b1990000-0000-4000-8000-000000000001', 'a1990000-0000-4000-8000-000000000001', 'f1990000-0000-4000-8000-0000000000f1', repeat('c', 64)),
  'secret-looking');
SELECT public.check_eq('still one link', (SELECT count(*)::int FROM public.press_kit_shares WHERE org_id = :L), 1);
SELECT public.labelos_audit_press_share_create(:L, :O, :KIT, repeat('d', 64), 'Second', NULL, 2, '{}', '{}');
SELECT public.check_eq('the cap on live links', (SELECT public.labelos_audit_press_share_create(:L, :O, :KIT, repeat('e', 64), 'Third', NULL, 2, '{}', '{}') ->> 'error'), 'full');
SELECT public.check_eq('a full kit wrote no third link or event',
  (SELECT count(*)::int FROM public.press_kit_shares WHERE org_id = :L) * 10 + (SELECT count(*)::int FROM public.activity_events WHERE verb = 'press_kit.shared' AND org_id = :L), 22);

SELECT public.check_eq('revoke answers the share',
  (SELECT public.labelos_audit_press_share_revoke(:L, :O, :KIT, (SELECT (r -> 'share' ->> 'id')::uuid FROM c1), jsonb_build_object('artist_id', :C1, 'project_id', :PR), '{}') -> 'share' ->> 'id'),
  (SELECT r -> 'share' ->> 'id' FROM c1));
SELECT public.check_eq('stamped with the actor', (SELECT revoked_by FROM public.press_kit_shares WHERE token_hash = repeat('a', 64)), :O::uuid);
SELECT public.check_eq('one revoke event, audit, internal',
  (SELECT count(*)::int FROM public.activity_events WHERE org_id = :L AND verb = 'press_kit.share_revoked' AND audit AND visibility = 'internal' AND release_id = :R
     AND payload = jsonb_build_object('shareId', (SELECT r -> 'share' ->> 'id' FROM c1))), 1);
SELECT public.check_eq('a second revoke is not_found',
  (SELECT public.labelos_audit_press_share_revoke(:L, :O, :KIT, (SELECT (r -> 'share' ->> 'id')::uuid FROM c1), '{}', '{}') ->> 'error'), 'not_found');
SELECT public.check_eq('and wrote no second event', (SELECT count(*)::int FROM public.activity_events WHERE verb = 'press_kit.share_revoked' AND org_id = :L), 1);
SELECT public.check_eq('a revoked link frees a slot', (SELECT public.labelos_audit_press_share_create(:L, :O, :KIT, repeat('f', 64), 'Third', NULL, 2, '{}', '{}') ? 'share'), true);
SELECT public.check_eq('another org cannot revoke it',
  (SELECT public.labelos_audit_press_share_revoke(:L2, :X, :KIT, (SELECT id FROM public.press_kit_shares WHERE token_hash = repeat('d', 64)), '{}', '{}') ->> 'error'), 'not_found');
SELECT public.check_eq('a bad-payload revoke leaves the link live',
  (SELECT count(*)::int FROM public.press_kit_shares WHERE token_hash = repeat('d', 64) AND revoked_at IS NULL), 1);
SELECT public.check_raises('a secret-looking key on revoke is refused',
  format($$SELECT public.labelos_audit_press_share_revoke(%L, %L, %L, %L, '{}', '{"secret":1}')$$, 'b1990000-0000-4000-8000-000000000001', 'a1990000-0000-4000-8000-000000000001', 'f1990000-0000-4000-8000-0000000000f1', (SELECT id FROM public.press_kit_shares WHERE token_hash = repeat('d', 64))),
  'secret-looking');
SELECT public.check_eq('and the link stayed live', (SELECT count(*)::int FROM public.press_kit_shares WHERE token_hash = repeat('d', 64) AND revoked_at IS NULL), 1);
