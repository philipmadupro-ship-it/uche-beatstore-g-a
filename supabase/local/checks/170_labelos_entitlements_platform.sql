-- Behaviour checks for 170_labelos_entitlements_platform.sql (LABEL-47), run by
-- scripts/local-db/check.sh (npm run db:local:check) in its own copy of the
-- throwaway database. Every check RAISEs on failure.
--
-- Cast:
--   OP   platform operator (a platform_admins row, inserted here as postgres —
--        exactly how the owner seeds themself)
--   OW   owner of label L1          M   a member (A&R) of L1
--   X    owner of label L2          N   the invited owner of a new licensee
--   S    a signed-in stranger
--
-- Proven:
--   - platform_admins: an operator reads their own row on their JWT, nobody
--     else reads any; anon, authenticated AND service_role cannot write it;
--   - org_entitlements: a member reads their own org's row only; the API roles
--     and service_role cannot write it directly; only the console functions do,
--     each refusing a caller who is not an operator, each writing its audit
--     event in the affected org;
--   - has_org_cap: no row = everything (unchanged); a row without `contracts`
--     removes contracts.read and keeps the catalogue; another org is untouched;
--   - owner invitations: honoured only when sent by an operator; the seat cap
--     is refused under the lock and lifted by raising it; a roster artist does
--     not take a seat;
--   - deleting the org removes its entitlement row.

\set OP '''a1700000-0000-4000-8000-000000000001'''
\set OW '''a1700000-0000-4000-8000-000000000002'''
\set M  '''a1700000-0000-4000-8000-000000000003'''
\set X  '''a1700000-0000-4000-8000-000000000004'''
\set N  '''a1700000-0000-4000-8000-000000000005'''
\set S  '''a1700000-0000-4000-8000-000000000006'''
\set Z  '''a1700000-0000-4000-8000-000000000007'''
\set L1 '''b1700000-0000-4000-8000-000000000001'''
\set L2 '''b1700000-0000-4000-8000-000000000002'''

INSERT INTO auth.users (id, email) VALUES
  (:OP, 'op170@local.test'), (:OW, 'ow170@local.test'), (:M, 'm170@local.test'),
  (:X, 'x170@local.test'), (:N, 'n170@local.test'), (:S, 's170@local.test'), (:Z, 'z170@local.test');
INSERT INTO public.organizations (id, name, slug, kind, created_by) VALUES
  (:L1, 'Label One', 'label-one-170', 'label', :OW),
  (:L2, 'Label Two', 'label-two-170', 'label', :X);
INSERT INTO public.org_members (org_id, user_id, role, functions, scope) VALUES
  (:L1, :OW, 'owner', '{}', 'org'),
  (:L1, :M, 'member', '{a_and_r}', 'org'),
  (:L2, :X, 'owner', '{}', 'org');

-- The owner seeds themself exactly like this (MIGRATIONS.md, 170).
INSERT INTO public.platform_admins (user_id, note) VALUES (:OP, 'owner');

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

