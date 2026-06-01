-- 088_playlist_folder_items.sql
-- Many-to-many playlist↔folder membership. Mirrors project_folder_items (mig 083).

CREATE TABLE IF NOT EXISTS public.playlist_folder_items (
  folder_id   uuid NOT NULL REFERENCES public.playlist_folders(id) ON DELETE CASCADE,
  playlist_id uuid NOT NULL REFERENCES public.playlists(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (folder_id, playlist_id)
);

CREATE INDEX IF NOT EXISTS idx_plfi_playlist ON public.playlist_folder_items (playlist_id);
CREATE INDEX IF NOT EXISTS idx_plfi_folder ON public.playlist_folder_items (folder_id);

ALTER TABLE public.playlist_folder_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS playlist_folder_items_via_parent ON public.playlist_folder_items;
CREATE POLICY playlist_folder_items_via_parent ON public.playlist_folder_items
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.playlists p
    WHERE p.id = playlist_folder_items.playlist_id
      AND (p.user_id IS NULL OR p.user_id = auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.playlists p
    WHERE p.id = playlist_folder_items.playlist_id
      AND (p.user_id IS NULL OR p.user_id = auth.uid())
  ));

NOTIFY pgrst, 'reload schema';
