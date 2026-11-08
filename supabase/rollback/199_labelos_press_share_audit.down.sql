-- Rollback for 199_labelos_press_share_audit.sql (review G16).
--
-- Lives outside supabase/migrations/ on purpose. Run by hand only. Drops the two audit functions; the routes then
-- use their fallback (change, then event, undone if the event cannot be written). Events already written stay.

DROP FUNCTION IF EXISTS public.labelos_audit_press_share_create(uuid, uuid, uuid, text, text, timestamptz, int, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.labelos_audit_press_share_revoke(uuid, uuid, uuid, uuid, jsonb, jsonb);

NOTIFY pgrst, 'reload schema';
