-- Migration to allow unauthenticated access for demo/preview
ALTER TABLE public.tracks ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.playlists ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.calendar_events ALTER COLUMN user_id DROP NOT NULL;

-- Update RLS to allow public access if no user is present (for demo)
DROP POLICY IF EXISTS "team only" ON public.tracks;
DROP POLICY IF EXISTS "public and team access" ON public.tracks;
CREATE POLICY "public and team access" ON public.tracks FOR ALL USING (true);

DROP POLICY IF EXISTS "team only" ON public.playlists;
DROP POLICY IF EXISTS "public and team access" ON public.playlists;
CREATE POLICY "public and team access" ON public.playlists FOR ALL USING (true);

DROP POLICY IF EXISTS "team only" ON public.playlist_tracks;
DROP POLICY IF EXISTS "public and team access" ON public.playlist_tracks;
CREATE POLICY "public and team access" ON public.playlist_tracks FOR ALL USING (true);
