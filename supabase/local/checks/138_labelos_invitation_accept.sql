-- Behaviour checks for 138_labelos_invitation_accept.sql, run by
-- scripts/local-db/check.sh (npm run db:local:check) in its own copy of the
-- throwaway database. Every check RAISEs on failure; psql stops at the first.
--
-- Cast:
--   OWN   owner of label org L
--   INV   invitee, email Invitee@Local.Test in auth.users (mixed case)
--   OTHER someone else (wrong email)
--   B     seed buyer (no creator_profiles row): a buyer can join
-- Tokens are stand-ins: the function only ever sees sha-256 hex.

\set OWN   '''e1000000-0000-4000-8000-000000000001'''
\set INV   '''e1000000-0000-4000-8000-000000000002'''
\set OTHER '''e1000000-0000-4000-8000-000000000003'''
\set B     '''0b0e1a57-0000-4000-8000-0000000000b1'''
\set L     '''f1000000-0000-4000-8000-000000000001'''
\set P     '''f1000000-0000-4000-8000-000000000002'''

INSERT INTO auth.users (id, email) VALUES
  ('e1000000-0000-4000-8000-000000000001', 'owner@local.test'),
  ('e1000000-0000-4000-8000-000000000002', '  Invitee@Local.Test '),
  ('e1000000-0000-4000-8000-000000000003', 'other@local.test');
INSERT INTO public.organizations (id, name, slug, kind, created_by) VALUES
  ('f1000000-0000-4000-8000-000000000001', 'Label L', 'label-l', 'label', 'e1000000-0000-4000-8000-000000000001'),
  ('f1000000-0000-4000-8000-000000000002', 'Producer P', 'producer-p', 'producer', 'e1000000-0000-4000-8000-000000000001');
INSERT INTO public.org_members (org_id, user_id, role, scope) VALUES
  ('f1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'owner', 'org'),
  ('f1000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000001', 'owner', 'org');

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

-- Invitations (as the service-role create route writes them: email normalised).
INSERT INTO public.org_invitations (org_id, email, role, functions, artist_ids, token_hash, expires_at, invited_by) VALUES
  (:L, 'invitee@local.test', 'member', '{a_and_r,legal}', '{}', pg_temp.h('ok'),      now() + interval '7 days', :OWN),
  (:L, 'invitee@local.test', 'member', '{}',              '{}', pg_temp.h('expired'), now() - interval '1 second', :OWN),
  (:L, 'invitee@local.test', 'member', '{}',              '{}', pg_temp.h('revoked'), now() + interval '7 days', :OWN),
  (:L, 'buyer@local.test',   'artist', '{}', '{11111111-1111-4111-8111-111111111111}', pg_temp.h('buyer'), now() + interval '7 days', :OWN),
  (:P, 'invitee@local.test', 'admin',  '{engineer}',      '{}', pg_temp.h('admin'),   now() + interval '7 days', :OWN),
  (:L, 'other@local.test',   'owner',  '{}',              '{}', pg_temp.h('owner'),   now() + interval '7 days', :OWN);
UPDATE public.org_invitations SET revoked_at = now() WHERE token_hash = pg_temp.h('revoked');

-- ── Only the service role may call it ────────────────────────────────────
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"e1000000-0000-4000-8000-000000000002"}', false);
SELECT public.check_raises('authenticated cannot call labelos_accept_invitation',
  format('SELECT public.labelos_accept_invitation(%L, %L)', pg_temp.h('ok'), 'e1000000-0000-4000-8000-000000000002'), 'permission denied');
SELECT public.check_raises('authenticated still cannot insert org_members',
  $$INSERT INTO public.org_members (org_id, user_id, role) VALUES ('f1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000002', 'member')$$,
  'permission denied|row-level security');
SELECT public.check_eq('invitee cannot read the invitation (members.manage only)',
  (SELECT count(*) FROM public.org_invitations), 0::bigint);
