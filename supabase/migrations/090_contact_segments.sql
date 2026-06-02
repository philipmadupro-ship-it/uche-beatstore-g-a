-- 090_contact_segments.sql
-- Saved filter segments for the CRM. Lets the producer save a filter combo
-- (search + category + engagement status + sort) as a named, reusable chip —
-- e.g. "Active buyers", "Cold A&R", "Drill rappers".
--
-- filters jsonb shape: { search?: string, category?: string, status?: string, sort?: string }

CREATE TABLE IF NOT EXISTS public.contact_segments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name       text NOT NULL,
  filters    jsonb NOT NULL DEFAULT '{}'::jsonb,
  position   integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contact_segments_user ON public.contact_segments (user_id, position);

ALTER TABLE public.contact_segments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner" ON public.contact_segments;
CREATE POLICY "owner" ON public.contact_segments
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

NOTIFY pgrst, 'reload schema';
