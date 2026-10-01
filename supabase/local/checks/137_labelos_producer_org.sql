-- Behaviour checks for 137_labelos_producer_org.sql, run by
-- scripts/local-db/check.sh (npm run db:local:check) in its own copy of the
-- throwaway database. Every check RAISEs on failure; psql stops at the first.
--
-- The database already holds every migration applied twice, then seed.sql:
-- seed's producer (UCHE) and buyer were created AFTER 137 ran, so neither has
-- an org yet. This file adds more people, re-runs 137 (the backfill path),
-- runs it again (the replay), then exercises the function directly.
--
-- Cast:
--   U  seed producer, display_name UCHE, slug uche          → org "UCHE" / uche
--   B  seed buyer, no creator_profiles row                   → nothing
--   P2 producer, display_name "UCHE" again, no slug           → uche-2
--   P3 producer, display_name blank                           → "My studio" / studio
--   P4 producer, non-Latin name                              → name kept, slug studio-2
--   P5 producer who already owns a producer org              → nothing new
--   P6 producer who is only a MEMBER of P5's org             → own org
--   P7 producer who owns a LABEL org                         → own producer org

\set U  '''0b0e1a57-0000-4000-8000-000000000001'''
\set B  '''0b0e1a57-0000-4000-8000-0000000000b1'''

INSERT INTO auth.users (id) VALUES
  ('d0000000-0000-4000-8000-000000000002'),
  ('d0000000-0000-4000-8000-000000000003'),
  ('d0000000-0000-4000-8000-000000000004'),
  ('d0000000-0000-4000-8000-000000000005'),
  ('d0000000-0000-4000-8000-000000000006'),
  ('d0000000-0000-4000-8000-000000000007');
INSERT INTO public.creator_profiles (user_id, display_name) VALUES
  ('d0000000-0000-4000-8000-000000000002', 'UCHE'),
  ('d0000000-0000-4000-8000-000000000003', '   '),
  ('d0000000-0000-4000-8000-000000000004', 'ウチェ'),
  ('d0000000-0000-4000-8000-000000000005', 'Five'),
  ('d0000000-0000-4000-8000-000000000006', 'Six'),
  ('d0000000-0000-4000-8000-000000000007', 'Seven');
INSERT INTO public.organizations (id, name, slug, kind, created_by) VALUES
  ('eeeeeeee-0000-4000-8000-000000000005', 'Five existing', 'five-existing', 'producer', 'd0000000-0000-4000-8000-000000000005'),
  ('eeeeeeee-0000-4000-8000-000000000007', 'Seven Records', 'seven-records', 'label',    'd0000000-0000-4000-8000-000000000007');
INSERT INTO public.org_members (org_id, user_id, role, functions, scope) VALUES
  ('eeeeeeee-0000-4000-8000-000000000005', 'd0000000-0000-4000-8000-000000000005', 'owner',  '{}',         'org'),
  ('eeeeeeee-0000-4000-8000-000000000005', 'd0000000-0000-4000-8000-000000000006', 'member', '{engineer}', 'org'),
  ('eeeeeeee-0000-4000-8000-000000000007', 'd0000000-0000-4000-8000-000000000007', 'owner',  '{}',         'org');

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

-- A view of "who owns which producer org", used by every count below.
CREATE TEMP VIEW producer_owners AS
  SELECT om.user_id, o.id AS org_id, o.name, o.slug
  FROM public.org_members om JOIN public.organizations o ON o.id = om.org_id
  WHERE om.role = 'owner' AND o.kind = 'producer';

SELECT public.check_eq('before the backfill: U has no org',
  (SELECT count(*) FROM producer_owners WHERE user_id = :U), 0::bigint);

-- ── Backfill (137 again, as the deploy runner would on a database that
--    gained producers since) ─────────────────────────────────────────────
\ir ../../migrations/137_labelos_producer_org.sql

SELECT public.check_eq('every producer owns exactly one producer org',
  (SELECT count(*) FROM public.creator_profiles cp
   WHERE (SELECT count(*) FROM producer_owners po WHERE po.user_id = cp.user_id) <> 1),
  0::bigint);
SELECT public.check_eq('buyer gets no org',
  (SELECT count(*) FROM public.org_members WHERE user_id = :B), 0::bigint);
