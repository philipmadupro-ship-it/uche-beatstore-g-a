-- Rollback for 146_labelos_audit_rpc.sql (LABEL-19).
--
-- Lives outside supabase/migrations/ on purpose: scripts/apply-migrations.sh
-- applies every *.sql in that folder. Run by hand only.
--
-- Drops the six functions; the routes then fall back to recordEvent
-- (docs/bstudio-label-os/14-engineering-backlog.md, LABEL-19 Rollback).
-- Audit events they wrote stay: audit rows are never deleted (06 §6).
-- The org.created rows the backfill wrote are removed (they are marked
-- source = 'backfill', and only the backfill writes that marker).

DROP FUNCTION IF EXISTS public.labelos_audit_invitation_revoke(uuid, uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS public.labelos_audit_invitation_create(uuid, uuid, text, text, text[], uuid[], text, timestamptz, jsonb);
DROP FUNCTION IF EXISTS public.labelos_audit_member_artists_set(uuid, uuid, uuid, uuid[], jsonb);
DROP FUNCTION IF EXISTS public.labelos_audit_member_remove(uuid, uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS public.labelos_audit_member_update(uuid, uuid, uuid, jsonb, text, jsonb);
DROP FUNCTION IF EXISTS public.labelos_audit_insert(uuid, uuid, text, text, uuid, jsonb);

DELETE FROM public.activity_events WHERE verb = 'org.created' AND payload ->> 'source' = 'backfill';

NOTIFY pgrst, 'reload schema';
