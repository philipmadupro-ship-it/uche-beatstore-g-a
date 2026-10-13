-- Rollback for 154_labelos_artist_label_connection.sql (LABEL-41).
--
-- Lives outside supabase/migrations/ on purpose: scripts/apply-migrations.sh
-- applies every *.sql in that folder. Run by hand only.
--
-- Drops the connection tables (every connection, its shared-project list and
-- its history go with them), the helper / audit / integrity functions, and the
-- two additions on existing tables: contacts.artist_org_id and
-- tracks.provenance. A recording a label COPIED stays in the label org as an
-- ordinary track; only its provenance note is lost. Nothing else depends on
-- any of it. The activity_events rows (connection.*, share.* via a connection)
-- stay: the log is append-only.

DROP FUNCTION IF EXISTS public.labelos_audit_connection_request(uuid, uuid, text, text, text, uuid, jsonb);
DROP FUNCTION IF EXISTS public.labelos_audit_connection_accept(uuid, uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS public.labelos_audit_connection_end(uuid, uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS public.labelos_audit_connection_share(uuid, uuid, uuid, jsonb, uuid[], jsonb);
DROP FUNCTION IF EXISTS public.labelos_connection_payload(uuid, jsonb);
DROP FUNCTION IF EXISTS public.labelos_connection_json(uuid);
DROP FUNCTION IF EXISTS public.can_see_via_connection(uuid);

DROP TRIGGER IF EXISTS contacts_artist_org_connected ON public.contacts;
DROP FUNCTION IF EXISTS public.contacts_artist_org_connected();
DROP INDEX IF EXISTS public.contacts_org_artist_org_uniq;
ALTER TABLE public.contacts DROP CONSTRAINT IF EXISTS contacts_artist_org_is_org_contact;
ALTER TABLE public.contacts DROP COLUMN IF EXISTS artist_org_id;

DROP TRIGGER IF EXISTS tracks_provenance_fixed ON public.tracks;
DROP FUNCTION IF EXISTS public.tracks_provenance_fixed();
ALTER TABLE public.tracks DROP CONSTRAINT IF EXISTS tracks_provenance_shape;
ALTER TABLE public.tracks DROP COLUMN IF EXISTS provenance;

DROP TABLE IF EXISTS public.connection_projects;
DROP TABLE IF EXISTS public.org_connections;
DROP FUNCTION IF EXISTS public.connection_projects_integrity();
DROP FUNCTION IF EXISTS public.org_connections_integrity();

NOTIFY pgrst, 'reload schema';
