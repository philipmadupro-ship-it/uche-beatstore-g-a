-- The accounts the local stack signs in as (see jwt.mjs): the producer (has a
-- creator profile) and a signed-in buyer (does not). Specs seed their own data.
INSERT INTO auth.users (id, email) VALUES
  ('0b0e1a57-0000-4000-8000-000000000001', 'producer@local.test'),
  ('0b0e1a57-0000-4000-8000-0000000000b1', 'buyer@local.test'),
  -- Two more signed-in people, for specs that need roster artists of one label (label-org-song-reviews).
  ('0b0e1a57-0000-4000-8000-0000000000b2', 'artist-a@local.test'),
  ('0b0e1a57-0000-4000-8000-0000000000b3', 'artist-b@local.test')
ON CONFLICT DO NOTHING;
INSERT INTO public.creator_profiles (user_id, display_name, slug)
VALUES ('0b0e1a57-0000-4000-8000-000000000001', 'UCHE', 'uche')
ON CONFLICT DO NOTHING;

-- LABEL-47: the local producer is also the platform operator, so the console
-- e2e (e2e/label-platform-console.spec.ts) can open /platform. This is the
-- same statement the owner runs by hand on production (MIGRATIONS.md, 170);
-- no route can write this table.
INSERT INTO public.platform_admins (user_id, note)
VALUES ('0b0e1a57-0000-4000-8000-000000000001', 'local verification operator')
ON CONFLICT DO NOTHING;
