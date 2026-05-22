-- 042_project_storefront.sql
-- Adds price_usd and description to projects for storefront sales.
-- Adds project_access_links table for post-purchase unique delivery links.

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS price_usd numeric(10,2),
  ADD COLUMN IF NOT EXISTS description text;

CREATE TABLE IF NOT EXISTS public.project_access_links (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  buyer_email   text NOT NULL,
  token         text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  stripe_session_id text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz
);

ALTER TABLE public.project_access_links ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'project_access_links'
      AND policyname = 'Owner reads project access links'
  ) THEN
    CREATE POLICY "Owner reads project access links"
      ON public.project_access_links FOR SELECT
      USING (
        project_id IN (
          SELECT id FROM public.projects WHERE user_id = auth.uid()
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_project_access_links_token
  ON public.project_access_links (token);

NOTIFY pgrst, 'reload schema';
