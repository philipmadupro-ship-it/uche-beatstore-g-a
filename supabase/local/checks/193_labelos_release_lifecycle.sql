-- Behaviour checks for 193_labelos_release_lifecycle.sql (LABEL-56), run by
-- scripts/local-db/check.sh (npm run db:local:check). Every check RAISEs on failure.
--
-- Cast: O the owner of label L with one artist contact C, one project, and
-- songs on releases in each state:
--   S_NONE no release · S_DRAFT only a draft · S_DEL a delivered release ·
--   S_WDR a withdrawn release · S_CAN only a cancelled one ·
--   S_IMP a draft that was entered as already out · S_BOTH a draft AND a delivered release.
--
-- Proven: 'withdrawn' is a state, a bad one still is not, a withdrawn release
-- cannot sit on the store, and labelos_track_is_finished changes ONLY its
-- release arm — a draft no longer finishes a song, a delivered / withdrawn /
-- imported release does, a cancelled one does not, the selected-song and
-- master arms are as they were.

\set O  '''a1930000-0000-4000-8000-000000000001'''
\set L  '''b1930000-0000-4000-8000-000000000001'''
\set C  '''c1930000-0000-4000-8000-000000000001'''
\set PR '''d1930000-0000-4000-8000-000000000001'''
\set S_NONE  '''e1930000-0000-4000-8000-000000000001'''
\set S_DRAFT '''e1930000-0000-4000-8000-000000000002'''
\set S_DEL   '''e1930000-0000-4000-8000-000000000003'''
\set S_WDR   '''e1930000-0000-4000-8000-000000000004'''
\set S_CAN   '''e1930000-0000-4000-8000-000000000005'''
\set S_IMP   '''e1930000-0000-4000-8000-000000000006'''
\set S_BOTH  '''e1930000-0000-4000-8000-000000000007'''
\set S_SEL   '''e1930000-0000-4000-8000-000000000008'''
\set S_MASTER '''e1930000-0000-4000-8000-000000000009'''
\set S_VER   '''e1930000-0000-4000-8000-00000000000a'''
\set R_DRAFT '''91930000-0000-4000-8000-000000000001'''
\set R_DEL   '''91930000-0000-4000-8000-000000000002'''
\set R_WDR   '''91930000-0000-4000-8000-000000000003'''
\set R_CAN   '''91930000-0000-4000-8000-000000000004'''
\set R_IMP   '''91930000-0000-4000-8000-000000000005'''

INSERT INTO auth.users (id, email) VALUES (:O, 'o193@local.test');
INSERT INTO public.organizations (id, name, slug, kind, created_by) VALUES (:L, 'Label 193', 'label-193', 'label', :O);
INSERT INTO public.org_members (org_id, user_id, role, functions, scope) VALUES (:L, :O, 'owner', '{}', 'org');
INSERT INTO public.contacts (id, org_id, user_id, name, category) VALUES (:C, :L, NULL, 'Nova 193', 'artist');
INSERT INTO public.projects (id, org_id, user_id, name) VALUES (:PR, :L, NULL, 'Release project 193');
INSERT INTO public.tracks (id, user_id, org_id, created_by, title, type, audio_url, song_stage) VALUES
  (:S_NONE,  NULL, :L, :O, 'none',   'song', 'r2://private/orgs/l/193-1', 'inbox'),
  (:S_DRAFT, NULL, :L, :O, 'draft',  'song', 'r2://private/orgs/l/193-2', 'inbox'),
  (:S_DEL,   NULL, :L, :O, 'deliv',  'song', 'r2://private/orgs/l/193-3', 'inbox'),
  (:S_WDR,   NULL, :L, :O, 'wdr',    'song', 'r2://private/orgs/l/193-4', 'inbox'),
  (:S_CAN,   NULL, :L, :O, 'cancel', 'song', 'r2://private/orgs/l/193-5', 'inbox'),
  (:S_IMP,   NULL, :L, :O, 'import', 'song', 'r2://private/orgs/l/193-6', 'inbox'),
  (:S_BOTH,  NULL, :L, :O, 'both',   'song', 'r2://private/orgs/l/193-7', 'inbox'),
  (:S_SEL,   NULL, :L, :O, 'select', 'song', 'r2://private/orgs/l/193-8', 'selected'),
  (:S_MASTER, NULL, :L, :O, 'master', 'song', 'r2://private/orgs/l/193-9', NULL),
  (:S_VER,   NULL, :L, :O, 'version', 'song', 'r2://private/orgs/l/193-a', NULL);
