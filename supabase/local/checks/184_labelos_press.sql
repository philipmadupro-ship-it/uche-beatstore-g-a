-- Behaviour checks for 184_labelos_press.sql (LABEL-66), run by
-- scripts/local-db/check.sh (npm run db:local:check). Every check RAISEs on failure.
--
-- Proven, as the roles PostgREST uses:
--   - five org-only tables (no user_id), RLS on, one policy each that grants nothing;
--     a member with their own JWT reads, writes and deletes nothing (share hashes included);
--   - one kit per release, of the release's org; a kit never moves;
--   - a photo is an unrestricted artwork/photo file of the RELEASE'S OWN project;
--   - link and coverage URLs are https only, no spaces; length bounds on every text;
--   - a share stores a 64-hex hash only; its kit and token never change; a token is unique;
--   - an outreach row needs a press contact of the same org, once per release + contact;
--   - deleting the organization deletes every row.

\set P  '''0b0e1a57-0000-4000-8000-000000000001'''
\set O  '''a1840000-0000-4000-8000-000000000001'''
\set M  '''a1840000-0000-4000-8000-000000000002'''
\set X  '''a1840000-0000-4000-8000-000000000003'''
\set L  '''b1840000-0000-4000-8000-000000000001'''
\set L2 '''b1840000-0000-4000-8000-000000000002'''
\set C1 '''c1840000-0000-4000-8000-0000000000c1'''
\set CP '''c1840000-0000-4000-8000-0000000000c2'''
\set CS '''c1840000-0000-4000-8000-0000000000c3'''
\set CX '''c1840000-0000-4000-8000-0000000000c4'''
\set PR '''d1840000-0000-4000-8000-0000000000d1'''
\set PR2 '''d1840000-0000-4000-8000-0000000000d2'''
\set R  '''e1840000-0000-4000-8000-0000000000e1'''
\set R2 '''e1840000-0000-4000-8000-0000000000e2'''
\set KIT '''f1840000-0000-4000-8000-0000000000f1'''
\set A1 '''91840000-0000-4000-8000-0000000000a1'''
\set A2 '''91840000-0000-4000-8000-0000000000a2'''
\set A3 '''91840000-0000-4000-8000-0000000000a3'''
\set A4 '''91840000-0000-4000-8000-0000000000a4'''

INSERT INTO auth.users (id, email) VALUES
  (:O, 'o184@local.test'), (:M, 'm184@local.test'), (:X, 'x184@local.test');
INSERT INTO public.organizations (id, name, slug, kind, created_by, settings) VALUES
  (:L, 'Label L', 'label-l-184', 'label', :O, '{}'),
  (:L2, 'Label L2', 'label-l2-184', 'label', :X, '{}');
INSERT INTO public.org_members (org_id, user_id, role, functions, scope, cap_grants) VALUES
  (:L, :O, 'owner', '{}', 'org', '{}'),
  (:L, :M, 'member', '{pr}', 'org', '{}'),
  (:L2, :X, 'owner', '{}', 'org', '{}');
INSERT INTO public.contacts (id, user_id, org_id, name, email, category, secondary_category) VALUES
  (:C1, NULL, :L, 'Nova', 'nova184@local.test', 'artist', NULL),
  (:CP, NULL, :L, 'Pat Press', 'pat184@local.test', 'press', NULL),
  (:CS, NULL, :L, 'Sam Second', 'sam184@local.test', 'artist', 'press'),
  (:CX, NULL, :L2, 'Xena Press', 'xena184@local.test', 'press', NULL);
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


-- ── Shape of the tables ─────────────────────────────────────────────────

SELECT public.check_eq('no press table has a user_id',
  (SELECT count(*)::int FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('press_kits','press_kit_links','press_kit_photos','press_kit_shares','press_outreach') AND column_name = 'user_id'), 0);
SELECT public.check_eq('all five tables have RLS on',
  (SELECT count(*)::int FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname IN ('press_kits','press_kit_links','press_kit_photos','press_kit_shares','press_outreach') AND relrowsecurity), 5);
