-- Rollback for 186_labelos_listing_consent.sql (LABEL-71).
--
-- Lives outside supabase/migrations/ on purpose: scripts/apply-migrations.sh
-- applies every *.sql in that folder. Run by hand only.
--
-- Drops both tables: every artist's answer and every store-owner veto goes
-- with them, so a release an artist had said NO to would serve again the
-- moment it is still listed. Take such releases off the store first (the
-- public routes degrade to "no consent rows" without the tables, i.e. as
-- they behaved before LABEL-71). The `activity_events` rows
-- (listing.consent_*, listing.veto_*) stay: the log is append-only.

DROP POLICY IF EXISTS store_listing_vetoes_no_direct_access ON public.store_listing_vetoes;
DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.store_listing_vetoes;
DROP TRIGGER IF EXISTS store_listing_vetoes_guard ON public.store_listing_vetoes;
DROP TABLE IF EXISTS public.store_listing_vetoes;
DROP FUNCTION IF EXISTS public.labelos_store_listing_vetoes_guard();

DROP POLICY IF EXISTS listing_consents_no_direct_access ON public.listing_consents;
DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.listing_consents;
DROP TRIGGER IF EXISTS listing_consents_guard ON public.listing_consents;
DROP TABLE IF EXISTS public.listing_consents;
DROP FUNCTION IF EXISTS public.labelos_listing_consents_guard();

NOTIFY pgrst, 'reload schema';
