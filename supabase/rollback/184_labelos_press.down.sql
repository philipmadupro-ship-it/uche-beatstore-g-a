-- Rollback for 184_labelos_press.sql (LABEL-66).
--
-- Lives outside supabase/migrations/ on purpose: scripts/apply-migrations.sh
-- applies every *.sql in that folder. Run by hand only.
--
-- Drops all press data: kits, links, photo references (the project files stay),
-- SHARE LINKS (every shared press page stops working) and the outreach tracker.
-- Export the org's data first (GET /api/org/<id>/export). The press_kit.* /
-- press_outreach.* events stay: the log is append-only.

DROP TABLE IF EXISTS public.press_outreach;
DROP TABLE IF EXISTS public.press_kit_shares;
DROP TABLE IF EXISTS public.press_kit_photos;
DROP TABLE IF EXISTS public.press_kit_links;
DROP TABLE IF EXISTS public.press_kits;

DROP FUNCTION IF EXISTS public.press_outreach_guard();
DROP FUNCTION IF EXISTS public.press_kit_shares_guard();
DROP FUNCTION IF EXISTS public.press_kit_photos_guard();
DROP FUNCTION IF EXISTS public.press_kits_guard();

NOTIFY pgrst, 'reload schema';
