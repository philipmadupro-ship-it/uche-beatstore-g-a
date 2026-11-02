-- 183_labelos_marketing_plans.sql
-- Label OS (LABEL-65): per-release marketing plans.
--
-- LABEL OS — NOT APPLIED. Apply at the final merge of the Label OS branch
-- into main, after 144 (releases), 151 (tasks) and 146 (labelos_audit_insert).
-- Never part of supabase/apply/pending.sql.
--
-- A plan hangs on ONE release (unique). Tasks are LABEL-23's `tasks` rows with
-- `release_id` set — no task table here. Everything below is org-only (no
-- user_id, ON DELETE CASCADE from organizations so the org's hard delete leaves
-- nothing), written by the service role only (141's trigger) and read through
-- the routes only: each table has a deny-all policy and no API-role privilege,
-- exactly like 161's org_saved_views. What a caller may read is decided in the
-- route (catalog.read + the release's artist scope; budget lines also need
-- business.read.internal) — a budget is business data and never leaves the
-- route for a role without it.
--
--   marketing_plans            one per release.
--   marketing_plan_items       timeline milestones: phase pre_save | teaser | release | post,
--                              a title (free text, 1–120), a due day, done_at.
--   marketing_platform_steps   the platform checklist: a FIXED vocabulary
--                              (platform × step), one row per ticked step. No free text.
--   marketing_budget_lines     label, amount as bigint MINOR UNITS + char(3) currency
--                              (lib/labelos/finance/money.ts — never numeric/float),
--                              status planned | committed | spent, a short note (free text,
--                              excluded from the org export like 179's free text).
--   marketing_asset_requests   what the label asks the artist for (artwork, photos, bio,
--                              video, other). `recipient_id` is the one account that was
--                              notified, or NULL when no reachable account exists.
--
-- The release readiness `marketing` gate may require a plan: the org setting
-- `marketing_plan_required` (default off, only the exact JSON `true` turns it
-- on) lives in organizations.settings and is changed ONLY by
-- labelos_audit_marketing_plan_required below — owner-only, merged under the row
-- lock, with its audit event in the same transaction. It is not part of 172's
-- validator on purpose: that function is the owner settings screen's and is being
-- reworked by LABEL-73.
--
-- Idempotent: IF NOT EXISTS, CREATE OR REPLACE, DROP … IF EXISTS first.
-- Rollback: supabase/rollback/183_labelos_marketing_plans.down.sql.

-- ── marketing_plans ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.marketing_plans (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  release_id  uuid NOT NULL REFERENCES public.releases(id) ON DELETE CASCADE,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_plans_one_per_release UNIQUE (release_id),
  CONSTRAINT marketing_plans_id_org UNIQUE (id, org_id)
);
CREATE INDEX IF NOT EXISTS idx_marketing_plans_org ON public.marketing_plans (org_id);

-- The release is of the plan's own org, and a plan never moves.
CREATE OR REPLACE FUNCTION public.marketing_plans_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.org_id <> OLD.org_id OR NEW.release_id <> OLD.release_id) THEN
    RAISE EXCEPTION 'marketing_plans: a plan keeps its organization and its release' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' AND NOT EXISTS (
    SELECT 1 FROM public.releases r WHERE r.id = NEW.release_id AND r.org_id = NEW.org_id
  ) THEN
    RAISE EXCEPTION 'marketing_plans: the release must belong to the same organization' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.marketing_plans_guard() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.marketing_plans_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS marketing_plans_guard ON public.marketing_plans;
CREATE TRIGGER marketing_plans_guard BEFORE INSERT OR UPDATE ON public.marketing_plans
  FOR EACH ROW EXECUTE FUNCTION public.marketing_plans_guard();

-- ── marketing_plan_items (the timeline) ──────────────────────────────────

