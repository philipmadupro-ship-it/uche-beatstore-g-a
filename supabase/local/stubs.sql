-- Supabase-shaped stubs for the THROWAWAY local database that
-- scripts/db/local-check.sh builds. Never run this against a real project:
-- Supabase already provides all of it, with the real implementations.
--
-- Just enough for every migration in supabase/migrations/ to apply:
-- the API roles, auth.users + auth.uid(), and the realtime publication.
-- auth.uid() reads the `request.jwt.claim.sub` setting, which is how the
-- checks impersonate a signed-in user:
--   SET ROLE authenticated;
--   SELECT set_config('request.jwt.claim.sub', '<user uuid>', false);

CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;

CREATE SCHEMA auth;
CREATE TABLE auth.users (
  id    uuid PRIMARY KEY,
  email text
);
CREATE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

-- Supabase grants the API roles everything on public; RLS is what narrows it.
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

CREATE PUBLICATION supabase_realtime;
