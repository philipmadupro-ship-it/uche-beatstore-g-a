-- Adds a per-cart-item breakdown to license_purchases so mixed-license
-- checkouts (1 lease + 1 exclusive) are recorded correctly. Pre-029 the
-- webhook collapsed every item to cartItems[0].license_id, silently
-- mis-tagging the rest.
--
-- Shape of line_items: jsonb array of { track_id: uuid, license_type: text }.
-- The legacy top-level `license_type` and `track_ids[]` columns stay as
-- denormalized "headline" fields (license_type = first item's type,
-- track_ids = full array) so existing readers don't break.
--
-- The gated download endpoint reads line_items to know which tracks were
-- licensed under what terms — necessary for issuing the right WAV/stems
-- bundle per item.

ALTER TABLE public.license_purchases
  ADD COLUMN IF NOT EXISTS line_items jsonb;

-- Backfill old rows from the denormalized columns so readers always
-- have line_items populated, even for purchases made before this migration.
UPDATE public.license_purchases
  SET line_items = (
    SELECT jsonb_agg(jsonb_build_object('track_id', tid, 'license_type', license_type))
    FROM unnest(track_ids) AS tid
  )
  WHERE line_items IS NULL AND track_ids IS NOT NULL AND array_length(track_ids, 1) > 0;

NOTIFY pgrst, 'reload schema';
