-- Query indexes for the 500-600 beat catalogue rollout.
-- Kept separate from feature migrations so production can apply/verify them
-- independently with EXPLAIN ANALYZE before the real inventory import.

CREATE INDEX IF NOT EXISTS idx_tracks_public_catalog_order
  ON public.tracks (user_id, store_sort_order ASC NULLS LAST, created_at DESC)
  WHERE store_listed = true;

CREATE INDEX IF NOT EXISTS idx_track_tags_facet_lookup
  ON public.track_tags (category, tag, track_id);

CREATE INDEX IF NOT EXISTS idx_store_plays_track_played
  ON public.store_plays (track_id, played_at DESC);

CREATE INDEX IF NOT EXISTS idx_share_plays_link_track_played
  ON public.share_plays (link_token, track_id, played_at DESC);

CREATE INDEX IF NOT EXISTS idx_license_purchases_track_ids_gin
  ON public.license_purchases USING gin (track_ids);

CREATE INDEX IF NOT EXISTS idx_license_purchases_seller_status_created
  ON public.license_purchases (seller_user_id, status, created_at DESC);

NOTIFY pgrst, 'reload schema';

