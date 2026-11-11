-- Rollback for 200_labelos_party_email_resets_confirmation.sql (review G14).
--
-- Lives outside supabase/migrations/ on purpose. Run by hand only. Puts back 174's function word for word
-- (a changed e-mail no longer clears the confirmation in the database; the app's routes still do).

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
       OR NEW.user_id IS DISTINCT FROM OLD.user_id)
  THEN
    NEW.details_confirmed_at := NULL;
    NEW.details_confirmed_by := NULL;
  END IF;
  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
