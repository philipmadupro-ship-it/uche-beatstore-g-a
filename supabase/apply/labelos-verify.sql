-- Read-only: which migrations of the Label OS go-live bundle are in effect on
-- this database (112-135 + 139_buyer_offer_email_verified from main's ledger,
-- then every Label OS migration 136-172, 189, 190, then the operator row).
-- Run it on its own any time; supabase/apply/labelos-go-live.sql also ends
-- with it. Every row must read 'applied'. Hand-maintained: one row per
-- migration, keyed on an object the migration creates (a table, column, trigger,
-- policy, or a marker in a redefined function's body).
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
  ('139_buyer_offer_email_verified', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'buyer_offers' AND column_name = 'buyer_email_verified')),
  ('133_track_links',                to_regclass('public.track_links') IS NOT NULL
                                     AND pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname = 'tracks_type_check' AND conrelid = 'public.tracks'::regclass)) LIKE '%topline%'
                                     AND (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.tracks'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%instrumental%') = 1),
  ('136_labelos_org_core', to_regclass('public.organizations') IS NOT NULL AND to_regclass('public.org_members') IS NOT NULL AND to_regclass('public.org_invitations') IS NOT NULL AND to_regclass('public.user_profiles') IS NOT NULL AND to_regclass('public.activity_events') IS NOT NULL),
  ('137_labelos_producer_org', EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'labelos_ensure_producer_org') AND NOT EXISTS (SELECT 1 FROM public.creator_profiles cp WHERE NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.kind = 'producer' AND o.created_by = cp.user_id))),
  ('138_labelos_invitation_accept', EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'labelos_accept_invitation')),
  ('139_labelos_org_contacts', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'contacts' AND column_name = 'org_id') AND to_regclass('public.member_artist_scopes') IS NOT NULL),
  ('140_labelos_song_fields', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tracks' AND column_name = 'song_stage') AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tracks' AND column_name = 'iswc')),
  ('141_labelos_org_catalog', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tracks' AND column_name = 'org_id') AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'org_id') AND EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'can_read_org_track')),
  ('142_labelos_project_tracks_same_org', EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'project_tracks_same_owner' AND NOT tgisinternal)),
  ('143_labelos_org_assets', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'project_assets' AND column_name = 'org_id') AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'project_assets' AND column_name = 'sensitivity')),
  ('144_labelos_releases', to_regclass('public.releases') IS NOT NULL AND to_regclass('public.release_items') IS NOT NULL),
  ('145_labelos_ownerless_workspace_rows', EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'artist_portals_same_owner')),
  ('146_labelos_audit_rpc', EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'labelos_audit_member_remove')),
  ('147_labelos_activity_feeds', EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'activity_events' AND policyname = 'activity_events_member_read')),
  ('148_labelos_project_members', to_regclass('public.project_members') IS NOT NULL),
  ('149_labelos_song_reviews', to_regclass('public.song_reviews') IS NOT NULL),
  ('150_labelos_org_comments', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'project_comments' AND column_name = 'org_id') AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'project_comments' AND column_name = 'visibility')),
  ('151_labelos_tasks_notifications', to_regclass('public.tasks') IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'org_id')),
  ('152_labelos_creative_direction', to_regclass('public.artist_direction') IS NOT NULL AND to_regclass('public.artist_references') IS NOT NULL),
  ('153_labelos_parties_credits', to_regclass('public.parties') IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'track_collaborators' AND column_name = 'party_id')),
  ('154_labelos_artist_label_connection', to_regclass('public.org_connections') IS NOT NULL AND to_regclass('public.connection_projects') IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tracks' AND column_name = 'provenance')),
  ('155_labelos_split_sheets', to_regclass('public.split_sheets') IS NOT NULL AND to_regclass('public.split_lines') IS NOT NULL),
  ('156_labelos_samples_declared', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tracks' AND column_name = 'samples_declared')),
  ('157_labelos_approvals', to_regclass('public.approvals') IS NOT NULL AND EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'approvals_guard')),
  ('158_labelos_release_store_playback', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'releases' AND column_name = 'store_playback') AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'release_items_store_lock' AND NOT tgisinternal)),
  ('159_labelos_org_search', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tracks' AND column_name = 'search_tsv') AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'contacts' AND column_name = 'search_tsv') AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'search_tsv')),
  ('160_labelos_weekly_digest', to_regclass('public.org_digest_members') IS NOT NULL AND to_regclass('public.org_digest_channels') IS NOT NULL),
  ('161_labelos_saved_views', to_regclass('public.org_saved_views') IS NOT NULL),
  ('162_labelos_split_sheets_column_grants', has_column_privilege('authenticated', 'public.split_sheets', 'circulated_at', 'SELECT') AND NOT has_table_privilege('authenticated', 'public.split_sheets', 'SELECT')),
  ('163_labelos_audit_events_immutable', EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'activity_events_audit_immutable' AND NOT tgisinternal)),
  ('164_labelos_member_read_scope', EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'org_members' AND policyname = 'org_members_member_read') AND EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'labelos_my_live_orgs')),
  ('165_labelos_playlist_tracks_same_owner', EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'playlist_tracks_same_owner' AND NOT tgisinternal)),
  ('166_labelos_one_artist_per_artist_org', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'contacts' AND column_name = 'org_self_artist') AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'contacts_org_self_artist' AND NOT tgisinternal)),
  ('167_labelos_release_items_lock_member_cas', EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'labelos_release_item_update')),
  ('168_labelos_search_tokenization', EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.tracks'::regclass AND a.attname = 'search_tsv' AND a.attgenerated = 's')),
  ('169_labelos_overview_seen_per_org', to_regclass('public.org_overview_seen') IS NOT NULL),
  ('170_labelos_entitlements_platform', to_regclass('public.platform_admins') IS NOT NULL AND to_regclass('public.org_entitlements') IS NOT NULL),
  ('171_labelos_departments_capabilities', EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'has_org_cap' AND pg_get_functiondef(p.oid) LIKE '%finance.approve%')),
  ('172_labelos_org_settings', EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'labelos_audit_org_settings')),
  ('173_labelos_track_metadata', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tracks' AND column_name = 'metadata_updated_at')),
  ('189_labelos_setup_org', EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'labelos_setup_org')),
  ('190_labelos_team_accounts', to_regclass('public.org_managed_accounts') IS NOT NULL AND EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'labelos_revoke_auth_sessions')),
  ('192_labelos_setup_wizard', EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'labelos_validate_org_settings_patch')),
  ('operator: producer is a platform admin', EXISTS (SELECT 1 FROM public.creator_profiles) AND NOT EXISTS (SELECT 1 FROM public.creator_profiles cp WHERE NOT EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = cp.user_id)))
) AS m(migration, ok)
ORDER BY m.migration;
