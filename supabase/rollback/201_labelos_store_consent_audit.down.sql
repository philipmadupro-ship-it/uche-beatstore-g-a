-- Rollback for 201_labelos_store_consent_audit.sql (review G17).
--
-- Lives outside supabase/migrations/ on purpose. Run by hand only. Drops the two audit functions; the consent and
-- veto routes then use their fallback (change, then event, put back on failure). Events already written stay.

DROP FUNCTION IF EXISTS public.labelos_audit_consent_decide(uuid, uuid, uuid, uuid, text, text, jsonb, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.labelos_audit_listing_veto(uuid, uuid, uuid, boolean, jsonb, jsonb, jsonb);

NOTIFY pgrst, 'reload schema';
