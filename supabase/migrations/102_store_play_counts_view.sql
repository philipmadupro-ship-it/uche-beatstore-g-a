CREATE OR REPLACE VIEW public.store_play_counts AS
SELECT
  track_id,
  seller_user_id,
  COUNT(*)::integer AS play_count,
  MAX(played_at) AS last_played_at
FROM public.store_plays
GROUP BY track_id, seller_user_id;

COMMENT ON VIEW public.store_play_counts IS
  'Aggregate storefront play counts by track so catalogue APIs do not fetch raw play rows.';

NOTIFY pgrst, 'reload schema';