SELECT public.check_eq('every policy grants nothing',
  (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public' AND tablename LIKE 'press\_%' AND (qual <> 'false' OR cmd <> 'ALL')), 0);

-- ── Kits ────────────────────────────────────────────────────────────────

INSERT INTO public.press_kits (id, org_id, release_id, headline, bio, pre_embargo_note, embargo_at, created_by)
  VALUES (:KIT, :L, :R, 'Nova returns', 'Bio text', 'Coming soon', now() + interval '3 days', :O);
SELECT public.check_raises('one kit per release',
  $$INSERT INTO public.press_kits (org_id, release_id) VALUES ('b1840000-0000-4000-8000-000000000001', 'e1840000-0000-4000-8000-0000000000e1')$$,
  'press_kits_one_per_release');
SELECT public.check_raises('the release must be of the same org',
  $$INSERT INTO public.press_kits (org_id, release_id) VALUES ('b1840000-0000-4000-8000-000000000002', 'e1840000-0000-4000-8000-0000000000e2')$$,
  'same organization');
SELECT public.check_raises('a kit never moves to another release',
  $$UPDATE public.press_kits SET release_id = 'e1840000-0000-4000-8000-0000000000e2' WHERE id = 'f1840000-0000-4000-8000-0000000000f1'$$,
  'keeps its organization and its release');
SELECT public.check_raises('an empty headline is refused',
  $$UPDATE public.press_kits SET headline = '  ' WHERE id = 'f1840000-0000-4000-8000-0000000000f1'$$,
  'headline_check|check constraint');
SELECT public.check_raises('a bio over 3000 characters is refused',
  $$UPDATE public.press_kits SET bio = repeat('x', 3001) WHERE id = 'f1840000-0000-4000-8000-0000000000f1'$$,
  'bio_check|check constraint');

-- ── Links ───────────────────────────────────────────────────────────────

INSERT INTO public.press_kit_links (org_id, kit_id, label, url) VALUES (:L, :KIT, 'Instagram', 'https://instagram.com/nova');
SELECT public.check_raises('a link must be https',
  $$INSERT INTO public.press_kit_links (org_id, kit_id, label, url) VALUES ('b1840000-0000-4000-8000-000000000001', 'f1840000-0000-4000-8000-0000000000f1', 'x', 'http://example.com')$$,
  'url_check|check constraint');
SELECT public.check_raises('a javascript: link is refused',
  $$INSERT INTO public.press_kit_links (org_id, kit_id, label, url) VALUES ('b1840000-0000-4000-8000-000000000001', 'f1840000-0000-4000-8000-0000000000f1', 'x', 'javascript:alert(1)')$$,
  'url_check|check constraint');
SELECT public.check_raises('a link with a space is refused',
  $$INSERT INTO public.press_kit_links (org_id, kit_id, label, url) VALUES ('b1840000-0000-4000-8000-000000000001', 'f1840000-0000-4000-8000-0000000000f1', 'x', 'https://example.com/a b')$$,
  'url_check|check constraint');
SELECT public.check_raises('a child cannot name a kit of another org',
  $$INSERT INTO public.press_kit_links (org_id, kit_id, label, url) VALUES ('b1840000-0000-4000-8000-000000000002', 'f1840000-0000-4000-8000-0000000000f1', 'x', 'https://example.com')$$,
  'press_kit_links_kit|foreign key');

-- ── Photos ──────────────────────────────────────────────────────────────

INSERT INTO public.press_kit_photos (org_id, kit_id, asset_id, caption, pre_embargo) VALUES (:L, :KIT, :A1, 'Cover shoot', true);
SELECT public.check_raises('a photo is attached once',
  $$INSERT INTO public.press_kit_photos (org_id, kit_id, asset_id) VALUES ('b1840000-0000-4000-8000-000000000001', 'f1840000-0000-4000-8000-0000000000f1', '91840000-0000-4000-8000-0000000000a1')$$,
  'press_kit_photos_once');
SELECT public.check_raises('a restricted file is refused',
  $$INSERT INTO public.press_kit_photos (org_id, kit_id, asset_id) VALUES ('b1840000-0000-4000-8000-000000000001', 'f1840000-0000-4000-8000-0000000000f1', '91840000-0000-4000-8000-0000000000a2')$$,
  'unrestricted artwork or photo');
SELECT public.check_raises('a file of another project of the org is refused',
  $$INSERT INTO public.press_kit_photos (org_id, kit_id, asset_id) VALUES ('b1840000-0000-4000-8000-000000000001', 'f1840000-0000-4000-8000-0000000000f1', '91840000-0000-4000-8000-0000000000a3')$$,
  'unrestricted artwork or photo');
SELECT public.check_raises('a non-visual file is refused',
  $$INSERT INTO public.press_kit_photos (org_id, kit_id, asset_id) VALUES ('b1840000-0000-4000-8000-000000000001', 'f1840000-0000-4000-8000-0000000000f1', '91840000-0000-4000-8000-0000000000a4')$$,
  'unrestricted artwork or photo');
SELECT public.check_raises('a photo keeps its file',
  $$UPDATE public.press_kit_photos SET asset_id = '91840000-0000-4000-8000-0000000000a3'$$,
  'keeps its kit and its file');

-- ── Shares ──────────────────────────────────────────────────────────────

INSERT INTO public.press_kit_shares (org_id, kit_id, token_hash, label, created_by) VALUES (:L, :KIT, repeat('a', 64), 'Pitchfork', :O);
SELECT public.check_raises('a token hash is 64 hex characters',
  $$INSERT INTO public.press_kit_shares (org_id, kit_id, token_hash, label) VALUES ('b1840000-0000-4000-8000-000000000001', 'f1840000-0000-4000-8000-0000000000f1', 'plain-token', 'x')$$,
  'token_hash_check|check constraint');
SELECT public.check_raises('a token is unique',
  $$INSERT INTO public.press_kit_shares (org_id, kit_id, token_hash, label) VALUES ('b1840000-0000-4000-8000-000000000001', 'f1840000-0000-4000-8000-0000000000f1', repeat('a', 64), 'x')$$,
  'press_kit_shares_token');
SELECT public.check_raises('a share keeps its token',
  $$UPDATE public.press_kit_shares SET token_hash = repeat('b', 64)$$,
  'keeps its kit and its token');
UPDATE public.press_kit_shares SET revoked_at = now(), revoked_by = :O;
SELECT public.check_eq('a share can be revoked', (SELECT revoked_at IS NOT NULL FROM public.press_kit_shares), true);

-- ── Outreach ────────────────────────────────────────────────────────────

INSERT INTO public.press_outreach (org_id, release_id, contact_id, sent_at, created_by) VALUES (:L, :R, :CP, now(), :O);
INSERT INTO public.press_outreach (org_id, release_id, contact_id) VALUES (:L, :R, :CS);
SELECT public.check_eq('a secondary press role counts', (SELECT count(*)::int FROM public.press_outreach WHERE contact_id = :CS), 1);
SELECT public.check_raises('once per release and contact',
  $$INSERT INTO public.press_outreach (org_id, release_id, contact_id) VALUES ('b1840000-0000-4000-8000-000000000001', 'e1840000-0000-4000-8000-0000000000e1', 'c1840000-0000-4000-8000-0000000000c2')$$,
  'press_outreach_once');
SELECT public.check_raises('an artist contact is not a press contact',
  $$INSERT INTO public.press_outreach (org_id, release_id, contact_id) VALUES ('b1840000-0000-4000-8000-000000000001', 'e1840000-0000-4000-8000-0000000000e2', 'c1840000-0000-4000-8000-0000000000c1')$$,
  'must be a press contact');
SELECT public.check_raises('a press contact of another org is refused',
  $$INSERT INTO public.press_outreach (org_id, release_id, contact_id) VALUES ('b1840000-0000-4000-8000-000000000001', 'e1840000-0000-4000-8000-0000000000e2', 'c1840000-0000-4000-8000-0000000000c4')$$,
  'must be a press contact');
SELECT public.check_raises('a release of another org is refused',
  $$INSERT INTO public.press_outreach (org_id, release_id, contact_id) VALUES ('b1840000-0000-4000-8000-000000000002', 'e1840000-0000-4000-8000-0000000000e2', 'c1840000-0000-4000-8000-0000000000c4')$$,
  'same organization');
SELECT public.check_raises('coverage must be https',
  $$UPDATE public.press_outreach SET coverage_url = 'http://example.com/a' WHERE contact_id = 'c1840000-0000-4000-8000-0000000000c2'$$,
  'coverage_url_check|check constraint');
UPDATE public.press_outreach SET coverage_url = 'https://example.com/review' WHERE contact_id = :CP;
SELECT public.check_raises('a row keeps its contact',
  $$UPDATE public.press_outreach SET contact_id = 'c1840000-0000-4000-8000-0000000000c3' WHERE contact_id = 'c1840000-0000-4000-8000-0000000000c2'$$,
  'keeps its release and its contact');

-- ── The API roles read and write nothing ────────────────────────────────

SET ROLE authenticated;
SELECT public.as_user('a1840000-0000-4000-8000-000000000001');
SELECT public.check_raises('the owner cannot read kits', $$SELECT count(*) FROM public.press_kits$$, 'permission denied');
SELECT public.check_raises('the owner cannot read share hashes', $$SELECT token_hash FROM public.press_kit_shares$$, 'permission denied');
SELECT public.check_raises('the owner cannot forge a kit',
  $$INSERT INTO public.press_kits (org_id, release_id) VALUES ('b1840000-0000-4000-8000-000000000001', gen_random_uuid())$$, 'permission denied');
SELECT public.as_user('a1840000-0000-4000-8000-000000000002');
SELECT public.check_raises('a pr member cannot read outreach with their own JWT', $$SELECT count(*) FROM public.press_outreach$$, 'permission denied');
SELECT public.check_raises('a member cannot mint a share', $$INSERT INTO public.press_kit_shares (org_id, kit_id, token_hash, label) VALUES ('b1840000-0000-4000-8000-000000000001', 'f1840000-0000-4000-8000-0000000000f1', repeat('c', 64), 'x')$$, 'permission denied');
RESET ROLE;
SET ROLE anon;
SELECT public.check_raises('anon cannot read kits', $$SELECT count(*) FROM public.press_kits$$, 'permission denied');
SELECT public.check_raises('anon cannot read photos', $$SELECT count(*) FROM public.press_kit_photos$$, 'permission denied');
RESET ROLE;

-- ── The org's hard delete takes everything ──────────────────────────────

UPDATE public.organizations SET deleted_at = now() - interval '31 days' WHERE id = :L;
DELETE FROM public.organizations WHERE id = :L;
SELECT public.check_eq('deleting the org deletes every press row',
  (SELECT (SELECT count(*) FROM public.press_kits) + (SELECT count(*) FROM public.press_kit_links) + (SELECT count(*) FROM public.press_kit_photos)
        + (SELECT count(*) FROM public.press_kit_shares) + (SELECT count(*) FROM public.press_outreach))::int, 0);
SELECT public.check_eq('the other org''s contact survives', (SELECT count(*)::int FROM public.contacts WHERE id = :CX), 1);
