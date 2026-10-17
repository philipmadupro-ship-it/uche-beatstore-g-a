-- Rollback for 162_labelos_split_sheets_column_grants.sql (LABEL-43).
--
-- Lives outside supabase/migrations/ on purpose: scripts/apply-migrations.sh
-- applies every *.sql in that folder. Run by hand only.
--
-- Gives the API roles back the table-wide SELECT on split_sheets (155's
-- state). Re-opens the D2 breach: an own-line reader reads the sheet's note
-- on their own JWT again. Routes are unaffected either way (service role).

REVOKE SELECT ON public.split_sheets FROM anon, authenticated;
GRANT SELECT ON public.split_sheets TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
