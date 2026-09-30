-- The accounts the local stack signs in as (see jwt.mjs): the producer (has a
-- creator profile) and a signed-in buyer (does not). Specs seed their own data.
INSERT INTO auth.users (id, email) VALUES
  ('0b0e1a57-0000-4000-8000-000000000001', 'producer@local.test'),
  ('0b0e1a57-0000-4000-8000-0000000000b1', 'buyer@local.test')
ON CONFLICT DO NOTHING;
INSERT INTO public.creator_profiles (user_id, display_name, slug)
VALUES ('0b0e1a57-0000-4000-8000-000000000001', 'UCHE', 'uche')
ON CONFLICT DO NOTHING;
