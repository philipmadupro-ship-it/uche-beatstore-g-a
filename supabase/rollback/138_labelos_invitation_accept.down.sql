-- Rollback for 138_labelos_invitation_accept.sql (LABEL-08).
--
-- Lives outside supabase/migrations/ on purpose: scripts/apply-migrations.sh
-- applies every *.sql in that folder. Run by hand only.
--
-- Drops the accept function. Memberships it wrote, invitations it marked
-- accepted and the member.joined audit events stay: they record people who
-- really joined, and audit rows are never deleted (06 §6). With the function
-- gone, POST /api/org/join answers 503 (interpretAcceptResult).

DROP FUNCTION IF EXISTS public.labelos_accept_invitation(text, uuid);

NOTIFY pgrst, 'reload schema';
