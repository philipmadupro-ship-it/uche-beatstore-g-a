-- 043_projects_store_order.sql
-- Adds the `store_order` column on projects that migration 042 forgot.
-- The store editor PATCHes this column and /api/store/route.ts orders by it.

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS store_order integer;

CREATE INDEX IF NOT EXISTS idx_projects_user_store_featured_order
  ON public.projects (user_id, store_featured, store_order ASC NULLS LAST);

NOTIFY pgrst, 'reload schema';
