-- 074_rate_limits.sql
-- Durable, cross-instance rate limiting for public unauthenticated endpoints
-- (offers, follows, contact, free-download). The in-memory limiter only
-- throttles a single warm serverless instance; this RPC makes the limit hold
-- across instances/regions and cold starts.
--
-- rate_limit_hit() atomically increments the bucket and returns whether the
-- caller is still under the limit. Service-role only (no RLS policy) — it's
-- called from server routes via the service client.

CREATE TABLE IF NOT EXISTS public.rate_limits (
  bucket    text        PRIMARY KEY,
  count     integer     NOT NULL DEFAULT 0,
  reset_at  timestamptz NOT NULL
);

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
-- No policy: only the service-role client (which bypasses RLS) touches this.

CREATE OR REPLACE FUNCTION public.rate_limit_hit(
  p_bucket text,
  p_limit integer,
  p_window_seconds integer
) RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  v_now   timestamptz := now();
  v_count integer;
BEGIN
  INSERT INTO public.rate_limits (bucket, count, reset_at)
    VALUES (p_bucket, 1, v_now + make_interval(secs => p_window_seconds))
  ON CONFLICT (bucket) DO UPDATE
    SET count = CASE WHEN public.rate_limits.reset_at < v_now THEN 1
                     ELSE public.rate_limits.count + 1 END,
        reset_at = CASE WHEN public.rate_limits.reset_at < v_now
                        THEN v_now + make_interval(secs => p_window_seconds)
                        ELSE public.rate_limits.reset_at END
  RETURNING count INTO v_count;
  RETURN v_count <= p_limit;
END;
$$;

NOTIFY pgrst, 'reload schema';
