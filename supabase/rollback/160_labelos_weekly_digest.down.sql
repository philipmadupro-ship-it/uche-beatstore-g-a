-- Rollback for 160_labelos_weekly_digest.sql (LABEL-38).
--
-- Lives outside supabase/migrations/ on purpose: scripts/apply-migrations.sh
-- applies every *.sql in that folder. Run by hand only.
--
-- Drops both tables: every member's digest preference and the stored (encrypted)
-- Slack webhook URL. Nothing else reads them; the weekly-digest cron then
-- skips quietly. Switching the cron off in vercel.json is the lighter rollback.

DROP TABLE IF EXISTS public.org_digest_channels;
DROP TABLE IF EXISTS public.org_digest_members;

NOTIFY pgrst, 'reload schema';
