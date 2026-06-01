-- 082_project_folders.sql
-- Folders for organizing projects (multi-membership collections). A project
-- can belong to many folders; folder chips on the /projects list filter the
-- grid (All / Unfiled / each folder). Owned table — one set of folders per
-- producer (mirrors smart_playlists, mig 067).

CREATE TABLE IF NOT EXISTS public.project_folders (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name       text NOT NULL,
  position   integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_folders_user ON public.project_folders (user_id, position);

ALTER TABLE public.project_folders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner" ON public.project_folders;
CREATE POLICY "owner" ON public.project_folders
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

NOTIFY pgrst, 'reload schema';
