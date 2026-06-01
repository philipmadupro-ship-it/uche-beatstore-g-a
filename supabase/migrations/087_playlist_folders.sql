-- 087_playlist_folders.sql
-- Folders for playlists + pinned flag. Mirrors project_folders (mig 082)
-- and project pins/folder-color (mig 085) in a single migration.

CREATE TABLE IF NOT EXISTS public.playlist_folders (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name       text NOT NULL,
  position   integer NOT NULL DEFAULT 0,
  color      text,
  cover_url  text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_playlist_folders_user ON public.playlist_folders (user_id, position);

ALTER TABLE public.playlist_folders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner" ON public.playlist_folders;
CREATE POLICY "owner" ON public.playlist_folders
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Pin/favorite flag on playlists (float to top of list).
ALTER TABLE public.playlists
  ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