RESET ROLE;
SET ROLE anon;
SELECT public.check_raises('anon cannot call labelos_accept_invitation',
  format('SELECT public.labelos_accept_invitation(%L, %L)', pg_temp.h('ok'), 'e1000000-0000-4000-8000-000000000002'), 'permission denied');
RESET ROLE;

SET ROLE service_role;
-- ── Refusals, none of which writes anything ──────────────────────────────
SELECT public.check_eq('unknown token → not_found',
  public.labelos_accept_invitation(pg_temp.h('nope'), :INV), '{"error": "not_found"}'::jsonb);
SELECT public.check_eq('malformed hash → not_found',
  public.labelos_accept_invitation('ok', :INV), '{"error": "not_found"}'::jsonb);
SELECT public.check_eq('wrong email → email_mismatch (no email in the answer)',
  public.labelos_accept_invitation(pg_temp.h('ok'), :OTHER), '{"error": "email_mismatch"}'::jsonb);
SELECT public.check_eq('expired → expired',
  public.labelos_accept_invitation(pg_temp.h('expired'), :INV), '{"error": "expired"}'::jsonb);
SELECT public.check_eq('revoked → revoked',
  public.labelos_accept_invitation(pg_temp.h('revoked'), :INV), '{"error": "revoked"}'::jsonb);
SELECT public.check_eq('owner invitation → unsupported',
  public.labelos_accept_invitation(pg_temp.h('owner'), :OTHER), '{"error": "unsupported"}'::jsonb);
SELECT public.check_eq('a user that does not exist → email_mismatch',
  public.labelos_accept_invitation(pg_temp.h('ok'), 'e1000000-0000-4000-8000-0000000000ff'), '{"error": "email_mismatch"}'::jsonb);
RESET ROLE;
SELECT public.check_eq('refusals wrote no membership',
  (SELECT count(*) FROM public.org_members WHERE user_id IN (:INV, :OTHER)), 0::bigint);
SELECT public.check_eq('refusals consumed no invitation',
  (SELECT count(*) FROM public.org_invitations WHERE accepted_at IS NOT NULL), 0::bigint);
SELECT public.check_eq('refusals recorded no event',
  (SELECT count(*) FROM public.activity_events WHERE verb = 'member.joined'), 0::bigint);

-- ── Accept (email matched case- and space-insensitively) ─────────────────
SET ROLE service_role;
SELECT public.check_eq('accept → joined',
  public.labelos_accept_invitation(pg_temp.h('ok'), :INV),
  jsonb_build_object('status', 'joined', 'org_id', :L::uuid));
RESET ROLE;
SELECT public.check_eq('membership written with the invited role, functions, scope and inviter',
  (SELECT role || '/' || array_to_string(functions, ',') || '/' || scope || '/' || invited_by::text
   FROM public.org_members WHERE org_id = :L AND user_id = :INV),
  'member/a_and_r,legal/org/' || :OWN);
SELECT public.check_eq('invitation marked accepted',
  (SELECT accepted_at IS NOT NULL FROM public.org_invitations WHERE token_hash = pg_temp.h('ok')), true);
SELECT public.check_eq('one member.joined audit event, internal, actor = the invitee',
  (SELECT count(*) FROM public.activity_events
   WHERE org_id = :L AND verb = 'member.joined' AND audit AND visibility = 'internal'
     AND actor_id = :INV AND subject_type = 'member' AND subject_id = :INV
     AND payload ->> 'role' = 'member'),
  1::bigint);
SELECT public.check_eq('the event never carries a token or its hash',
  (SELECT count(*) FROM public.activity_events WHERE payload::text ~* 'token'), 0::bigint);

-- ── Twice: idempotent for the member, "used" for anyone else ────────────
SET ROLE service_role;
SELECT public.check_eq('accepting again → already_member',
  public.labelos_accept_invitation(pg_temp.h('ok'), :INV),
  jsonb_build_object('status', 'already_member', 'org_id', :L::uuid));
