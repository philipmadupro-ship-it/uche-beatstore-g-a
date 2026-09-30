-- 133_track_links.sql
-- Linked material: a label-style link between tracks, and two new track types.
--
-- A record is several files that belong together: a song, the beat it is on,
-- its instrumental, the loops the beat uses, a topline written on it, an alt
-- version. Each link is one row here, read as
--     from_track --relation--> to_track   ("to_track is from_track's <relation>")
--   instrumental  song  → its instrumental
--   loop          beat (or song) → a loop it uses
--   topline       beat  → a topline written on it
--   version       track → an alternate version of it
-- "A song built on a beat" stays in song_beats (mig 132); the app reads both
-- as one set of links (lib/tracks/links.ts).
--
-- tracks.type gains 'loop' and 'topline', so those can be uploaded and
-- searched as what they are. Existing rows all satisfy the wider check.
--
-- Written without DO blocks so it pastes safely into the Supabase SQL editor:
-- constraints live in CREATE TABLE IF NOT EXISTS, and the type check is
-- dropped-if-present and re-added.

ALTER TABLE public.tracks DROP CONSTRAINT IF EXISTS tracks_type_check;
ALTER TABLE public.tracks ADD CONSTRAINT tracks_type_check
  CHECK (type IN ('beat', 'instrumental', 'song', 'remix', 'loop', 'topline'));

CREATE TABLE IF NOT EXISTS public.track_links (
  from_track_id uuid NOT NULL REFERENCES public.tracks(id) ON DELETE CASCADE,
  to_track_id   uuid NOT NULL REFERENCES public.tracks(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  relation      text NOT NULL CONSTRAINT track_links_relation_check
                  CHECK (relation IN ('instrumental', 'loop', 'topline', 'version')),
  position      integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (from_track_id, to_track_id),
  CONSTRAINT track_links_not_self CHECK (from_track_id <> to_track_id)
);

CREATE INDEX IF NOT EXISTS idx_track_links_to ON public.track_links (to_track_id);
CREATE INDEX IF NOT EXISTS idx_track_links_user ON public.track_links (user_id);

-- Both tracks must belong to the row's owner.
CREATE OR REPLACE FUNCTION public.track_links_same_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.tracks t WHERE t.id = NEW.from_track_id AND t.user_id = NEW.user_id)
     OR NOT EXISTS (SELECT 1 FROM public.tracks t WHERE t.id = NEW.to_track_id AND t.user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'track_links: both tracks must be owned by %', NEW.user_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS track_links_same_owner ON public.track_links;
CREATE TRIGGER track_links_same_owner
  BEFORE INSERT OR UPDATE ON public.track_links
  FOR EACH ROW EXECUTE FUNCTION public.track_links_same_owner();

ALTER TABLE public.track_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS track_links_owner_select ON public.track_links;
CREATE POLICY track_links_owner_select ON public.track_links
  FOR SELECT USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS track_links_owner_write ON public.track_links;
CREATE POLICY track_links_owner_write ON public.track_links
  FOR ALL USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id AND (SELECT public.is_producer()));

NOTIFY pgrst, 'reload schema';