SELECT public.check_eq('U: name from display_name, slug from the profile slug',
  (SELECT name || '/' || slug FROM producer_owners WHERE user_id = :U), 'UCHE/uche');
SELECT public.check_eq('P2: same name → next free slug',
  (SELECT slug FROM producer_owners WHERE user_id = 'd0000000-0000-4000-8000-000000000002'), 'uche-2');
SELECT public.check_eq('P3: blank name → "My studio"',
  (SELECT name || '/' || slug FROM producer_owners WHERE user_id = 'd0000000-0000-4000-8000-000000000003'), 'My studio/studio');
SELECT public.check_eq('P4: non-Latin name kept, slug falls back',
  (SELECT name || '/' || slug FROM producer_owners WHERE user_id = 'd0000000-0000-4000-8000-000000000004'), 'ウチェ/studio-2');
SELECT public.check_eq('P5: existing producer org kept, nothing new',
  (SELECT string_agg(slug, ',') FROM producer_owners WHERE user_id = 'd0000000-0000-4000-8000-000000000005'), 'five-existing');
SELECT public.check_eq('P6: membership elsewhere is not ownership → own org',
  (SELECT slug FROM producer_owners WHERE user_id = 'd0000000-0000-4000-8000-000000000006'), 'six');
SELECT public.check_eq('P7: owning a label is not owning a producer org → own org',
  (SELECT slug FROM producer_owners WHERE user_id = 'd0000000-0000-4000-8000-000000000007'), 'seven');
SELECT public.check_eq('new orgs: owner row is org-scoped, no functions, created_by set',
  (SELECT count(*) FROM producer_owners po
     JOIN public.org_members om ON om.org_id = po.org_id AND om.user_id = po.user_id
     JOIN public.organizations o ON o.id = po.org_id
   WHERE om.scope = 'org' AND om.functions = '{}' AND o.created_by = po.user_id),
  (SELECT count(*) FROM producer_owners));
SELECT public.check_eq('new orgs have exactly one member each',
  (SELECT count(*) FROM producer_owners po
   WHERE po.slug <> 'five-existing'
     AND (SELECT count(*) FROM public.org_members m WHERE m.org_id = po.org_id) <> 1),
  0::bigint);

-- ── Replay: nothing new ─────────────────────────────────────────────────
CREATE TEMP TABLE before_replay AS
  SELECT (SELECT count(*) FROM public.organizations) AS orgs,
         (SELECT count(*) FROM public.org_members)   AS members;
\ir ../../migrations/137_labelos_producer_org.sql
SELECT public.check_eq('replay creates no organizations',
  (SELECT count(*) FROM public.organizations), (SELECT orgs FROM before_replay));
SELECT public.check_eq('replay creates no memberships',
  (SELECT count(*) FROM public.org_members), (SELECT members FROM before_replay));

-- ── The function the profile route calls ─────────────────────────────────
SELECT public.check_eq('existing producer → created false, same org',
  public.labelos_ensure_producer_org(:U),
  jsonb_build_object('org_id', (SELECT org_id FROM producer_owners WHERE user_id = :U), 'created', false));
SELECT public.check_eq('buyer → skipped',
  public.labelos_ensure_producer_org(:B), '{"skipped": "not_producer"}'::jsonb);
SELECT public.check_eq('NULL → skipped',
  public.labelos_ensure_producer_org(NULL), '{"skipped": "not_producer"}'::jsonb);

INSERT INTO auth.users (id) VALUES ('d0000000-0000-4000-8000-000000000008');
INSERT INTO public.creator_profiles (user_id, display_name) VALUES ('d0000000-0000-4000-8000-000000000008', 'Night Shift!!');
SELECT public.check_eq('new producer → created true',
  (public.labelos_ensure_producer_org('d0000000-0000-4000-8000-000000000008') ->> 'created')::boolean, true);
SELECT public.check_eq('new producer org slugified',
  (SELECT name || '/' || slug FROM producer_owners WHERE user_id = 'd0000000-0000-4000-8000-000000000008'), 'Night Shift!!/night-shift');
SELECT public.check_eq('second call → created false',
  (public.labelos_ensure_producer_org('d0000000-0000-4000-8000-000000000008') ->> 'created')::boolean, false);

