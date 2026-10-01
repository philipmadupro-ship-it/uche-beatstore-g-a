-- Read-only: which pending migrations are in effect on this database.
-- Run it on its own any time; the bundle also ends with it.
SELECT m.migration,
       CASE WHEN m.ok THEN 'applied' ELSE 'MISSING' END AS status
FROM (VALUES
  ('112_backfill_buyer_contacts',    NOT EXISTS (
     SELECT 1 FROM public.license_purchases lp
     WHERE lp.status = 'paid' AND lp.seller_user_id IS NOT NULL AND lp.buyer_email IS NOT NULL
       AND lower(btrim(lp.buyer_email)) <> 'unknown@invalid' AND position('@' in lp.buyer_email) > 1
       AND NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.user_id = lp.seller_user_id AND lower(btrim(c.email)) = lower(btrim(lp.buyer_email))))),
  ('113_store_layout',               EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'creator_profiles' AND column_name = 'store_layout')),
  ('115_track_collaborators',        to_regclass('public.track_collaborators') IS NOT NULL),
  ('116_notifications_realtime',     EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notifications')),
  ('121_share_full_playback',        EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'project_shares' AND column_name = 'full_playback')),
  ('122_project_contacts',           to_regclass('public.project_contacts') IS NOT NULL),
  ('123_contact_track_states',       to_regclass('public.contact_track_states') IS NOT NULL),
  ('124_song_beat_and_credit_links', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tracks' AND column_name = 'beat_track_id')),
  ('125_artist_portals',             to_regclass('public.artist_portals') IS NOT NULL),
  ('126_project_shares_contact',     EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'project_shares' AND column_name = 'contact_id')),
  ('127_project_assets',             to_regclass('public.project_assets') IS NOT NULL),
  ('128_portal_comments',            EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'project_comments' AND column_name = 'contact_id')),
  ('129_artist_portal_auto_digest',  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'artist_portals' AND column_name = 'auto_digest')),
  ('130_artist_messages',            to_regclass('public.artist_messages') IS NOT NULL),
  ('131_portal_sign_in',             EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'artist_portals' AND column_name = 'require_sign_in')),
  ('132_song_beats',                 to_regclass('public.song_beats') IS NOT NULL),
  ('134_contact_secondary_role',     EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'contacts' AND column_name = 'secondary_category')),
  ('135_portal_pitch_note',          EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'project_contacts' AND column_name = 'pitch_note')),
  ('133_track_links',                to_regclass('public.track_links') IS NOT NULL
                                     AND pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname = 'tracks_type_check' AND conrelid = 'public.tracks'::regclass)) LIKE '%topline%'
                                     AND (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.tracks'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%instrumental%') = 1)
) AS m(migration, ok)
ORDER BY m.migration;