RESET ROLE;
SELECT public.check_eq('still one event after the replay',
  (SELECT count(*) FROM public.activity_events WHERE verb = 'member.joined' AND org_id = :L), 1::bigint);
-- The member is removed; the link stays spent.
DELETE FROM public.org_members WHERE org_id = :L AND user_id = :INV;
SET ROLE service_role;
SELECT public.check_eq('a used invitation does not readmit a removed member',
  public.labelos_accept_invitation(pg_temp.h('ok'), :INV), '{"error": "used"}'::jsonb);
RESET ROLE;

-- ── Admin: functions dropped (admins do not take them) ──────────────────
SET ROLE service_role;
SELECT public.check_eq('admin invitation → joined',
  public.labelos_accept_invitation(pg_temp.h('admin'), :INV) ->> 'status', 'joined');
RESET ROLE;
SELECT public.check_eq('admin membership has no functions',
  (SELECT role || '/' || cardinality(functions) FROM public.org_members WHERE org_id = :P AND user_id = :INV), 'admin/0');

-- ── A buyer joins as a roster artist: artist-scoped ─────────────────────
SET ROLE service_role;
SELECT public.check_eq('buyer accepts → joined',
  public.labelos_accept_invitation(pg_temp.h('buyer'), :B) ->> 'status', 'joined');
RESET ROLE;
SELECT public.check_eq('artist membership is artist-scoped',
  (SELECT role || '/' || scope FROM public.org_members WHERE org_id = :L AND user_id = :B), 'artist/artists');
SELECT public.check_eq('the buyer is still not a producer',
  (SELECT count(*) FROM public.creator_profiles WHERE user_id = :B), 0::bigint);

-- ── Already a member before accepting: membership untouched ─────────────
INSERT INTO public.org_invitations (org_id, email, role, token_hash, expires_at, invited_by)
  VALUES (:L, 'owner@local.test', 'member', pg_temp.h('own-again'), now() + interval '7 days', :OWN);
SET ROLE service_role;
SELECT public.check_eq('an existing member accepting → already_member',
  public.labelos_accept_invitation(pg_temp.h('own-again'), :OWN) ->> 'status', 'already_member');
RESET ROLE;
SELECT public.check_eq('the owner stays owner', (SELECT role FROM public.org_members WHERE org_id = :L AND user_id = :OWN), 'owner');
SELECT public.check_eq('the invitation is consumed',
  (SELECT accepted_at IS NOT NULL FROM public.org_invitations WHERE token_hash = pg_temp.h('own-again')), true);

-- ── A soft-deleted org's invitations are gone ───────────────────────────
INSERT INTO public.org_invitations (org_id, email, role, token_hash, expires_at, invited_by)
  VALUES (:P, 'other@local.test', 'member', pg_temp.h('deleted-org'), now() + interval '7 days', :OWN);
UPDATE public.organizations SET deleted_at = now() WHERE id = :P;
SET ROLE service_role;
SELECT public.check_eq('soft-deleted org → not_found',
  public.labelos_accept_invitation(pg_temp.h('deleted-org'), :OTHER), '{"error": "not_found"}'::jsonb);
RESET ROLE;

SELECT public.check_eq('function owned by postgres, SECURITY DEFINER, pinned search_path',
  (SELECT count(*) FROM pg_proc WHERE proname = 'labelos_accept_invitation'
     AND pg_get_userbyid(proowner) = 'postgres' AND prosecdef AND proconfig @> ARRAY['search_path=public']),
  1::bigint);
SELECT public.check_eq('function locks the invitation row',
  (SELECT prosrc ~ 'FOR UPDATE' FROM pg_proc WHERE proname = 'labelos_accept_invitation'), true);

DROP FUNCTION public.check_eq(text, anyelement, anyelement);
DROP FUNCTION public.check_raises(text, text, text);