INSERT INTO public.track_links (from_track_id, to_track_id, user_id, relation) VALUES
  (:S_NONE, :S_MASTER, NULL, 'master'), (:S_NONE, :S_VER, NULL, 'version');

INSERT INTO public.releases (id, org_id, project_id, contact_id, title, created_by) VALUES
  (:R_DRAFT, :L, :PR, :C, 'Draft 193', :O), (:R_DEL, :L, :PR, :C, 'Delivered 193', :O),
  (:R_WDR, :L, :PR, :C, 'Withdrawn 193', :O), (:R_CAN, :L, :PR, :C, 'Cancelled 193', :O),
  (:R_IMP, :L, :PR, :C, 'Imported 193', :O);
INSERT INTO public.release_items (release_id, position, song_track_id, master_track_id) VALUES
  (:R_DRAFT, 1, :S_DRAFT, :S_DRAFT), (:R_DRAFT, 2, :S_BOTH, :S_BOTH),
  (:R_DEL, 1, :S_DEL, :S_DEL), (:R_DEL, 2, :S_BOTH, :S_BOTH),
  (:R_WDR, 1, :S_WDR, :S_WDR), (:R_CAN, 1, :S_CAN, :S_CAN), (:R_IMP, 1, :S_IMP, :S_IMP);

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

-- Before any state is touched: a draft finishes nothing (the changed arm).
SELECT public.check_eq('a song on only a draft release is working', public.labelos_track_is_finished(:S_DRAFT), false);
SELECT public.check_eq('a song on no release is working', public.labelos_track_is_finished(:S_NONE), false);

UPDATE public.releases SET state = 'delivered', delivered_at = now() WHERE id IN (:R_DEL, :R_WDR);
SELECT public.check_eq('a delivered release finishes its song', public.labelos_track_is_finished(:S_DEL), true);
SELECT public.check_eq('a song on a draft AND a delivered release is finished', public.labelos_track_is_finished(:S_BOTH), true);

-- 'withdrawn' is a state; an unknown one still is not.
UPDATE public.releases SET state = 'withdrawn' WHERE id = :R_WDR;
SELECT public.check_eq('a withdrawn release is a state', (SELECT state FROM public.releases WHERE id = :R_WDR), 'withdrawn');
SELECT public.check_raises('an unknown state is refused', format($q$UPDATE public.releases SET state = 'archived' WHERE id = %L$q$, :R_DRAFT), 'releases_state_check');
SELECT public.check_eq('a withdrawn release went out: its song keeps the class', public.labelos_track_is_finished(:S_WDR), true);
SELECT public.check_raises('a withdrawn release cannot sit on the store',
  format($q$UPDATE public.releases SET store_listed = true, store_listed_at = now() WHERE id = %L$q$, :R_WDR), 'releases_store_listed_released');

UPDATE public.releases SET state = 'cancelled' WHERE id = :R_CAN;
SELECT public.check_eq('a cancelled release finishes nothing', public.labelos_track_is_finished(:S_CAN), false);

UPDATE public.releases SET imported_released = true WHERE id = :R_IMP;
SELECT public.check_eq('an imported (already out) release finishes its song', public.labelos_track_is_finished(:S_IMP), true);
UPDATE public.releases SET state = 'cancelled' WHERE id = :R_IMP;
SELECT public.check_eq('… unless it is cancelled', public.labelos_track_is_finished(:S_IMP), false);

-- The other arms are as they were.
SELECT public.check_eq('a selected song is finished', public.labelos_track_is_finished(:S_SEL), true);
SELECT public.check_eq('a song''s master is finished', public.labelos_track_is_finished(:S_MASTER), true);
SELECT public.check_eq('a song''s version stays working', public.labelos_track_is_finished(:S_VER), false);