CREATE FUNCTION pg_temp.h(t text) RETURNS text LANGUAGE sql AS $$ SELECT encode(sha256(convert_to(t, 'UTF8')), 'hex') $$;
CREATE FUNCTION pg_temp.as_user(u uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', u::text, 'role', 'authenticated')::text, false);
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO anon, authenticated, service_role;

-- ── platform_admins ──────────────────────────────────────────────────────
SET ROLE authenticated;
SELECT pg_temp.as_user('a1700000-0000-4000-8000-000000000001');
SELECT public.check_eq('the operator reads their own row', (SELECT count(*) FROM public.platform_admins), 1::bigint);
SELECT pg_temp.as_user('a1700000-0000-4000-8000-000000000002');
SELECT public.check_eq('an org owner reads no operator', (SELECT count(*) FROM public.platform_admins), 0::bigint);
SELECT public.check_raises('authenticated cannot make itself an operator',
  $$INSERT INTO public.platform_admins (user_id) VALUES ('a1700000-0000-4000-8000-000000000002')$$, 'permission denied');
SELECT public.check_raises('authenticated cannot write entitlements',
  $$INSERT INTO public.org_entitlements (org_id, modules) VALUES ('b1700000-0000-4000-8000-000000000001', '{contracts}')$$, 'permission denied');
SELECT public.check_raises('authenticated cannot call the console functions',
  $$SELECT public.labelos_platform_set_entitlements('a1700000-0000-4000-8000-000000000002', 'b1700000-0000-4000-8000-000000000001', '{}', NULL, NULL, '{}')$$, 'permission denied');
SELECT public.check_raises('authenticated cannot create a licensee',
  $$SELECT public.labelos_platform_create_licensee('a1700000-0000-4000-8000-000000000002', 'x', 'x-170', 'label', '{}', NULL, NULL, '{}')$$, 'permission denied');
RESET ROLE;
RESET request.jwt.claims;

SET ROLE anon;
SELECT public.check_raises('anon cannot read operators', 'SELECT count(*) FROM public.platform_admins', 'permission denied');
SELECT public.check_raises('anon cannot read entitlements', 'SELECT count(*) FROM public.org_entitlements', 'permission denied');
RESET ROLE;

SET ROLE service_role;
SELECT public.check_eq('service_role reads operators (the console gate)', (SELECT count(*) FROM public.platform_admins), 1::bigint);
SELECT public.check_raises('service_role cannot add an operator (never self-service)',
  $$INSERT INTO public.platform_admins (user_id) VALUES ('a1700000-0000-4000-8000-000000000006')$$, 'permission denied');
SELECT public.check_raises('service_role cannot remove an operator',
  'DELETE FROM public.platform_admins', 'permission denied');
SELECT public.check_raises('service_role cannot write entitlements directly',
  $$INSERT INTO public.org_entitlements (org_id, modules) VALUES ('b1700000-0000-4000-8000-000000000001', '{}')$$, 'permission denied');

-- ── has_org_cap before any row: unchanged ────────────────────────────────
RESET ROLE;
SET ROLE authenticated;
SELECT pg_temp.as_user('a1700000-0000-4000-8000-000000000002');
SELECT public.check_eq('no row: the owner holds contracts.read', public.has_org_cap(:L1, 'contracts.read'), true);
RESET ROLE;

-- ── the console's write: only an operator, with its event ───────────────
SET ROLE service_role;
SELECT public.check_eq('a non-operator actor is refused',
  public.labelos_platform_set_entitlements(:OW, :L1, '{export}', NULL, NULL, '{"modules":["export"]}') ->> 'error', 'not_operator');
SELECT public.check_eq('nothing was written for the refusal', (SELECT count(*) FROM public.org_entitlements), 0::bigint);
SELECT public.check_eq('an operator sets L1 to export only',
  public.labelos_platform_set_entitlements(:OP, :L1, '{export}', 2, 5, '{"modules":["export"],"max_seats":2,"max_artists":5}') -> 'entitlements' ->> 'max_seats', '2');
SELECT public.check_eq('an org that predates its licence stays set up',
  (SELECT setup_done FROM public.org_entitlements WHERE org_id = :L1), true);
SELECT public.check_eq('the change is an audit event in L1, by the operator',
  (SELECT count(*) FROM public.activity_events WHERE org_id = :L1 AND verb = 'org.entitlements_changed' AND audit AND actor_id = :OP AND visibility = 'internal'), 1::bigint);
SELECT public.check_eq('and nothing in L2', (SELECT count(*) FROM public.activity_events WHERE org_id = :L2), 0::bigint);
SELECT public.check_eq('the producer''s own org is not a licensee',
  public.labelos_platform_set_entitlements(:OP, (SELECT id FROM public.organizations WHERE kind = 'producer' LIMIT 1), '{}', NULL, NULL, '{}') ->> 'error',
  CASE WHEN EXISTS (SELECT 1 FROM public.organizations WHERE kind = 'producer') THEN 'not_found' ELSE NULL END);
SELECT public.check_eq('an unknown org is not found',
  public.labelos_platform_set_entitlements(:OP, 'b1700000-0000-4000-8000-0000000000ff', '{}', NULL, NULL, '{}') ->> 'error', 'not_found');
SELECT public.check_raises('a cap of zero seats is refused',
  $$SELECT public.labelos_platform_set_entitlements('a1700000-0000-4000-8000-000000000001', 'b1700000-0000-4000-8000-000000000001', '{}', 0, NULL, '{}')$$, 'check constraint');
RESET ROLE;

-- ── has_org_cap with a row; reads of the row ────────────────────────────
SET ROLE authenticated;
SELECT pg_temp.as_user('a1700000-0000-4000-8000-000000000002');
SELECT public.check_eq('without contracts: no contracts.read, even for the owner', public.has_org_cap(:L1, 'contracts.read'), false);
SELECT public.check_eq('the catalogue stays', public.has_org_cap(:L1, 'catalog.read'), true);
SELECT public.check_eq('the legal gate stays (core)', public.has_org_cap(:L1, 'release.approve.legal'), true);
SELECT public.check_eq('the owner reads their org''s licence', (SELECT modules FROM public.org_entitlements WHERE org_id = :L1), '{export}'::text[]);
SELECT pg_temp.as_user('a1700000-0000-4000-8000-000000000003');
SELECT public.check_eq('a member reads it too', (SELECT count(*) FROM public.org_entitlements), 1::bigint);
SELECT pg_temp.as_user('a1700000-0000-4000-8000-000000000004');
SELECT public.check_eq('another org''s owner reads nothing of it', (SELECT count(*) FROM public.org_entitlements), 0::bigint);
SELECT public.check_eq('and their own org is untouched', public.has_org_cap(:L2, 'contracts.read'), true);
SELECT pg_temp.as_user('a1700000-0000-4000-8000-000000000006');
SELECT public.check_eq('a stranger reads nothing', (SELECT count(*) FROM public.org_entitlements), 0::bigint);
RESET ROLE;
RESET request.jwt.claims;

-- ── creating a licensee ──────────────────────────────────────────────────
SET ROLE service_role;
SELECT public.check_eq('a non-operator cannot create one',
  public.labelos_platform_create_licensee(:OW, 'Nope', 'nope-170', 'label', '{}', NULL, NULL, '{}') ->> 'error', 'not_operator');
SELECT public.check_raises('a producer-kind licensee is refused',
  $$SELECT public.labelos_platform_create_licensee('a1700000-0000-4000-8000-000000000001', 'Studio', 'studio-170', 'producer', '{}', NULL, NULL, '{}')$$, 'artist or a label');
SELECT public.check_eq('a taken slug is answered, not raised',
  public.labelos_platform_create_licensee(:OP, 'Dup', 'label-one-170', 'label', '{}', NULL, NULL, '{}') ->> 'error', 'slug_taken');
SELECT public.check_eq('an operator creates an independent licensee',
  public.labelos_platform_create_licensee(:OP, 'Solo Act', 'solo-act-170', 'artist', '{contracts,store}', NULL, 1, '{"modules":["contracts","store"]}') -> 'org' ->> 'kind', 'artist');
RESET ROLE;
SELECT public.check_eq('its licence: not set up yet, granted by the operator',
  (SELECT setup_done::text || ':' || (granted_by = :OP)::text FROM public.org_entitlements e JOIN public.organizations o ON o.id = e.org_id WHERE o.slug = 'solo-act-170'), 'false:true');
SELECT public.check_eq('no member yet, created_by left empty',
  (SELECT count(*) FROM public.org_members m JOIN public.organizations o ON o.id = m.org_id WHERE o.slug = 'solo-act-170')
    + (SELECT count(*) FROM public.organizations WHERE slug = 'solo-act-170' AND created_by IS NOT NULL), 0::bigint);
SELECT public.check_eq('its own artist contact does not carry the operator''s email',
  (SELECT count(*) FROM public.contacts c JOIN public.organizations o ON o.id = c.org_id WHERE o.slug = 'solo-act-170' AND c.category = 'artist' AND c.email IS NULL), 1::bigint);
SELECT public.check_eq('org.created (everyday) and org.entitlements_changed (audit) in the new org',
  (SELECT string_agg(verb || ':' || audit::text, ',' ORDER BY verb) FROM public.activity_events e JOIN public.organizations o ON o.id = e.org_id WHERE o.slug = 'solo-act-170'),
  'org.created:false,org.entitlements_changed:true');

-- ── the owner invitation ─────────────────────────────────────────────────
SET ROLE service_role;
SELECT public.labelos_audit_invitation_create(
  (SELECT id FROM public.organizations WHERE slug = 'solo-act-170'), :OP, 'n170@local.test', 'owner', '{}', '{}',
  pg_temp.h('owner-ok'), now() + interval '7 days', '{"email":"n170@local.test","role":"owner","source":"platform"}');
-- An owner invitation from someone who is not an operator stays unsupported.
SELECT public.labelos_audit_invitation_create(:L1, :OW, 's170@local.test', 'owner', '{}', '{}',
  pg_temp.h('owner-bad'), now() + interval '7 days', '{"email":"s170@local.test","role":"owner"}');
SELECT public.check_eq('a member cannot hand out ownership by invitation',
  public.labelos_accept_invitation(pg_temp.h('owner-bad'), :S) ->> 'error', 'unsupported');
SELECT public.check_eq('the operator''s owner invitation is honoured',
  public.labelos_accept_invitation(pg_temp.h('owner-ok'), :N) ->> 'status', 'joined');
RESET ROLE;
SELECT public.check_eq('the invitee is the owner, seeing the whole org',
  (SELECT role || ':' || scope FROM public.org_members m JOIN public.organizations o ON o.id = m.org_id WHERE o.slug = 'solo-act-170' AND m.user_id = :N), 'owner:org');
DELETE FROM public.platform_admins WHERE user_id = :OP;
SET ROLE service_role;
SELECT public.labelos_audit_invitation_create(
  (SELECT id FROM public.organizations WHERE slug = 'solo-act-170'), :OP, 'z170@local.test', 'owner', '{}', '{}',
  pg_temp.h('owner-late'), now() + interval '7 days', '{"email":"z170@local.test","role":"owner"}');
SELECT public.check_eq('once its sender is no longer an operator, an owner invitation is dead',
  public.labelos_accept_invitation(pg_temp.h('owner-late'), :Z) ->> 'error', 'unsupported');
RESET ROLE;
INSERT INTO public.platform_admins (user_id) VALUES (:OP);

-- ── the seat cap (L1: 2 seats, OW + M already hold them) ────────────────
INSERT INTO public.contacts (id, org_id, user_id, name, category) VALUES
  ('c1700000-0000-4000-8000-000000000001', :L1, NULL, 'Nova', 'artist');
INSERT INTO public.org_invitations (org_id, email, role, functions, artist_ids, token_hash, expires_at, invited_by) VALUES
  (:L1, 's170@local.test', 'member', '{legal}', '{}', pg_temp.h('seat'), now() + interval '7 days', :OW),
  (:L1, 'z170@local.test', 'artist', '{}', '{c1700000-0000-4000-8000-000000000001}', pg_temp.h('artist'), now() + interval '7 days', :OW);
SET ROLE service_role;
SELECT public.check_eq('the third staff seat is refused', public.labelos_accept_invitation(pg_temp.h('seat'), :S) ->> 'error', 'seat_limit');
SELECT public.check_eq('a roster artist does not take a seat', public.labelos_accept_invitation(pg_temp.h('artist'), :Z) ->> 'status', 'joined');
SELECT public.check_eq('an existing member re-accepting is not refused by the cap',
  public.labelos_accept_invitation(pg_temp.h('artist'), :Z) ->> 'status', 'already_member');
RESET ROLE;
SELECT public.check_eq('the refused invitation is still pending',
  (SELECT accepted_at IS NULL FROM public.org_invitations WHERE token_hash = pg_temp.h('seat')), true);
SET ROLE service_role;
SELECT public.labelos_platform_set_entitlements(:OP, :L1, '{export}', 3, 5, '{"max_seats":3}');
SELECT public.check_eq('with a third seat, the same invitation joins', public.labelos_accept_invitation(pg_temp.h('seat'), :S) ->> 'status', 'joined');
SELECT public.labelos_platform_set_entitlements(:OP, :L1, '{export,contracts}', NULL, NULL, '{"max_seats":null}');
RESET ROLE;
SET ROLE authenticated;
SELECT pg_temp.as_user('a1700000-0000-4000-8000-000000000002');
SELECT public.check_eq('contracts back on: contracts.read returns', public.has_org_cap(:L1, 'contracts.read'), true);
RESET ROLE;
RESET request.jwt.claims;

-- ── deleting the org removes its licence ─────────────────────────────────
DELETE FROM public.organizations WHERE id = :L1;
SELECT public.check_eq('cascade', (SELECT count(*) FROM public.org_entitlements WHERE org_id = :L1), 0::bigint);
