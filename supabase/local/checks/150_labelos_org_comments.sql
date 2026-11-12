-- Behaviour checks for 150_labelos_org_comments.sql, run by
-- scripts/local-db/check.sh (npm run db:local:check) in its own copy of the
-- throwaway database. Every check RAISEs on failure; psql stops at the first.
--
-- Cast:
--   label L   : owner OWN; AR (A&R, whole org); SC (A&R scoped to C1);
--               ART (role artist, scoped to C1, with business.read.internal
--               GRANTED as an override, which a roster artist can never hold)
--   label L2  : owner X2
--   EXT       : an external editor of LP1 (project_members, no org_members row)
--   NOBODY    : no membership anywhere
--   projects  : LP1 (artist C1), LP2 (artist C2) in L; XP1 in L2; PP1 producer's
-- The point of this file: an INTERNAL comment is unreadable, in SQL, to a
-- roster artist, an external member, another org, anon and a stranger; it can
-- never be a share or portal row; a reply to it is internal; the org of a
-- comment is the project's and nobody else's.

\set OWN  '''a1500000-0000-4000-8000-000000000001'''
\set AR   '''a1500000-0000-4000-8000-000000000002'''
\set SC   '''a1500000-0000-4000-8000-000000000004'''
\set ART  '''a1500000-0000-4000-8000-000000000005'''
\set X2   '''a1500000-0000-4000-8000-000000000006'''
\set EXT  '''a1500000-0000-4000-8000-000000000011'''
\set NOBODY '''a1500000-0000-4000-8000-000000000015'''
\set PROD '''0b0e1a57-0000-4000-8000-000000000001'''
\set L    '''b1500000-0000-4000-8000-000000000001'''
\set L2   '''b1500000-0000-4000-8000-000000000002'''
\set C1   '''c1500000-0000-4000-8000-0000000000c1'''
\set C2   '''c1500000-0000-4000-8000-0000000000c2'''
\set LP1  '''d1500000-0000-4000-8000-000000000011'''
\set LP2  '''d1500000-0000-4000-8000-000000000012'''
\set XP1  '''d1500000-0000-4000-8000-000000000021'''
\set PP1  '''d1500000-0000-4000-8000-000000000031'''
\set S1   '''e1500000-0000-4000-8000-000000000011'''

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  (:OWN, 'own150@local.test', now()), (:AR, 'ar150@local.test', now()), (:SC, 'sc150@local.test', now()),
  (:ART, 'art150@local.test', now()), (:X2, 'x2150@local.test', now()),
  (:EXT, 'ext150@local.test', now()), (:NOBODY, 'nobody150@local.test', now())
  ON CONFLICT DO NOTHING;
INSERT INTO public.organizations (id, name, slug, kind, created_by) VALUES
  (:L, 'Label L', 'label-l-150', 'label', :OWN),
  (:L2, 'Label L2', 'label-l2-150', 'label', :X2);
INSERT INTO public.org_members (org_id, user_id, role, functions, scope, cap_grants) VALUES
  (:L, :OWN, 'owner', '{}', 'org', '{}'),
  (:L, :AR, 'member', '{a_and_r}', 'org', '{}'),
  (:L, :SC, 'member', '{a_and_r}', 'artists', '{}'),
  (:L, :ART, 'artist', '{}', 'artists', '{business.read.internal}'),
  (:L2, :X2, 'owner', '{}', 'org', '{}');
INSERT INTO public.contacts (id, user_id, org_id, name, email, category) VALUES
  (:C1, NULL, :L, 'Nova', 'nova150@local.test', 'artist'),
  (:C2, NULL, :L, 'Kilo', 'kilo150@local.test', 'artist');
