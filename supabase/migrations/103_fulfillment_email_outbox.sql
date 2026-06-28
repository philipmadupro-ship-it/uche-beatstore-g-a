-- Durable delivery-email queue for paid track licenses and project bundles.
-- The Stripe webhook inserts before sending; the cron worker retries failures.

CREATE TABLE IF NOT EXISTS public.fulfillment_email_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('track', 'project')),
  reference_id uuid NOT NULL,
  seller_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  stripe_session_id text NOT NULL,
  buyer_email text NOT NULL,
  subject text NOT NULL,
  html text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'dead')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, reference_id)
);

CREATE INDEX IF NOT EXISTS idx_fulfillment_email_jobs_ready
  ON public.fulfillment_email_jobs (next_attempt_at, created_at)
  WHERE status IN ('pending', 'failed');

ALTER TABLE public.fulfillment_email_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fulfillment_email_jobs FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.claim_fulfillment_email_jobs(p_limit integer DEFAULT 10)
RETURNS SETOF public.fulfillment_email_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT id
    FROM public.fulfillment_email_jobs
    WHERE (
      status IN ('pending', 'failed') AND next_attempt_at <= now()
    ) OR (
      status = 'processing' AND locked_at < now() - interval '10 minutes'
    )
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(p_limit, 1), 50)
  )
  UPDATE public.fulfillment_email_jobs jobs
  SET status = 'processing',
      locked_at = now(),
      attempts = jobs.attempts + 1,
      updated_at = now()
  FROM candidates
  WHERE jobs.id = candidates.id
  RETURNING jobs.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_fulfillment_email_jobs(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_fulfillment_email_jobs(integer) TO service_role;

