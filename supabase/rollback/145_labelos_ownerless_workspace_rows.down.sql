-- Rollback for 145_labelos_ownerless_workspace_rows.sql (LABEL-17).
--
-- Lives outside supabase/migrations/ on purpose: scripts/apply-migrations.sh
-- applies every *.sql in that folder. Run by hand only.
--
--   1. ownerless rows of the four tables 145 made nullable are deleted
--      (NOT NULL cannot come back while they exist) — org rows only, since
--      a producer row always had an owner;
--   2. NOT NULL comes back on those four;
--   3. the five trigger functions are put back as 141 §4 wrote them.
-- project_contacts keeps its nullable user_id: that is 144's, and 144's
-- rollback deletes the ownerless links and restores NOT NULL.

DELETE FROM public.contact_track_states WHERE user_id IS NULL;
DELETE FROM public.artist_portals WHERE user_id IS NULL;
DELETE FROM public.artist_messages WHERE user_id IS NULL;
DELETE FROM public.song_beats WHERE user_id IS NULL;

ALTER TABLE public.contact_track_states ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE public.artist_portals ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE public.artist_messages ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE public.song_beats ALTER COLUMN user_id SET NOT NULL;

-- 141 §4's versions.
-- 122
CREATE OR REPLACE FUNCTION public.project_contacts_same_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.projects p
    JOIN public.contacts c ON c.id = NEW.contact_id AND c.org_id = p.org_id
    WHERE p.id = NEW.project_id AND p.org_id IS NOT NULL
  ) THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = NEW.project_id AND p.user_id = NEW.user_id AND p.org_id IS NULL) THEN
    RAISE EXCEPTION 'project_contacts: project % is not owned by %', NEW.project_id, NEW.user_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = NEW.contact_id AND c.user_id = NEW.user_id AND c.org_id IS NULL) THEN
    RAISE EXCEPTION 'project_contacts: contact % is not owned by %', NEW.contact_id, NEW.user_id;
  END IF;
  RETURN NEW;
END $$;

-- 123
CREATE OR REPLACE FUNCTION public.contact_track_states_same_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.contacts c
    JOIN public.tracks t ON t.id = NEW.track_id AND t.org_id = c.org_id
    WHERE c.id = NEW.contact_id AND c.org_id IS NOT NULL
      AND (NEW.project_id IS NULL OR EXISTS (
        SELECT 1 FROM public.projects p WHERE p.id = NEW.project_id AND p.org_id = c.org_id
      ))
  ) THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = NEW.contact_id AND c.user_id = NEW.user_id AND c.org_id IS NULL) THEN
    RAISE EXCEPTION 'contact_track_states: contact % is not owned by %', NEW.contact_id, NEW.user_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tracks t WHERE t.id = NEW.track_id AND t.user_id = NEW.user_id AND t.org_id IS NULL) THEN
    RAISE EXCEPTION 'contact_track_states: track % is not owned by %', NEW.track_id, NEW.user_id;
  END IF;
  RETURN NEW;
END $$;

-- 125
CREATE OR REPLACE FUNCTION public.artist_portals_same_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = NEW.contact_id AND c.org_id IS NOT NULL) THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = NEW.contact_id AND c.user_id = NEW.user_id AND c.org_id IS NULL) THEN
    RAISE EXCEPTION 'artist_portals: contact % is not owned by %', NEW.contact_id, NEW.user_id;
  END IF;
  RETURN NEW;
END $$;

-- 130
CREATE OR REPLACE FUNCTION public.artist_messages_same_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.contacts c
    WHERE c.id = NEW.contact_id AND c.org_id IS NOT NULL
      AND (NEW.project_id IS NULL OR EXISTS (
        SELECT 1 FROM public.projects p WHERE p.id = NEW.project_id AND p.org_id = c.org_id
      ))
  ) THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = NEW.contact_id AND c.user_id = NEW.user_id AND c.org_id IS NULL) THEN
    RAISE EXCEPTION 'artist_messages: contact % is not owned by %', NEW.contact_id, NEW.user_id;
  END IF;
  IF NEW.project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.projects p WHERE p.id = NEW.project_id AND p.user_id = NEW.user_id AND p.org_id IS NULL
  ) THEN
    RAISE EXCEPTION 'artist_messages: project % is not owned by %', NEW.project_id, NEW.user_id;
  END IF;
  RETURN NEW;
END $$;

-- 132
CREATE OR REPLACE FUNCTION public.song_beats_same_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.tracks s
    JOIN public.tracks b ON b.id = NEW.beat_track_id AND b.org_id = s.org_id
    WHERE s.id = NEW.song_track_id AND s.org_id IS NOT NULL
  ) THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tracks t WHERE t.id = NEW.song_track_id AND t.user_id = NEW.user_id AND t.org_id IS NULL) THEN
    RAISE EXCEPTION 'song_beats: song % is not owned by %', NEW.song_track_id, NEW.user_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tracks t WHERE t.id = NEW.beat_track_id AND t.user_id = NEW.user_id AND t.org_id IS NULL) THEN
    RAISE EXCEPTION 'song_beats: beat % is not owned by %', NEW.beat_track_id, NEW.user_id;
  END IF;
  RETURN NEW;
END $$;

NOTIFY pgrst, 'reload schema';
