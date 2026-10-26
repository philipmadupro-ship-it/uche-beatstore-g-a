-- Behaviour checks for 158_labelos_release_store_playback.sql (LABEL-42).
-- Run by scripts/local-db/check.sh. Every check RAISEs on failure.
--
-- Proven: the new column defaults to 'preview', accepts only 'preview' /
-- 'full', and 144's rules still hold beside it (a draft that is not imported
-- cannot be store_listed; an imported one can).

\set O  '''a1580000-0000-4000-8000-000000000001'''
\set L  '''b1580000-0000-4000-8000-000000000001'''
\set C1 '''c1580000-0000-4000-8000-0000000000c1'''
\set P1 '''d1580000-0000-4000-8000-000000000011'''
\set R1 '''f1580000-0000-4000-8000-0000000000a1'''
\set R2 '''f1580000-0000-4000-8000-0000000000a2'''

INSERT INTO auth.users (id, email) VALUES (:O, 'o158@local.test');
INSERT INTO public.organizations (id, name, slug, kind, created_by) VALUES (:L, 'Label 158', 'label-158', 'label', :O);
INSERT INTO public.contacts (id, user_id, org_id, name, email, category) VALUES (:C1, NULL, :L, 'Nova', 'nova158@local.test', 'artist');
INSERT INTO public.projects (id, user_id, org_id, name) VALUES (:P1, NULL, :L, 'Nova EP');
INSERT INTO public.releases (id, org_id, project_id, contact_id, title, created_by) VALUES (:R1, :L, :P1, :C1, 'Draft', :O);

DO $$
DECLARE v text;
BEGIN
  SELECT store_playback INTO v FROM public.releases WHERE id = 'f1580000-0000-4000-8000-0000000000a1';
  IF v IS DISTINCT FROM 'preview' THEN RAISE EXCEPTION 'CHECK FAILED: default playback is %, want preview', v; END IF;

  UPDATE public.releases SET store_playback = 'full' WHERE id = 'f1580000-0000-4000-8000-0000000000a1';

  BEGIN
    UPDATE public.releases SET store_playback = 'loud' WHERE id = 'f1580000-0000-4000-8000-0000000000a1';
    RAISE EXCEPTION 'CHECK FAILED: playback "loud" was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- 144: an undelivered, non-imported release cannot be listed ...
  BEGIN
    UPDATE public.releases SET store_listed = true, store_listed_at = now() WHERE id = 'f1580000-0000-4000-8000-0000000000a1';
    RAISE EXCEPTION 'CHECK FAILED: a draft release was listed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- ... an imported one can.
  UPDATE public.releases SET imported_released = true, state = 'delivered', delivered_at = now(),
    store_listed = true, store_listed_at = now() WHERE id = 'f1580000-0000-4000-8000-0000000000a1';
  IF NOT (SELECT store_listed FROM public.releases WHERE id = 'f1580000-0000-4000-8000-0000000000a1') THEN
    RAISE EXCEPTION 'CHECK FAILED: an imported release could not be listed';
  END IF;
END $$;

-- A listed release's tracklist is held by the database: no insert, edit or
-- delete of an item, and the cascade of deleting the release still works.
\set T1 '''e1580000-0000-4000-8000-000000000001'''
INSERT INTO public.tracks (id, user_id, org_id, created_by, title, type, audio_url, song_stage)
  VALUES (:T1, NULL, :L, :O, 'Song', 'song', 'r2://private/orgs/l/s1', 'selected');
INSERT INTO public.releases (id, org_id, project_id, contact_id, title, created_by) VALUES (:R2, :L, :P1, :C1, 'Second', :O);
INSERT INTO public.release_items (id, release_id, org_id, position, song_track_id, master_track_id)
  VALUES ('a1580000-0000-4000-8000-000000000001', :R2, :L, 1, :T1, :T1);
UPDATE public.releases SET imported_released = true, state = 'delivered', delivered_at = now(), store_listed = true, store_listed_at = now() WHERE id = :R2;

DO $$
BEGIN
  BEGIN
    INSERT INTO public.release_items (release_id, org_id, position, song_track_id, master_track_id)
      VALUES ('f1580000-0000-4000-8000-0000000000a2', 'b1580000-0000-4000-8000-000000000001', 2, 'e1580000-0000-4000-8000-000000000001', 'e1580000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'CHECK FAILED: an item was added to a listed release';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.release_items SET explicit = true WHERE release_id = 'f1580000-0000-4000-8000-0000000000a2';
    RAISE EXCEPTION 'CHECK FAILED: an item of a listed release was edited';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    DELETE FROM public.release_items WHERE release_id = 'f1580000-0000-4000-8000-0000000000a2';
    RAISE EXCEPTION 'CHECK FAILED: an item of a listed release was removed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- Off the store, the tracklist changes again.
  UPDATE public.releases SET store_listed = false, store_listed_at = NULL WHERE id = 'f1580000-0000-4000-8000-0000000000a2';
  UPDATE public.release_items SET explicit = true WHERE release_id = 'f1580000-0000-4000-8000-0000000000a2';
  -- And deleting a listed release (cascade) is not blocked by its own items.
  UPDATE public.releases SET store_listed = true, store_listed_at = now() WHERE id = 'f1580000-0000-4000-8000-0000000000a2';
  DELETE FROM public.releases WHERE id = 'f1580000-0000-4000-8000-0000000000a2';
  IF EXISTS (SELECT 1 FROM public.release_items WHERE release_id = 'f1580000-0000-4000-8000-0000000000a2') THEN
    RAISE EXCEPTION 'CHECK FAILED: the cascade left items behind';
  END IF;
END $$;

-- Purging an organization that still has a LISTED release is not blocked by the trigger.
UPDATE public.releases SET store_listed = false, store_listed_at = NULL WHERE id = :R1;
INSERT INTO public.release_items (id, release_id, org_id, position, song_track_id, master_track_id)
  VALUES ('a1580000-0000-4000-8000-000000000002', :R1, :L, 1, :T1, :T1);
UPDATE public.releases SET store_listed = true, store_listed_at = now() WHERE id = :R1;
DO $$
BEGIN
  DELETE FROM public.organizations WHERE id = 'b1580000-0000-4000-8000-000000000001';
  IF EXISTS (SELECT 1 FROM public.release_items WHERE org_id = 'b1580000-0000-4000-8000-000000000001')
     OR EXISTS (SELECT 1 FROM public.releases WHERE org_id = 'b1580000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'CHECK FAILED: purging an organization with a listed release left rows behind';
  END IF;
END $$;
