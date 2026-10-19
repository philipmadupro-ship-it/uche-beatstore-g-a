-- Seed for the go-live rehearsal (scripts/local-db/go-live-rehearsal.sh): what
-- the PRODUCTION database holds before Label OS — migrations 001-129 applied,
-- ONE producer with a profile, tracks, store listings, a project, a playlist,
-- contacts, shares, and a buyer with a paid purchase. Fixed ids, so the
-- rehearsal can prove none of it changed. LOCAL VERIFICATION ONLY.
INSERT INTO auth.users (id, email) VALUES
  ('0b0e1a57-0000-4000-8000-000000000001', 'producer@outlook.test'),
  ('0b0e1a57-0000-4000-8000-0000000000b1', 'buyer@local.test'),
  ('0b0e1a57-0000-4000-8000-0000000000b2', 'artist@local.test');

INSERT INTO public.creator_profiles (user_id, display_name, slug, bio, accent_color, license_lease_price_usd, license_exclusive_price_usd)
VALUES ('0b0e1a57-0000-4000-8000-000000000001', 'UCHE', 'uche', 'Producer bio', '#ffffff', 30, 300);

INSERT INTO public.tracks (id, user_id, title, type, audio_url, bpm, key, scale, store_listed, lease_price_usd, exclusive_price_usd, preview_url, wav_url, rating)
VALUES
  ('0b0e1a57-0000-4000-8000-00000000a001', '0b0e1a57-0000-4000-8000-000000000001', 'Night Shift', 'beat', 'r2://private/night-shift.wav', 140, 'F', 'minor', true, 30, 300, 'https://cdn.local.test/night-shift.mp3', 'r2://private/night-shift-wav.wav', 4),
  ('0b0e1a57-0000-4000-8000-00000000a002', '0b0e1a57-0000-4000-8000-000000000001', 'Cold Front', 'beat', 'r2://private/cold-front.wav', 92, 'Bb', 'major', true, NULL, NULL, 'https://cdn.local.test/cold-front.mp3', NULL, 5),
  ('0b0e1a57-0000-4000-8000-00000000a003', '0b0e1a57-0000-4000-8000-000000000001', 'Unlisted Sketch', 'beat', 'r2://private/sketch.wav', 120, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL),
  ('0b0e1a57-0000-4000-8000-00000000a004', '0b0e1a57-0000-4000-8000-000000000001', 'Sold Exclusive', 'beat', 'r2://private/sold.wav', 100, 'C', 'major', false, 30, 300, NULL, NULL, 3);
UPDATE public.tracks SET exclusive_sold = true WHERE id = '0b0e1a57-0000-4000-8000-00000000a004';

INSERT INTO public.projects (id, user_id, name, description, status, store_featured, price_usd)
VALUES ('0b0e1a57-0000-4000-8000-00000000b001', '0b0e1a57-0000-4000-8000-000000000001', 'Winter Pack', 'Bundle', 'in_progress', true, 80);
INSERT INTO public.project_tracks (project_id, track_id, position) VALUES
  ('0b0e1a57-0000-4000-8000-00000000b001', '0b0e1a57-0000-4000-8000-00000000a001', 0),
  ('0b0e1a57-0000-4000-8000-00000000b001', '0b0e1a57-0000-4000-8000-00000000a002', 1);
INSERT INTO public.playlists (id, user_id, name, store_featured)
VALUES ('0b0e1a57-0000-4000-8000-00000000c001', '0b0e1a57-0000-4000-8000-000000000001', 'Outreach', true);
INSERT INTO public.playlist_tracks (playlist_id, track_id, position)
VALUES ('0b0e1a57-0000-4000-8000-00000000c001', '0b0e1a57-0000-4000-8000-00000000a001', 0);

INSERT INTO public.contacts (id, user_id, name, email, category) VALUES
  ('0b0e1a57-0000-4000-8000-00000000d001', '0b0e1a57-0000-4000-8000-000000000001', 'Nova', 'nova@artist.test', 'artist'),
  ('0b0e1a57-0000-4000-8000-00000000d002', '0b0e1a57-0000-4000-8000-000000000001', 'A Buyer', 'buyer@local.test', 'buyer');
INSERT INTO public.project_contacts (project_id, contact_id, user_id, in_portal)
VALUES ('0b0e1a57-0000-4000-8000-00000000b001', '0b0e1a57-0000-4000-8000-00000000d001', '0b0e1a57-0000-4000-8000-000000000001', true);
INSERT INTO public.artist_portals (contact_id, user_id, token) VALUES ('0b0e1a57-0000-4000-8000-00000000d001', '0b0e1a57-0000-4000-8000-000000000001', 'portal-token-rehearsal');

INSERT INTO public.licenses (id, user_id, name, price_usd, file_types)
VALUES ('0b0e1a57-0000-4000-8000-00000000e001', '0b0e1a57-0000-4000-8000-000000000001', 'MP3 Lease', 30, ARRAY['mp3']);
INSERT INTO public.license_purchases (id, seller_user_id, buyer_email, track_ids, license_type, amount_usd, stripe_session_id, status, download_unlocked)
VALUES ('0b0e1a57-0000-4000-8000-00000000f001', '0b0e1a57-0000-4000-8000-000000000001', 'buyer@local.test',
        ARRAY['0b0e1a57-0000-4000-8000-00000000a001']::uuid[], 'lease', 30, 'cs_test_rehearsal_1', 'paid', true);
INSERT INTO public.project_access_links (id, project_id, buyer_email, token, stripe_session_id, amount_usd, seller_user_id)
VALUES ('0b0e1a57-0000-4000-8000-00000000f002', '0b0e1a57-0000-4000-8000-00000000b001', 'buyer@local.test', 'access-token-rehearsal', 'cs_test_rehearsal_2', 80, '0b0e1a57-0000-4000-8000-000000000001');
INSERT INTO public.buyer_favorites (email, track_id) VALUES ('buyer@local.test', '0b0e1a57-0000-4000-8000-00000000a002');
INSERT INTO public.buyer_offers (id, seller_user_id, track_id, track_title, buyer_email, offered_price_usd, status)
VALUES ('0b0e1a57-0000-4000-8000-00000000f003', '0b0e1a57-0000-4000-8000-000000000001', '0b0e1a57-0000-4000-8000-00000000a002', 'Cold Front', 'buyer@local.test', 25, 'pending');
INSERT INTO public.promo_codes (code, user_id, discount_percent, active)
VALUES ('WELCOME10', '0b0e1a57-0000-4000-8000-000000000001', 10, true);
INSERT INTO public.share_links (token, track_ids, user_id, recipient_kind, allow_downloads)
VALUES ('share-token-rehearsal', ARRAY['0b0e1a57-0000-4000-8000-00000000a001']::uuid[], '0b0e1a57-0000-4000-8000-000000000001', 'client', true);
INSERT INTO public.beat_sends (contact_id, track_ids, share_token, status)
VALUES ('0b0e1a57-0000-4000-8000-00000000d001', ARRAY['0b0e1a57-0000-4000-8000-00000000a001']::uuid[], 'share-token-rehearsal', 'sent');
INSERT INTO public.notifications (user_id, kind, title, body)
VALUES ('0b0e1a57-0000-4000-8000-000000000001', 'sale', 'New sale', 'Night Shift');
