-- Rollback for 183_labelos_marketing_plans.sql (LABEL-65).
--
-- Lives outside supabase/migrations/ on purpose: scripts/apply-migrations.sh
-- applies every *.sql in that folder. Run by hand only.
--
-- Drops all marketing plan data (timeline, platform steps, BUDGET LINES, asset
-- requests). Export the org's data first (GET /api/org/<id>/export). Tasks on a
-- release are LABEL-23's and stay. `marketing_plan_required` stays in
-- organizations.settings (readers ignore an unknown key). The
-- `marketing_plan.requirement_changed` events stay: the log is append-only.

DROP FUNCTION IF EXISTS public.labelos_audit_marketing_plan_required(uuid, uuid, boolean);

DROP TABLE IF EXISTS public.marketing_asset_requests;
DROP TABLE IF EXISTS public.marketing_budget_lines;
DROP TABLE IF EXISTS public.marketing_platform_steps;
DROP TABLE IF EXISTS public.marketing_plan_items;
DROP TABLE IF EXISTS public.marketing_plans;

DROP FUNCTION IF EXISTS public.marketing_plans_guard();

NOTIFY pgrst, 'reload schema';
