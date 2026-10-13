-- Rollback for 155_labelos_split_sheets.sql (LABEL-28).
--
-- Lives outside supabase/migrations/ on purpose: scripts/apply-migrations.sh
-- applies every *.sql in that folder. Run by hand only, after the rollbacks
-- of every later migration (LABEL-29 and LABEL-30 read split sheets).
--
-- Drops both tables (every split sheet and line, circulated ones included —
-- this is the legal record: export it first), their policies, triggers and
-- functions. Signed PDFs stay in `project_assets` (143); only the links go.
-- The `activity_events` rows stay: the log is append-only.

DROP FUNCTION IF EXISTS public.labelos_audit_split_sign(uuid, uuid, uuid, uuid, text, uuid, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.labelos_audit_split_circulate(uuid, uuid, uuid, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.labelos_split_save_draft(uuid, uuid, boolean, text, boolean, jsonb);
DROP FUNCTION IF EXISTS public.labelos_split_create_draft(uuid, uuid, uuid, text, text, jsonb, uuid);
DROP FUNCTION IF EXISTS public.labelos_split_check_payload(jsonb);

DROP POLICY IF EXISTS split_lines_member_read ON public.split_lines;
DROP POLICY IF EXISTS split_sheets_member_read ON public.split_sheets;

-- Sheets are dropped through their guard, which refuses to delete a circulated
-- one; the guard goes first.
DROP TRIGGER IF EXISTS split_lines_guard ON public.split_lines;
DROP TRIGGER IF EXISTS split_sheets_guard ON public.split_sheets;

DROP TABLE IF EXISTS public.split_lines;
DROP TABLE IF EXISTS public.split_sheets;

DROP FUNCTION IF EXISTS public.labelos_my_split_lines();
DROP FUNCTION IF EXISTS public.split_lines_guard();
DROP FUNCTION IF EXISTS public.split_sheets_guard();
DROP FUNCTION IF EXISTS public.labelos_split_role_ok(text, text);

NOTIFY pgrst, 'reload schema';
