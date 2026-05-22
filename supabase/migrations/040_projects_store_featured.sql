-- 040_projects_store_featured.sql
-- Adds store_featured column to projects so producers can expose entire
-- project track-lists in their public /store page.
--
-- is_public already exists on projects (added by share/collaboration migrations).
-- store_featured gates whether a public project appears in the store strip.

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS store_featured boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_projects_store_featured
  ON public.projects (user_id, store_featured)
  WHERE store_featured = true;

-- Also ensure is_public column exists (added by earlier project-share migration,
-- re-declared here as IF NOT EXISTS for safety in case of partial applies).
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false;

-- Backfill: any project already marked store_featured must also be public so
-- the store page can find it. The UI now auto-sets both flags simultaneously.
UPDATE public.projects
  SET is_public = true
  WHERE store_featured = true AND is_public = false;

NOTIFY pgrst, 'reload schema';
