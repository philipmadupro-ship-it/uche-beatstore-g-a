-- 083_project_folder_items.sql
-- Many-to-many membership between projects and project_folders. Composite PK
-- prevents duplicate membership. Parent-RLS via the project (same shape as
-- project_tags); the membership API additionally verifies the folder is owned
-- by the caller server-side, since this policy only checks the project parent.

CREATE TABLE IF NOT EXISTS public.project_folder_items (
  folder_id  uuid NOT NULL REFERENCES public.project_folders(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (folder_id, project_id)
);

CREATE INDEX IF NOT EXISTS idx_pfi_project ON public.project_folder_items (project_id);
CREATE INDEX IF NOT EXISTS idx_pfi_folder ON public.project_folder_items (folder_id);

ALTER TABLE public.project_folder_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_folder_items_via_parent ON public.project_folder_items;
CREATE POLICY project_folder_items_via_parent ON public.project_folder_items
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = project_folder_items.project_id
      AND (p.user_id IS NULL OR p.user_id = auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = project_folder_items.project_id
      AND (p.user_id IS NULL OR p.user_id = auth.uid())
  ));

NOTIFY pgrst, 'reload schema';
