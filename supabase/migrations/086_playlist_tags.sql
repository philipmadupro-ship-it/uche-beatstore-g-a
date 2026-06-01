-- 086_playlist_tags.sql
-- Tags for playlists. Mirrors project_tags (mig 081) exactly.
-- Lets producers tag playlists by genre/mood for filtering on the list page.

CREATE TABLE IF NOT EXISTS public.playlist_tags (
  playlist_id uuid NOT NULL REFERENCES public.playlists(id) ON DELETE CASCADE,
  tag        text NOT NULL,
  category   text,
  PRIMARY KEY (playlist_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_playlist_tags_playlist ON public.playlist_tags (playlist_id);
CREATE INDEX IF NOT EXISTS idx_playlist_tags_tag ON public.playlist_tags (tag);

ALTER TABLE public.playlist_tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS playlist_tags_via_parent ON public.playlist_tags;
CREATE POLICY playlist_tags_via_parent ON public.playlist_tags
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.playlists p
    WHERE p.id = playlist_tags.playlist_id
      AND (p.user_id IS NULL OR p.user_id = auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.playlists p
    WHERE p.id = playlist_tags.playlist_id
      AND (p.user_id IS NULL OR p.user_id = auth.uid())
  ));

NOTIFY pgrst, 'reload schema';
