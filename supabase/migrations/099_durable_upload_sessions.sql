-- Multipart upload state must survive serverless invocations and deploys.
CREATE TABLE IF NOT EXISTS public.upload_sessions (
  session_id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  upload_id text NOT NULL,
  object_key text NOT NULL,
  file_name text NOT NULL,
  file_size bigint NOT NULL CHECK (file_size > 0),
  content_type text NOT NULL,
  part_size integer NOT NULL CHECK (part_size > 0),
  total_parts integer NOT NULL CHECK (total_parts > 0),
  parts jsonb NOT NULL DEFAULT '[]'::jsonb,
  track_type text NOT NULL,
  project_id uuid,
  replace_track_id uuid,
  status text NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'completed', 'aborted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS upload_sessions_user_status_idx
  ON public.upload_sessions (user_id, status, updated_at DESC);

ALTER TABLE public.upload_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "upload_sessions_owner_select" ON public.upload_sessions;
CREATE POLICY "upload_sessions_owner_select"
  ON public.upload_sessions FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "upload_sessions_owner_insert" ON public.upload_sessions;
CREATE POLICY "upload_sessions_owner_insert"
  ON public.upload_sessions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "upload_sessions_owner_update" ON public.upload_sessions;
CREATE POLICY "upload_sessions_owner_update"
  ON public.upload_sessions FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "upload_sessions_owner_delete" ON public.upload_sessions;
CREATE POLICY "upload_sessions_owner_delete"
  ON public.upload_sessions FOR DELETE
  USING (auth.uid() = user_id);

NOTIFY pgrst, 'reload schema';
