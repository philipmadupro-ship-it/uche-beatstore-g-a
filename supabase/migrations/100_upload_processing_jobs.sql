CREATE TABLE IF NOT EXISTS public.upload_processing_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  track_id uuid NOT NULL REFERENCES public.tracks(id) ON DELETE CASCADE,
  audio_url text NOT NULL,
  file_name text NOT NULL,
  client_analysis jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  error text,
  locked_at timestamptz,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS upload_processing_jobs_status_idx
  ON public.upload_processing_jobs (status, created_at)
  WHERE status IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS upload_processing_jobs_track_idx
  ON public.upload_processing_jobs (track_id);

ALTER TABLE public.upload_processing_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "upload_processing_jobs_owner_select" ON public.upload_processing_jobs;
CREATE POLICY "upload_processing_jobs_owner_select"
  ON public.upload_processing_jobs FOR SELECT
  USING (auth.uid() = user_id);

NOTIFY pgrst, 'reload schema';
