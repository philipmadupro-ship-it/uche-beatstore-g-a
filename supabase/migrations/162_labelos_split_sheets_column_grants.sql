-- 162_labelos_split_sheets_column_grants.sql
-- Label OS (LABEL-43, review G6 F1 — the D2 breach): an own-line reader must
-- not read a split sheet's negotiation note with their own JWT.
--
-- LABEL OS — NOT APPLIED. Apply at the final merge of the Label OS branch
-- into main, after 155. Never part of supabase/apply/pending.sql.
--
-- 155's `split_sheets_member_read` lets a member whose ability is
-- `rights.read.own_line` (a producer / engineer function) read the SHEET row
-- of a circulated sheet they have a line on, so they can see its status. RLS
-- is per row, not per column, so that row came with every column: the
-- `note` (the negotiation note, D2 says they never read it), who created and
-- circulated it, and the signed document's asset id. The app never shows
-- them those (`sheetView` builds their view field by field), but PostgREST
-- answered `split_sheets?select=note` on their own JWT.
--
-- The fix is a column grant: the API roles lose the table-wide SELECT and
-- get back only the columns a status needs. Every server route reads
-- split_sheets with the service role (lib/labelos/splits-store.ts,
-- filters-store.ts, org-export.ts — none through a user client), so no route
-- changes; a whole-org rights reader loses nothing the app gives them.
--
-- Not readable by anon / authenticated after this, whatever the row rule
-- says: note, document_asset_id, created_by, circulated_by, superseded_by,
-- updated_at. Asking for one is `permission denied` (PostgREST 401/403), and
-- `select=*` is refused too — name the columns.
--
-- anon keeps the same column list so an anonymous read still answers an
-- empty list (RLS) rather than a permission error, exactly as before.
--
-- No policy changes. Writes are untouched (no write policy exists; 141's
-- service-only trigger and 155's guards still refuse them).
--
-- Idempotent: REVOKE on the table also revokes its column grants, so a
-- replay starts from nothing and grants the same list again.

REVOKE SELECT ON public.split_sheets FROM anon, authenticated;
GRANT SELECT (id, org_id, track_id, kind, version, status, circulated_at, signed_at, superseded_at, created_at)
  ON public.split_sheets TO authenticated;
GRANT SELECT (id, org_id, track_id, kind, version, status, circulated_at, signed_at, superseded_at, created_at)
  ON public.split_sheets TO anon;

NOTIFY pgrst, 'reload schema';
