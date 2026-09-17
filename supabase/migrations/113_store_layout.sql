-- Storefront layout document.
--
-- The Store Editor now composes `/store` from an ordered list of sections plus
-- a theme, rather than the section order living in JSX. This column holds that
-- document.
--
-- NULL is meaningful and is the default: it means "this producer has never
-- opened the builder", and the storefront falls back to `defaultStoreLayout()`,
-- which reproduces the page exactly as it renders today. So shipping this
-- migration changes nothing visible until someone saves a layout — existing
-- storefronts are untouched.
--
-- jsonb rather than json: we never need to preserve key order or whitespace,
-- and jsonb gives us containment operators if a later feature wants to query
-- "which storefronts use a video section".

ALTER TABLE creator_profiles
  ADD COLUMN IF NOT EXISTS store_layout jsonb;

COMMENT ON COLUMN creator_profiles.store_layout IS
  'Storefront section layout + theme. NULL means use the default layout.';

-- Guard against a runaway document. A realistic layout is a few kilobytes; the
-- cap is set far above that but low enough that a malformed client cannot push
-- an unbounded blob into a row that is read on every storefront render.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'creator_profiles_store_layout_size'
  ) THEN
    ALTER TABLE creator_profiles
      ADD CONSTRAINT creator_profiles_store_layout_size
      CHECK (store_layout IS NULL OR pg_column_size(store_layout) < 262144);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
