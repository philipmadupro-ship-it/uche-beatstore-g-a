-- 205_stem_pipeline.sql (AUDIO-05)
-- Job-lifecycle columns for the asynchronous stem pipeline. The stems row is
-- the job: status pending (queued, or submitted and awaiting a poll) ->
-- processing (claimed by a driver) -> done | failed. Statuses stay as 001
-- defined them; no CHECK changes.
--   attempts    how many times a driver gave up on or lost this job
--   last_error  why the last attempt failed (shown to the producer)
--   locked_at   when a driver claimed it; a processing row whose lock is
--               older than the stale window is reclaimed
--   updated_at  last transition
-- Before this runs the code works in a reduced mode (status-only claim,
-- created_at as the lock age, no stored error): see lib/stems/lifecycle.ts.

ALTER TABLE public.stems ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
ALTER TABLE public.stems ADD COLUMN IF NOT EXISTS last_error text;
ALTER TABLE public.stems ADD COLUMN IF NOT EXISTS locked_at timestamptz;
ALTER TABLE public.stems ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_stems_work
  ON public.stems (status, locked_at)
  WHERE status IN ('pending', 'processing');

NOTIFY pgrst, 'reload schema';
