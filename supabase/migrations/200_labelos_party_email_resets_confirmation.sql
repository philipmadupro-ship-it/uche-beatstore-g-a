-- 200_labelos_party_email_resets_confirmation.sql
-- Label OS (review G14, PR #193): a changed party e-mail clears the person's confirmation in the database too.
--
-- `clearsConfirmation` (src/lib/labelos/parties.ts) already lists `email`; 174's trigger function
-- `parties_confirmation_reset` did not, so only writes through the app's routes cleared `details_confirmed_by/_at`
-- for an e-mail change. This redefines the function from 174's text with ONE more field in the list (`email`), so SQL
-- and TS agree. The trigger itself (174) is unchanged. Idempotent.

CREATE OR REPLACE FUNCTION public.parties_confirmation_reset()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.details_confirmed_at IS NOT DISTINCT FROM OLD.details_confirmed_at
     AND NEW.details_confirmed_by IS NOT DISTINCT FROM OLD.details_confirmed_by
     AND (NEW.legal_name IS DISTINCT FROM OLD.legal_name
       OR NEW.ipi IS DISTINCT FROM OLD.ipi
       OR NEW.isni IS DISTINCT FROM OLD.isni
       OR NEW.pro IS DISTINCT FROM OLD.pro
       OR NEW.pro_affiliation IS DISTINCT FROM OLD.pro_affiliation
       OR NEW.publisher_name IS DISTINCT FROM OLD.publisher_name
       OR NEW.publisher_ipi IS DISTINCT FROM OLD.publisher_ipi
       OR NEW.address IS DISTINCT FROM OLD.address
       OR NEW.country IS DISTINCT FROM OLD.country
       OR NEW.email IS DISTINCT FROM OLD.email
       OR NEW.user_id IS DISTINCT FROM OLD.user_id)
  THEN
    NEW.details_confirmed_at := NULL;
    NEW.details_confirmed_by := NULL;
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.parties_confirmation_reset() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.parties_confirmation_reset() FROM PUBLIC;

NOTIFY pgrst, 'reload schema';
