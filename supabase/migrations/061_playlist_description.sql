-- 061_playlist_description.sql
--
-- A description field on playlists. Until now the public playlist
-- page showed only the playlist name and the producer; producers
-- wanted a place to explain the curation choice ("Late-night
-- drives", "Sunday gospel chops", etc.).
--
-- Optional, plain text. Markdown rendering deferred — we already
-- whitespace-pre-line description on the project pages and it works.
--
-- Idempotent.

ALTER TABLE public.playlists
  ADD COLUMN IF NOT EXISTS description text;

NOTIFY pgrst, 'reload schema';
