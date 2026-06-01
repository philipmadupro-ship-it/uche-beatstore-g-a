-- 085_project_pins_folder_color.sql
-- Pin/favorite flag on projects + color + cover on project folders.
--
-- projects.pinned (bool, default false): pinned projects float to the top
--   of the list (or a dedicated "Pinned" row on the homepage).
--
-- project_folders.color (text nullable): hex string for the folder chip
--   accent color, e.g. "#9d95e8". Defaults to the app accent when null.
--
-- project_folders.cover_url (text nullable): optional cover image for the
--   folder (shown in the chip or a future folder detail view).

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false;

ALTER TABLE public.project_folders
  ADD COLUMN IF NOT EXISTS color text,
  ADD COLUMN IF NOT EXISTS cover_url text;

NOTIFY pgrst, 'reload schema';