-- A producer who transferred their org's ownership is not given a new one.
INSERT INTO auth.users (id) VALUES ('d0000000-0000-4000-8000-000000000009');
INSERT INTO public.org_members (org_id, user_id, role, scope)
  SELECT org_id, 'd0000000-0000-4000-8000-000000000009', 'owner', 'org'
  FROM producer_owners WHERE user_id = 'd0000000-0000-4000-8000-000000000008';
UPDATE public.org_members SET role = 'admin'
  WHERE user_id = 'd0000000-0000-4000-8000-000000000008';
SELECT public.check_eq('after an ownership transfer → created false, same org',
  public.labelos_ensure_producer_org('d0000000-0000-4000-8000-000000000008') ->> 'org_id',
  (SELECT org_id::text FROM producer_owners WHERE user_id = 'd0000000-0000-4000-8000-000000000009'));
SELECT public.check_eq('after an ownership transfer → still one producer org created by them',
  (SELECT count(*) FROM public.organizations WHERE created_by = 'd0000000-0000-4000-8000-000000000008'), 1::bigint);

-- A producer whose org is in its 30-day grace period is not given a new one.
UPDATE public.organizations SET deleted_at = now() WHERE slug = 'night-shift';
SELECT public.check_eq('soft-deleted producer org is not replaced',
  (public.labelos_ensure_producer_org('d0000000-0000-4000-8000-000000000008') ->> 'created')::boolean, false);

-- The new owner reads their org through 136's RLS and holds everything.
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"0b0e1a57-0000-4000-8000-000000000001"}', false);
SELECT public.check_eq('U sees exactly their org', (SELECT string_agg(slug, ',') FROM public.organizations), 'uche');
SELECT public.check_eq('U is owner', public.org_role((SELECT id FROM public.organizations WHERE slug = 'uche')), 'owner');
SELECT public.check_eq('U holds members.manage',
  public.has_org_cap((SELECT id FROM public.organizations WHERE slug = 'uche'), 'members.manage'), true);

-- ── Only the service role may call it ────────────────────────────────────
SELECT public.check_raises('authenticated cannot call labelos_ensure_producer_org',
  $$SELECT public.labelos_ensure_producer_org('0b0e1a57-0000-4000-8000-0000000000b1')$$, 'permission denied');
RESET ROLE;
SET ROLE anon;
SELECT public.check_raises('anon cannot call labelos_ensure_producer_org',
  $$SELECT public.labelos_ensure_producer_org('0b0e1a57-0000-4000-8000-0000000000b1')$$, 'permission denied');
RESET ROLE;
SET ROLE service_role;
SELECT public.check_eq('service_role may call it (buyer still skipped)',
  public.labelos_ensure_producer_org('0b0e1a57-0000-4000-8000-0000000000b1'), '{"skipped": "not_producer"}'::jsonb);
RESET ROLE;
SELECT public.check_eq('function owned by postgres, SECURITY DEFINER, pinned search_path',
  (SELECT count(*) FROM pg_proc WHERE proname = 'labelos_ensure_producer_org'
     AND pg_get_userbyid(proowner) = 'postgres' AND prosecdef AND proconfig @> ARRAY['search_path=public']),
  1::bigint);
SELECT public.check_eq('function serialises per user with an advisory lock',
  (SELECT prosrc ~ 'pg_advisory_xact_lock' FROM pg_proc WHERE proname = 'labelos_ensure_producer_org'), true);

-- ── Rollback shape: the backlog's delete leaves shared orgs alone ────────
-- (the full rollback file runs separately; this checks its predicate here,
-- where P5's org and P8's transferred org each have a second member.)
\ir ../../rollback/137_labelos_producer_org.down.sql
SELECT public.check_eq('rollback removes sole-owner producer orgs, keeps the two shared ones',
  (SELECT string_agg(DISTINCT slug, ',' ORDER BY slug) FROM producer_owners), 'five-existing,night-shift');
SELECT public.check_eq('rollback keeps a producer org with other members',
  (SELECT count(*) FROM public.org_members WHERE org_id = 'eeeeeeee-0000-4000-8000-000000000005'), 2::bigint);
SELECT public.check_eq('rollback keeps label orgs',
  (SELECT count(*) FROM public.organizations WHERE kind = 'label'), 1::bigint);

DROP FUNCTION public.check_eq(text, anyelement, anyelement);
DROP FUNCTION public.check_raises(text, text, text);
