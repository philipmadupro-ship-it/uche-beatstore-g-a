-- 093_perf_indexes_rls.sql
-- Performance indexes and RLS query improvements.
-- Findings from Supabase Postgres Best Practices audit.
--
-- 1. Wrap auth.uid() in sub-SELECTs on hot policies so Postgres evaluates
--    it once per statement rather than once per row.
-- 2. Add missing FK indexes on contact_tags and playlist_tags junction tables
--    (FK constraints do not auto-create indexes in Postgres).
-- 3. Add user_id index on licenses table for per-producer license lookups.

-- ── RLS: contact_segments ────────────────────────────────────────────────
-- auth.uid() called per-row without the subquery optimization.
DROP POLICY IF EXISTS "owner" ON public.contact_segments;
CREATE POLICY "owner" ON public.contact_segments
  FOR ALL
  USING  ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- ── Missing FK indexes ───────────────────────────────────────────────────
-- contact_tags.contact_id — used in the RLS EXISTS check and in batch
-- GET /api/contacts (`.in('contact_id', ids)`).
CREATE INDEX IF NOT EXISTS idx_contact_tags_contact
  ON public.contact_tags (contact_id);

-- playlist_tags.playlist_id — same pattern (mig 086).
CREATE INDEX IF NOT EXISTS idx_playlist_tags_playlist
  ON public.playlist_tags (playlist_id);

-- project_tags.project_id — same pattern (mig 081).
CREATE INDEX IF NOT EXISTS idx_project_tags_project
  ON public.project_tags (project_id);

-- ── Licenses table ───────────────────────────────────────────────────────
-- Per-producer license lookups hit this table on every store page load.
CREATE INDEX IF NOT EXISTS idx_licenses_user_sort
  ON public.licenses (user_id, sort_order);

-- track_licenses lookup by track_id (store detail page resolves tiers).
CREATE INDEX IF NOT EXISTS idx_track_licenses_track
  ON public.track_licenses (track_id);

-- ── Store plays ──────────────────────────────────────────────────────────
-- store_plays is queried with .in('track_id', ids) for the popular sort.
-- The existing idx_store_plays_track may cover this; create if missing.
CREATE INDEX IF NOT EXISTS idx_store_plays_track_id
  ON public.store_plays (track_id);

NOTIFY pgrst, 'reload schema';
