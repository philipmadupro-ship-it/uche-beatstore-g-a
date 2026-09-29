-- 121: per-share playback length. Full track (default) or the 75 s preview.
--
-- Share pages streamed tracks.preview_url whenever one existed. PR #17 gave
-- every beat a 75 s clip for the storefront, so from then on every share
-- (rappers writing to a beat, friends, collaborators) stopped at 1:15. The
-- producer now chooses per share. TRUE = the whole track, which is the
-- default and what every existing share gets. See lib/share/playback.ts.
--
-- The code reads a missing column as TRUE, so this is safe to merge before
-- applying: until it is applied every share plays in full, and only the
-- "1:15 preview" choice cannot be saved. Idempotent.

ALTER TABLE public.share_links
  ADD COLUMN IF NOT EXISTS full_playback boolean NOT NULL DEFAULT true;

ALTER TABLE public.project_shares
  ADD COLUMN IF NOT EXISTS full_playback boolean NOT NULL DEFAULT true;

NOTIFY pgrst, 'reload schema';
