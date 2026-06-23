-- 096_lock_down_share_rls.sql
-- Reduce public RLS exposure for token-addressed share tables.
--
-- Public share pages must resolve tokens through service-role API routes
-- that can enforce token equality, expiry/revocation/password checks, and
-- response redaction. The anon role must not be able to enumerate share
-- rows directly through PostgREST table access.

-- Known unsafe public read policies.
DROP POLICY IF EXISTS "public read session" ON public.share_links;
DROP POLICY IF EXISTS "public_token_lookup" ON public.project_shares;
DROP POLICY IF EXISTS "public_read" ON public.project_comments;

-- share_links previously allowed FOR ALL when user_id IS NULL. That made
-- legacy null-owner rows broadly selectable and mutable through RLS. Keep
-- producer access owner-scoped and let service routes handle token reads.
DROP POLICY IF EXISTS "team only" ON public.share_links;
DROP POLICY IF EXISTS "owner_or_legacy_null" ON public.share_links;
DROP POLICY IF EXISTS share_links_owner_select ON public.share_links;
DROP POLICY IF EXISTS share_links_owner_insert ON public.share_links;
DROP POLICY IF EXISTS share_links_owner_update ON public.share_links;
DROP POLICY IF EXISTS share_links_owner_delete ON public.share_links;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'share_links'
      AND policyname = 'share_links_owner_select'
  ) THEN
    CREATE POLICY share_links_owner_select ON public.share_links
      FOR SELECT
      USING ((SELECT auth.uid()) = user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'share_links'
      AND policyname = 'share_links_owner_insert'
  ) THEN
    CREATE POLICY share_links_owner_insert ON public.share_links
      FOR INSERT
      WITH CHECK ((SELECT auth.uid()) = user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'share_links'
      AND policyname = 'share_links_owner_update'
  ) THEN
    CREATE POLICY share_links_owner_update ON public.share_links
      FOR UPDATE
      USING ((SELECT auth.uid()) = user_id)
      WITH CHECK ((SELECT auth.uid()) = user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'share_links'
      AND policyname = 'share_links_owner_delete'
  ) THEN
    CREATE POLICY share_links_owner_delete ON public.share_links
      FOR DELETE
      USING ((SELECT auth.uid()) = user_id);
  END IF;
END $$;

COMMENT ON TABLE public.share_links IS
  'Token-addressed track share grants. Public token lookup must go through service-role API routes; anon table enumeration is intentionally denied by RLS.';

COMMENT ON TABLE public.project_shares IS
  'Token-addressed project/playlist/track share grants. Public token lookup must go through service-role API routes; anon table enumeration is intentionally denied by RLS.';

COMMENT ON TABLE public.project_comments IS
  'Project feedback rows. Public share comment reads/writes must be mediated by service-role API routes that validate the share token and role; anon table enumeration is intentionally denied by RLS.';

COMMENT ON POLICY share_links_owner_select ON public.share_links IS
  'Producer-owned reads only. Public recipients resolve tokens through service-role API routes.';

COMMENT ON POLICY share_links_owner_insert ON public.share_links IS
  'Producer-owned inserts only. Public recipients never insert share rows directly.';

COMMENT ON POLICY share_links_owner_update ON public.share_links IS
  'Producer-owned updates only. Service routes handle token play counts and delivery checks.';

COMMENT ON POLICY share_links_owner_delete ON public.share_links IS
  'Producer-owned deletes only. Service routes may perform administrative token operations after ownership checks.';

NOTIFY pgrst, 'reload schema';
