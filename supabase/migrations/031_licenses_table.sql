-- ── 031_licenses_table.sql ─────────────────────────────────────────────────
-- Introduces a proper per-creator license tier system. Previously licenses
-- were implicitly just "lease" and "exclusive" with prices stored on the
-- creator_profiles row. This migration adds:
--
--   licenses          — up to 4 tiers per creator (name, price, rights flags)
--   track_licenses    — per-track overrides / enable/disable a tier on a track
--
-- The existing lease_price_usd / exclusive_price_usd columns on tracks and
-- creator_profiles are NOT removed — they continue to power the current UI
-- as long as the license builder hasn't been used. The new tables layer on
-- top; the storefront resolver checks track_licenses first, then falls back
-- to the legacy columns.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── licenses ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.licenses (
  id                    uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id               uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Display
  name                  text        NOT NULL,
  description           text,

  -- Pricing
  price_usd             numeric(10,2) NOT NULL DEFAULT 0,
  is_free               boolean     NOT NULL DEFAULT false,

  -- Delivery
  file_types            text[]      NOT NULL DEFAULT '{MP3}',
  stems_included        boolean     NOT NULL DEFAULT false,

  -- Rights
  is_exclusive          boolean     NOT NULL DEFAULT false,
  streaming_limit       integer,    -- NULL = unlimited
  distribution_limit    integer,    -- NULL = unlimited
  commercial_rights     boolean     NOT NULL DEFAULT true,
  sync_rights           boolean     NOT NULL DEFAULT false,
  broadcast_rights      boolean     NOT NULL DEFAULT false,
  credit_required       boolean     NOT NULL DEFAULT true,

  -- UI order (drag-and-drop sorts this)
  sort_order            integer     NOT NULL DEFAULT 0,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.licenses ENABLE ROW LEVEL SECURITY;

-- Owner can do everything; public gets nothing (prices go through the public
-- /api/store endpoint which uses the service-role client).
DROP POLICY IF EXISTS "licenses_owner_all" ON public.licenses;
CREATE POLICY "licenses_owner_all"
  ON public.licenses
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ── track_licenses ────────────────────────────────────────────────────────────
-- Per-track toggle + optional price override. When a row exists the license
-- is enabled for that track; when absent the license is globally available
-- (all store-listed tracks) unless track_licenses rows exist for ANY license
-- on that track, in which case only listed rows apply.
--
-- In practice: if you create license rows and link them here the old
-- lease_price_usd / exclusive_price_usd columns become inert.
CREATE TABLE IF NOT EXISTS public.track_licenses (
  track_id              uuid        NOT NULL REFERENCES public.tracks(id) ON DELETE CASCADE,
  license_id            uuid        NOT NULL REFERENCES public.licenses(id) ON DELETE CASCADE,
  price_override_usd    numeric(10,2),   -- NULL = inherit license.price_usd
  enabled               boolean     NOT NULL DEFAULT true,
  PRIMARY KEY (track_id, license_id)
);

ALTER TABLE public.track_licenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "track_licenses_owner_all" ON public.track_licenses;
CREATE POLICY "track_licenses_owner_all"
  ON public.track_licenses
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.tracks t
      WHERE t.id = track_licenses.track_id
        AND t.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tracks t
      WHERE t.id = track_licenses.track_id
        AND t.user_id = auth.uid()
    )
  );

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS licenses_user_id_sort_idx
  ON public.licenses (user_id, sort_order);

CREATE INDEX IF NOT EXISTS track_licenses_track_id_idx
  ON public.track_licenses (track_id);

CREATE INDEX IF NOT EXISTS track_licenses_license_id_idx
  ON public.track_licenses (license_id);

-- ── updated_at trigger ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS licenses_set_updated_at ON public.licenses;
CREATE TRIGGER licenses_set_updated_at
  BEFORE UPDATE ON public.licenses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

NOTIFY pgrst, 'reload schema';
