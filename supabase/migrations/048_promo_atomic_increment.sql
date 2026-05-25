-- 048_promo_atomic_increment.sql
-- Atomic increment for promo_codes.uses_count.
--
-- The previous flow read uses_count at session-create time and trusted
-- that value at session-completed time — meaning two buyers could both
-- see uses_count < max_uses, both check out, and both get the discount
-- even when max_uses = 1. This RPC closes that window by combining the
-- usage-cap check with the increment into a single statement.
--
-- Returns the row AFTER the increment when successful, or NULL when
-- the cap was reached (the caller still honours the already-paid
-- session, but knows to log a "promo exhausted between create and
-- complete" warning).

CREATE OR REPLACE FUNCTION public.increment_promo_use(p_code text)
RETURNS public.promo_codes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result public.promo_codes;
BEGIN
  UPDATE public.promo_codes
     SET uses_count = COALESCE(uses_count, 0) + 1
   WHERE upper(code) = upper(p_code)
     AND active = true
     AND (expires_at IS NULL OR expires_at > now())
     AND (max_uses IS NULL OR COALESCE(uses_count, 0) < max_uses)
   RETURNING * INTO result;

  RETURN result;
END;
$$;

-- Allow the service role (used by the Stripe webhook) to invoke it.
GRANT EXECUTE ON FUNCTION public.increment_promo_use(text) TO service_role;

NOTIFY pgrst, 'reload schema';
