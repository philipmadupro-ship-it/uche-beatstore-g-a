-- 067_smart_playlists.sql
-- Smart playlists = saved, auto-updating filter views over the producer's
-- library. Unlike a regular playlist (manual playlist_tracks junction), a
-- smart playlist stores a filter spec and re-evaluates against the live
-- catalogue every time it's opened — "all Finished Drill ≥140 BPM" stays
-- current as new tracks land.
--
-- `filter` is the serialized LibraryFilters shape (genres, statuses,
-- bpmMin/Max, keys, scale, rating) plus optional type. Stored as jsonb so
-- the schema can evolve without a migration. Idempotent.

CREATE TABLE IF NOT EXISTS public.smart_playlists (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name       text        NOT NULL,
  filter     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_smart_playlists_user
  ON public.smart_playlists (user_id, created_at DESC);

ALTER TABLE public.smart_playlists ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner" ON public.smart_playlists;
CREATE POLICY "owner" ON public.smart_playlists
  FOR ALL USING (user_id = auth.uid());

NOTIFY pgrst, 'reload schema';
