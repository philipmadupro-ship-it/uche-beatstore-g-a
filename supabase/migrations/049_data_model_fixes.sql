-- 049_data_model_fixes.sql
-- Three data-model fixes that came out of the post-storefront audit:
--
--  1. projects.user_id must be NOT NULL. Verification turned up
--     legacy rows ("Project 01") with NULL user_id. The store route
--     guards against it but it's a data-integrity smell and breaks
--     the assumption every other producer-side query makes.
--     Backfills any nulls to the single creator_profiles row first
--     (single-producer assumption), then sets NOT NULL.
--
--  2. project_access_links gets a denormalised seller_user_id
--     column. Before this change /api/sales had to JOIN through
--     projects.user_id to scope by owner, and the row would orphan
--     if the project was ever deleted. seller_user_id is written
--     by the Stripe webhook at insert time (same value as the
--     project's user_id at time of purchase). Backfills existing
--     rows from projects.user_id.
--
--  3. store_plays table. share_plays is scoped to DM'd share-link
--     tokens only; public storefront previews/plays didn't count
--     anywhere. /analytics undercounted plays. New table mirrors
--     share_plays shape but is scoped per-track per-seller with
--     no link_token requirement. Inserted via a public
--     /api/store/play endpoint (rate-limited by IP hash).
--
-- Idempotent (IF NOT EXISTS) on all DDL. Safe to re-run.

-- ── 1. projects.user_id NOT NULL ────────────────────────────────
--
-- Label OS (142) amendment: an org project has user_id NULL on purpose
-- (projects_org_or_owner) and is NOT an orphan. scripts/apply-migrations.sh replays every
-- file, so the backfill below skips rows with an org_id. `to_jsonb(row) ->>
-- 'org_id'` is used instead of the column because on a fresh database this
-- file runs before 141 adds it (a missing key reads as NULL). On a database
-- without org rows — production when this was written — the effect is
-- unchanged. Same pattern as LABEL-10's amendment of 111.
DO $$
DECLARE
  lone_owner uuid;
BEGIN
  SELECT user_id INTO lone_owner FROM public.creator_profiles LIMIT 1;
  IF lone_owner IS NOT NULL THEN
    UPDATE public.projects p SET user_id = lone_owner WHERE p.user_id IS NULL AND (to_jsonb(p) ->> 'org_id') IS NULL;
  END IF;
END $$;

-- Only set NOT NULL if backfill succeeded (no remaining nulls).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.projects WHERE user_id IS NULL) THEN
    ALTER TABLE public.projects ALTER COLUMN user_id SET NOT NULL;
  END IF;
END $$;

-- ── 2. project_access_links.seller_user_id ──────────────────────
ALTER TABLE public.project_access_links
  ADD COLUMN IF NOT EXISTS seller_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Backfill from owning project.
UPDATE public.project_access_links pal
   SET seller_user_id = p.user_id
  FROM public.projects p
 WHERE pal.project_id = p.id
   AND pal.seller_user_id IS NULL
   AND p.user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_project_access_links_seller
  ON public.project_access_links (seller_user_id);

-- ── 3. store_plays ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.store_plays (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  track_id        uuid NOT NULL REFERENCES public.tracks(id) ON DELETE CASCADE,
  seller_user_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- IP hash, never the IP itself. Server hashes with the deploy secret.
  ip_hash         text,
  -- Optional referring page on the public storefront
  source          text,  -- e.g. 'store-grid' | 'store-list' | 'store-track-detail'
  played_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_store_plays_seller_track
  ON public.store_plays (seller_user_id, track_id);
CREATE INDEX IF NOT EXISTS idx_store_plays_played_at
  ON public.store_plays (played_at DESC);

ALTER TABLE public.store_plays ENABLE ROW LEVEL SECURITY;

-- Producer reads only their own plays.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'store_plays'
      AND policyname = 'Owner reads store plays'
  ) THEN
    CREATE POLICY "Owner reads store plays"
      ON public.store_plays FOR SELECT
      USING (seller_user_id = auth.uid());
  END IF;
END $$;

-- Inserts come from the service-role client (the public /api/store/play
-- endpoint runs as service-role since visitors are unauthenticated).
-- No INSERT policy needed.

NOTIFY pgrst, 'reload schema';
