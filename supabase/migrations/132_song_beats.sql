-- 132_song_beats.sql
-- Artist Relationship Workspace, phase 3: a song built on several beats.
--
-- Mig 124 gave a song one pointer, tracks.beat_track_id (its MAIN beat), and
-- said a join table could come later without breaking it. This is that table.
-- tracks.beat_track_id stays and stays the main beat — the app keeps it equal
-- to position 0 here — so everything that reads it keeps working.
--
-- Backfilled from beat_track_id, idempotently.

CREATE TABLE IF NOT EXISTS public.song_beats (
  song_track_id uuid NOT NULL REFERENCES public.tracks(id) ON DELETE CASCADE,
  beat_track_id uuid NOT NULL REFERENCES public.tracks(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  position      integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (song_track_id, beat_track_id)
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'song_beats_not_self') THEN
    ALTER TABLE public.song_beats ADD CONSTRAINT song_beats_not_self
      CHECK (song_track_id <> beat_track_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_song_beats_beat ON public.song_beats (beat_track_id);
CREATE INDEX IF NOT EXISTS idx_song_beats_user ON public.song_beats (user_id);

-- Song and beat must both belong to the row's owner.
CREATE OR REPLACE FUNCTION public.song_beats_same_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.tracks t WHERE t.id = NEW.song_track_id AND t.user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'song_beats: song % is not owned by %', NEW.song_track_id, NEW.user_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tracks t WHERE t.id = NEW.beat_track_id AND t.user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'song_beats: beat % is not owned by %', NEW.beat_track_id, NEW.user_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS song_beats_same_owner ON public.song_beats;
CREATE TRIGGER song_beats_same_owner
  BEFORE INSERT OR UPDATE ON public.song_beats
  FOR EACH ROW EXECUTE FUNCTION public.song_beats_same_owner();

ALTER TABLE public.song_beats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS song_beats_owner_select ON public.song_beats;
CREATE POLICY song_beats_owner_select ON public.song_beats
  FOR SELECT USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS song_beats_owner_write ON public.song_beats;
CREATE POLICY song_beats_owner_write ON public.song_beats
  FOR ALL USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id AND (SELECT public.is_producer()));

-- Backfill: every existing main beat becomes position 0.
INSERT INTO public.song_beats (song_track_id, beat_track_id, user_id, position)
SELECT s.id, s.beat_track_id, s.user_id, 0
FROM public.tracks s
JOIN public.tracks b ON b.id = s.beat_track_id AND b.user_id = s.user_id
WHERE s.beat_track_id IS NOT NULL AND s.user_id IS NOT NULL
ON CONFLICT (song_track_id, beat_track_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