CREATE TABLE IF NOT EXISTS public.marketing_plan_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  plan_id     uuid NOT NULL,
  phase       text NOT NULL CHECK (phase IN ('pre_save', 'teaser', 'release', 'post')),
  title       text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
  due_on      date NOT NULL,
  done_at     timestamptz,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_plan_items_plan FOREIGN KEY (plan_id, org_id)
    REFERENCES public.marketing_plans (id, org_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_marketing_plan_items_plan ON public.marketing_plan_items (plan_id, due_on);

-- ── marketing_platform_steps (the checklist) ─────────────────────────────

CREATE TABLE IF NOT EXISTS public.marketing_platform_steps (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id    uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  plan_id   uuid NOT NULL,
  platform  text NOT NULL CHECK (platform IN ('spotify', 'apple_music', 'youtube', 'tiktok', 'instagram')),
  step      text NOT NULL CHECK (step IN ('pitch', 'profile', 'pre_save', 'assets')),
  done_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  done_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_platform_steps_plan FOREIGN KEY (plan_id, org_id)
    REFERENCES public.marketing_plans (id, org_id) ON DELETE CASCADE,
  CONSTRAINT marketing_platform_steps_once UNIQUE (plan_id, platform, step)
);

-- ── marketing_budget_lines ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.marketing_budget_lines (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  plan_id       uuid NOT NULL,
  label         text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 120),
  amount_minor  bigint NOT NULL CHECK (amount_minor >= 0),
  currency      char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  status        text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'committed', 'spent')),
  note          text CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 500),
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_budget_lines_plan FOREIGN KEY (plan_id, org_id)
    REFERENCES public.marketing_plans (id, org_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_marketing_budget_lines_plan ON public.marketing_budget_lines (plan_id, created_at);

-- ── marketing_asset_requests ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.marketing_asset_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  plan_id       uuid NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('artwork', 'photos', 'bio', 'video', 'other')),
  note          text CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 300),
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'fulfilled', 'cancelled')),
  requested_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  recipient_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz,
  CONSTRAINT marketing_asset_requests_plan FOREIGN KEY (plan_id, org_id)
    REFERENCES public.marketing_plans (id, org_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_marketing_asset_requests_plan ON public.marketing_asset_requests (plan_id, created_at);

-- ── Access: service role only, deny-all for the API roles ────────────────

DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['marketing_plans', 'marketing_plan_items', 'marketing_platform_steps', 'marketing_budget_lines', 'marketing_asset_requests'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.%I', t);
    EXECUTE format('CREATE TRIGGER labelos_org_rows_service_only BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.labelos_org_rows_service_only(%L, %L)', t, 'self', 'org_id');
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_no_direct_access', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)', t || '_no_direct_access', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
  END LOOP;
END
$do$;

-- ── The plan requirement: setting + audit event, one transaction ─────────
-- Owner only (a role, not a capability). Merges the one key under the row
-- lock so a concurrent owner save of another setting cannot lose it, and
-- derives `from` itself so the event never logs a stale value.
-- Answers {"required": bool, "changed": bool} or {"error": "not_found" | "not_owner"}.

CREATE OR REPLACE FUNCTION public.labelos_audit_marketing_plan_required(
  p_org uuid,
  p_actor uuid,
  p_required boolean
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_settings jsonb;
  v_before boolean;
BEGIN
  IF p_required IS NULL THEN
    RAISE EXCEPTION 'marketing_plan_required must be true or false' USING ERRCODE = '22023';
  END IF;
  SELECT o.settings INTO v_settings
  FROM public.organizations o
  WHERE o.id = p_org AND o.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF p_actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.org_members m WHERE m.org_id = p_org AND m.user_id = p_actor AND m.role = 'owner'
  ) THEN
    RETURN jsonb_build_object('error', 'not_owner');
  END IF;

  v_settings := coalesce(v_settings, '{}'::jsonb);
  v_before := (v_settings -> 'marketing_plan_required') = 'true'::jsonb;
  IF v_before = p_required THEN
    RETURN jsonb_build_object('required', p_required, 'changed', false);
  END IF;

  UPDATE public.organizations
     SET settings = v_settings || jsonb_build_object('marketing_plan_required', p_required)
   WHERE id = p_org;
  PERFORM public.labelos_audit_insert(
    p_org, p_actor, 'marketing_plan.requirement_changed', 'org', p_org,
    jsonb_build_object('from', v_before, 'to', p_required)
  );
  RETURN jsonb_build_object('required', p_required, 'changed', true);
END;
$fn$;

ALTER FUNCTION public.labelos_audit_marketing_plan_required(uuid, uuid, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_audit_marketing_plan_required(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_audit_marketing_plan_required(uuid, uuid, boolean) TO service_role;

NOTIFY pgrst, 'reload schema';
