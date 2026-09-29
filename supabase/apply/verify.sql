-- Read-only: which pending migrations are in effect on this database.
-- Run it on its own any time; the bundle also ends with it.
SELECT m.migration,
       CASE WHEN m.ok THEN 'applied' ELSE 'MISSING' END AS status
FROM (VALUES
  ('113_store_layout',               EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'creator_profiles' AND column_name = 'store_layout')),
  ('115_track_collaborators',        to_regclass('public.track_collaborators') IS NOT NULL),
  ('116_notifications_realtime',     EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notifications')),
  ('121_share_full_playback',        EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'project_shares' AND column_name = 'full_playback')),
  ('122_project_contacts',           to_regclass('public.project_contacts') IS NOT NULL),
  ('123_contact_track_states',       to_regclass('public.contact_track_states') IS NOT NULL),
  ('124_song_beat_and_credit_links', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tracks' AND column_name = 'beat_track_id')),
  ('125_artist_portals',             to_regclass('public.artist_portals') IS NOT NULL),
  ('126_project_shares_contact',     EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'project_shares' AND column_name = 'contact_id'))
) AS m(migration, ok)
ORDER BY m.migration;
