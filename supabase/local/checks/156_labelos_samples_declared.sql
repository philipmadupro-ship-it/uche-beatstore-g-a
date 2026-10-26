-- Behaviour checks for 156_labelos_samples_declared.sql (LABEL-29), run by
-- scripts/local-db/check.sh (npm run db:local:check). Every check RAISEs on
-- failure; psql stops at the first. reset.sh has already applied every
-- migration twice, so the constraint counts are the replay check.
--
-- Proven: existing rows read 'unknown'; one of each constraint survives the
-- replay; a producer row cannot carry a declaration; the value list is closed;
-- the note is capped; a clearance file must be restricted and of the song's
-- own org; deleting the file un-clears the song; the API roles cannot write
-- the columns (141's service-only trigger).

\set O    '''a1560000-0000-4000-8000-000000000001'''
\set X    '''a1560000-0000-4000-8000-000000000002'''
\set L    '''b1560000-0000-4000-8000-000000000001'''
\set L2   '''b1560000-0000-4000-8000-000000000002'''
\set LP1  '''d1560000-0000-4000-8000-000000000011'''
\set XP1  '''d1560000-0000-4000-8000-000000000021'''
\set S1   '''e1560000-0000-4000-8000-000000000001'''
\set PT   '''e1560000-0000-4000-8000-000000000004'''
\set AS1  '''a5560000-0000-4000-8000-000000000001'''
\set AS2  '''a5560000-0000-4000-8000-000000000002'''
\set AS3  '''a5560000-0000-4000-8000-000000000003'''

INSERT INTO auth.users (id, email) VALUES (:O, 'o156@local.test'), (:X, 'x156@local.test');
INSERT INTO public.organizations (id, name, slug, kind, created_by) VALUES
  (:L, 'Label L', 'label-l-156', 'label', :O),
  (:L2, 'Label L2', 'label-l2-156', 'label', :X);
INSERT INTO public.org_members (org_id, user_id, role, functions, scope) VALUES (:L, :O, 'owner', '{}', 'org'), (:L2, :X, 'owner', '{}', 'org');
INSERT INTO public.projects (id, user_id, org_id, name) VALUES (:LP1, NULL, :L, 'Nova EP'), (:XP1, NULL, :L2, 'L2 project');
INSERT INTO public.tracks (id, user_id, org_id, created_by, title, type, audio_url) VALUES
  (:S1, NULL, :L, :O, 'Nova demo', 'song', 'r2://private/orgs/l/s1');
INSERT INTO public.tracks (id, user_id, title, type, audio_url) VALUES (:PT, '0b0e1a57-0000-4000-8000-000000000001', 'P song', 'song', 'r2://private/p1');
INSERT INTO public.project_assets (id, user_id, created_by, project_id, kind, sensitivity, url) VALUES
  (:AS1, NULL, :O, :LP1, 'contract', 'restricted', 'r2://private/orgs/l/assets/clearance.pdf'),
  (:AS2, NULL, :O, :LP1, 'artwork', 'normal', 'r2://private/orgs/l/assets/art.png'),
  (:AS3, NULL, :X, :XP1, 'contract', 'restricted', 'r2://private/orgs/l2/assets/other.pdf');

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

-- ── Shape, after the double replay ─────────────────────────────────────────

SELECT public.check_eq('every existing row reads unknown, with no note and no file',
  (SELECT count(*) FROM public.tracks WHERE samples_declared = 'unknown' AND samples_clearance_note IS NULL AND samples_clearance_asset_id IS NULL),
  (SELECT count(*) FROM public.tracks));
SELECT public.check_eq('exactly one of each constraint survives the replay',
  (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.tracks'::regclass
     AND conname IN ('tracks_samples_declared_check', 'tracks_samples_note_length', 'tracks_samples_org_only')),
  3::bigint);
SELECT public.check_eq('one integrity trigger',
  (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.tracks'::regclass AND tgname = 'tracks_samples_asset_integrity' AND NOT tgisinternal),
  1::bigint);

-- ── The declaration ────────────────────────────────────────────────────────

SELECT public.check_raises('the value list is closed',
  $$UPDATE public.tracks SET samples_declared = 'maybe' WHERE id = 'e1560000-0000-4000-8000-000000000001'$$, 'samples_declared_check');
SELECT public.check_raises('a producer row cannot carry a declaration',
  $$UPDATE public.tracks SET samples_declared = 'none' WHERE id = 'e1560000-0000-4000-8000-000000000004'$$, 'samples_org_only');
SELECT public.check_raises('… or a note',
  $$UPDATE public.tracks SET samples_clearance_note = 'x' WHERE id = 'e1560000-0000-4000-8000-000000000004'$$, 'samples_org_only');
SELECT public.check_raises('the note is capped at 2000 characters',
  $$UPDATE public.tracks SET samples_declared = 'yes', samples_clearance_note = repeat('x', 2001) WHERE id = 'e1560000-0000-4000-8000-000000000001'$$, 'samples_note_length');

UPDATE public.tracks SET samples_declared = 'yes', samples_clearance_note = 'Cleared with the publisher, 2026-09-01' WHERE id = :S1;
SELECT public.check_eq('an org song takes a declaration and a note',
  (SELECT samples_declared || '/' || samples_clearance_note FROM public.tracks WHERE id = :S1),
  'yes/Cleared with the publisher, 2026-09-01');

-- ── The clearance file ─────────────────────────────────────────────────────

SELECT public.check_raises('a normal (non-restricted) file is not a clearance',
  $$UPDATE public.tracks SET samples_clearance_asset_id = 'a5560000-0000-4000-8000-000000000002' WHERE id = 'e1560000-0000-4000-8000-000000000001'$$,
  'must be restricted');
SELECT public.check_raises('another org''s file is not a clearance',
  $$UPDATE public.tracks SET samples_clearance_asset_id = 'a5560000-0000-4000-8000-000000000003' WHERE id = 'e1560000-0000-4000-8000-000000000001'$$,
  'song''s organization');
SELECT public.check_raises('a file that does not exist is not a clearance',
  $$UPDATE public.tracks SET samples_clearance_asset_id = 'a5560000-0000-4000-8000-0000000000ff' WHERE id = 'e1560000-0000-4000-8000-000000000001'$$,
  'does not exist');

UPDATE public.tracks SET samples_clearance_asset_id = :AS1 WHERE id = :S1;
SELECT public.check_eq('a restricted file of the same org is accepted',
  (SELECT samples_clearance_asset_id FROM public.tracks WHERE id = :S1), 'a5560000-0000-4000-8000-000000000001'::uuid);

DELETE FROM public.project_assets WHERE id = :AS1;
SELECT public.check_eq('deleting the file un-clears the song instead of blocking the delete',
  (SELECT samples_clearance_asset_id FROM public.tracks WHERE id = :S1), NULL::uuid);

-- ── Who can write ──────────────────────────────────────────────────────────

SELECT set_config('request.jwt.claims', json_build_object('sub', :O::text, 'role', 'authenticated')::text, false);
SET ROLE authenticated;
-- Either the service-only trigger refuses it or RLS matches no row: what must hold is that nothing changed.
DO $$ BEGIN
  UPDATE public.tracks SET samples_declared = 'none' WHERE id = 'e1560000-0000-4000-8000-000000000001';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
RESET ROLE;
SELECT public.check_eq('an authenticated member cannot write the declaration (org rows are service-role only)',
  (SELECT samples_declared FROM public.tracks WHERE id = :S1), 'yes');
