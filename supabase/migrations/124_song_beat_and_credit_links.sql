-- 124_song_beat_and_credit_links.sql
-- Artist Relationship Workspace, phase 1: the links that make
-- Artist → Song → Beat navigable.
--
-- tracks.beat_track_id — a song's MAIN beat. A song stays a track
--   (type = 'song'); it already has versions, stems, credits and the player,
--   so a separate Song entity would duplicate all of it. One pointer is enough
--   today; if a song ever needs several beats a join table can be added
--   without breaking this column. ON DELETE SET NULL: deleting a beat must not
--   delete the song built on it.
-- track_collaborators.contact_id — a credit that points at a CRM contact.
--   The typed `name` stays for credits that are not contacts.
-- contacts.avatar_url — the artist's picture in workspace mode.

ALTER TABLE public.tracks
  ADD COLUMN IF NOT EXISTS beat_track_id uuid REFERENCES public.tracks(id) ON DELETE SET NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tracks_beat_track_not_self') THEN
    ALTER TABLE public.tracks ADD CONSTRAINT tracks_beat_track_not_self
      CHECK (beat_track_id IS NULL OR beat_track_id <> id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tracks_beat_track ON public.tracks (beat_track_id) WHERE beat_track_id IS NOT NULL;

-- A song may only be built on a beat its owner owns.
CREATE OR REPLACE FUNCTION public.tracks_beat_same_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.beat_track_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.tracks b WHERE b.id = NEW.beat_track_id AND b.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'tracks.beat_track_id: beat % is not owned by the song''s owner', NEW.beat_track_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tracks_beat_same_owner ON public.tracks;
CREATE TRIGGER tracks_beat_same_owner
  BEFORE INSERT OR UPDATE OF beat_track_id, user_id ON public.tracks
  FOR EACH ROW EXECUTE FUNCTION public.tracks_beat_same_owner();

ALTER TABLE public.track_collaborators
  ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_track_collaborators_contact
  ON public.track_collaborators (contact_id) WHERE contact_id IS NOT NULL;

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS avatar_url text;

NOTIFY pgrst, 'reload schema';