INSERT INTO public.member_artist_scopes (org_id, user_id, contact_id) VALUES (:L, :SC, :C1), (:L, :ART, :C1);
INSERT INTO public.projects (id, user_id, org_id, name, inbox_for_contact_id) VALUES
  (:LP1, NULL, :L, 'Nova EP', :C1),
  (:LP2, NULL, :L, 'Inbox · Kilo', :C2),
  (:XP1, NULL, :L2, 'L2 project', NULL);
INSERT INTO public.projects (id, user_id, name) VALUES (:PP1, :PROD, 'Producer project');
INSERT INTO public.tracks (id, user_id, org_id, created_by, title, type, audio_url, song_stage) VALUES
  (:S1, NULL, :L, :AR, 'Nova single', 'song', 'r2://private/s1', 'selected');
INSERT INTO public.project_tracks (project_id, track_id, position) VALUES (:LP1, :S1, 0);
INSERT INTO public.project_members (org_id, project_id, user_id, role, invited_by) VALUES (:L, :LP1, :EXT, 'editor', :AR);

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
-- What the caller's own JWT reads of project_comments, as sorted bodies.
CREATE FUNCTION public.seen() RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(body, ' | ' ORDER BY body), '') FROM public.project_comments;
$$;
GRANT EXECUTE ON FUNCTION public.check_eq(text, anyelement, anyelement), public.check_raises(text, text, text),
  public.as_user(text), public.seen() TO anon, authenticated, service_role;

-- ── Shape ───────────────────────────────────────────────────────────────

SELECT public.check_eq('the four columns exist',
  (SELECT string_agg(column_name, ',' ORDER BY column_name) FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'project_comments' AND column_name IN ('org_id', 'visibility', 'resolved_at', 'resolved_by')),
  'org_id,resolved_at,resolved_by,visibility');
SELECT public.check_eq('visibility defaults to artist',
  (SELECT column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'project_comments' AND column_name = 'visibility'),
  '''artist''::text');

-- A producer / share comment, as every existing row looks.
INSERT INTO public.project_comments (project_id, author_name, body) VALUES (:PP1, 'Guest', 'producer comment');
SELECT public.check_eq('a producer comment: no org, artist-visible, unresolved',
  (SELECT org_id IS NULL AND visibility = 'artist' AND resolved_at IS NULL FROM public.project_comments WHERE body = 'producer comment'), true);

-- ── The org is the project's (trigger), nobody else's ───────────────────

INSERT INTO public.project_comments (project_id, org_id, user_id, author_name, body, visibility) VALUES
  (:LP1, :L2, :AR, 'A&R', 'wrong org passed', 'artist');
SELECT public.check_eq('org_id is taken from the project, not the caller',
  (SELECT org_id::text FROM public.project_comments WHERE body = 'wrong org passed'), 'b1500000-0000-4000-8000-000000000001');
UPDATE public.project_comments SET org_id = :L2 WHERE body = 'wrong org passed';
SELECT public.check_eq('an update cannot move it either',
  (SELECT org_id::text FROM public.project_comments WHERE body = 'wrong org passed'), 'b1500000-0000-4000-8000-000000000001');
DELETE FROM public.project_comments WHERE body = 'wrong org passed';

-- ── Visibility constraints ──────────────────────────────────────────────

SELECT public.check_raises('an unknown visibility is refused',
  format($$INSERT INTO public.project_comments (project_id, author_name, body, visibility) VALUES (%L, 'x', 'x', 'public')$$, 'd1500000-0000-4000-8000-000000000011'),
  'check constraint|violates');
SELECT public.check_raises('a producer project cannot hold an internal comment',
  format($$INSERT INTO public.project_comments (project_id, author_name, body, visibility) VALUES (%L, 'x', 'x', 'internal')$$, 'd1500000-0000-4000-8000-000000000031'),
  'project_comments_internal_private');
INSERT INTO public.project_shares (project_id, token) VALUES (:LP1, 'l-share-150');
SELECT public.check_raises('an internal comment cannot be a share-link comment',
  format($$INSERT INTO public.project_comments (project_id, author_name, body, visibility, share_token) VALUES (%L, 'x', 'x', 'internal', 'l-share-150')$$, 'd1500000-0000-4000-8000-000000000011'),
  'project_comments_internal_private');
SELECT public.check_raises('...nor a portal thread',
  format($$INSERT INTO public.project_comments (project_id, author_name, body, visibility, contact_id) VALUES (%L, 'x', 'x', 'internal', %L)$$, 'd1500000-0000-4000-8000-000000000011', 'c1500000-0000-4000-8000-0000000000c1'),
  'project_comments_internal_private');

-- ── The fixture: L's threads on LP1 / LP2, L2's on XP1 ──────────────────

INSERT INTO public.project_comments (id, project_id, track_id, user_id, author_name, body, visibility, region_start, region_end) VALUES
  ('f1500000-0000-4000-8000-000000000001', :LP1, :S1, :AR, 'A&R', 'artist-visible note', 'artist', 12.5, 20),
  ('f1500000-0000-4000-8000-000000000002', :LP1, :S1, :AR, 'A&R', 'team-only note', 'internal', NULL, NULL),
  ('f1500000-0000-4000-8000-000000000004', :LP2, NULL, :AR, 'A&R', 'kilo project internal', 'internal', NULL, NULL),
  ('f1500000-0000-4000-8000-000000000005', :LP2, NULL, :AR, 'A&R', 'kilo project note', 'artist', NULL, NULL),
  ('f1500000-0000-4000-8000-000000000006', :XP1, NULL, :X2, 'X2', 'other label internal', 'internal', NULL, NULL);
INSERT INTO public.project_comments (project_id, user_id, author_name, body, visibility, share_token) VALUES
  (:LP1, NULL, 'Guest', 'guest via share link', 'artist', 'l-share-150');

SELECT public.check_raises('flipping an existing share-link comment to internal is refused too',
  $$UPDATE public.project_comments SET visibility = 'internal' WHERE share_token = 'l-share-150'$$,
  'project_comments_internal_private');

-- ── Threads: a reply under a team-only comment is team-only ─────────────

SELECT public.check_raises('an artist-visible reply under an internal comment is refused',
  format($$INSERT INTO public.project_comments (project_id, user_id, author_name, body, visibility, parent_id) VALUES (%L, %L, 'x', 'leaky reply', 'artist', %L)$$,
    'd1500000-0000-4000-8000-000000000011', 'a1500000-0000-4000-8000-000000000002', 'f1500000-0000-4000-8000-000000000002'),
  'reply to an internal comment is internal');
INSERT INTO public.project_comments (id, project_id, user_id, author_name, body, visibility, parent_id) VALUES
  ('f1500000-0000-4000-8000-000000000003', :LP1, :AR, 'A&R', 'internal reply', 'internal', 'f1500000-0000-4000-8000-000000000002');
SELECT public.check_raises('a reply must be in its parent''s project',
  format($$INSERT INTO public.project_comments (project_id, user_id, author_name, body, visibility, parent_id) VALUES (%L, %L, 'x', 'x', 'artist', %L)$$,
    'd1500000-0000-4000-8000-000000000012', 'a1500000-0000-4000-8000-000000000002', 'f1500000-0000-4000-8000-000000000001'),
  'is not a comment of project');
-- An internal reply under an artist-visible comment is allowed (the team talking).
INSERT INTO public.project_comments (project_id, user_id, author_name, body, visibility, parent_id) VALUES
  (:LP1, :AR, 'A&R', 'team aside under a visible note', 'internal', 'f1500000-0000-4000-8000-000000000001');

-- ── RLS: who reads what, with their own JWT ─────────────────────────────

SET ROLE authenticated;

SELECT public.as_user(:OWN);
SELECT public.check_eq('owner: every L comment, nothing of L2 or the producer',
  public.seen(),
  'artist-visible note | guest via share link | internal reply | kilo project internal | kilo project note | team aside under a visible note | team-only note');

SELECT public.as_user(:AR);
SELECT public.check_eq('A&R (whole org): the same', public.seen(),
  'artist-visible note | guest via share link | internal reply | kilo project internal | kilo project note | team aside under a visible note | team-only note');

SELECT public.as_user(:SC);
SELECT public.check_eq('a member scoped to Nova: LP1 only — internal included, LP2 not',
  public.seen(), 'artist-visible note | guest via share link | internal reply | team aside under a visible note | team-only note');

SELECT public.as_user(:ART);
SELECT public.check_eq('a roster artist reads ONLY artist-visible comments of their project, even holding business.read.internal as an override',
  public.seen(), 'artist-visible note');
SELECT public.check_eq('...and has no internal row at all',
  (SELECT count(*) FROM public.project_comments WHERE visibility = 'internal'), 0::bigint);
SELECT public.check_eq('labelos_can_read_internal_comments: false for the artist role', public.labelos_can_read_internal_comments('b1500000-0000-4000-8000-000000000001'), false);

SELECT public.as_user(:X2);
SELECT public.check_eq('another org''s owner reads only their own', public.seen(), 'other label internal');

SELECT public.as_user(:EXT);
SELECT public.check_eq('an external project member''s own JWT reads no comment at all (they go through the route)', public.seen(), '');

SELECT public.as_user(:NOBODY);
SELECT public.check_eq('a stranger reads nothing', public.seen(), '');
RESET ROLE;

SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
SELECT public.check_eq('anon reads nothing', (SELECT count(*) FROM public.project_comments), 0::bigint);
RESET ROLE;

-- The helper follows membership live: removing the artist locks them out.
DELETE FROM public.member_artist_scopes WHERE user_id = :ART;
SET ROLE authenticated;
SELECT public.as_user(:ART);
SELECT public.check_eq('a roster artist whose scope is removed reads nothing', public.seen(), '');
RESET ROLE;
INSERT INTO public.member_artist_scopes (org_id, user_id, contact_id) VALUES (:L, :ART, :C1);

-- ── Writes stay service-role only ───────────────────────────────────────

SET ROLE authenticated;
SELECT public.as_user(:AR);
SELECT public.check_raises('a member cannot INSERT an org comment through PostgREST',
  format($$INSERT INTO public.project_comments (project_id, user_id, author_name, body) VALUES (%L, %L, 'x', 'direct')$$, 'd1500000-0000-4000-8000-000000000011', 'a1500000-0000-4000-8000-000000000002'),
  'written through /api/org only|permission denied|row-level security');
RESET ROLE;

-- ── Resolve ─────────────────────────────────────────────────────────────

UPDATE public.project_comments SET resolved_at = now(), resolved_by = :AR WHERE id = 'f1500000-0000-4000-8000-000000000001';
SELECT public.check_eq('a thread can be resolved and reopened',
  (SELECT resolved_at IS NOT NULL AND resolved_by = 'a1500000-0000-4000-8000-000000000002' FROM public.project_comments WHERE id = 'f1500000-0000-4000-8000-000000000001'), true);
UPDATE public.project_comments SET resolved_at = NULL, resolved_by = NULL WHERE id = 'f1500000-0000-4000-8000-000000000001';

-- ── Replay: the migration is idempotent and keeps the policies ──────────

SELECT public.check_eq('exactly the two org policies on project_comments for authenticated/restrictive',
  (SELECT string_agg(policyname || ':' || permissive, ',' ORDER BY policyname) FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'project_comments' AND policyname LIKE 'org_member_%'),
  'org_member_guard:RESTRICTIVE,org_member_read:PERMISSIVE');
SELECT public.check_eq('both policies mention visibility',
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'project_comments' AND policyname LIKE 'org_member_%' AND qual LIKE '%visibility%'), 2::bigint);
