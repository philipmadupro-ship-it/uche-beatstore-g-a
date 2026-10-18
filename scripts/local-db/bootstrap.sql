-- Minimal stand-in for what a Supabase project provides before migration 001:
-- the API roles, the auth schema (users + auth.uid() reading PostgREST's JWT
-- claims), pgcrypto and the realtime publication. LOCAL VERIFICATION ONLY.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticator') THEN CREATE ROLE authenticator LOGIN NOINHERIT PASSWORD 'authpass'; END IF;
END $$;
GRANT anon, authenticated, service_role TO authenticator;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text,
  -- Supabase sets this when the address is verified (magic link, OAuth,
  -- confirmation email). Local users count as verified unless a check says not.
  email_confirmed_at timestamptz DEFAULT now(),
  raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
  raw_app_meta_data jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz DEFAULT now();
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid
$$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT current_setting('request.jwt.claims', true)::json->>'role'
$$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('request.jwt.claims', true), '{}')::jsonb
$$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT SELECT ON auth.users TO service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN CREATE PUBLICATION supabase_realtime; END IF;
END $$;

-- ── Local stand-in for Supabase's auth admin API (doc 25 team accounts) ────
-- LOCAL STACK ONLY: never a migration. gateway.mjs serves
-- /auth/v1/admin/users{,/<id>} and /auth/v1/token?grant_type=password through
-- these, with the service key, so e2e can create a team account through the
-- real route and sign in with its password through the real /login form.
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS encrypted_password text;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS banned_until timestamptz;

CREATE OR REPLACE FUNCTION public.local_auth_admin_create(p_email text, p_password text, p_meta jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, extensions AS $$
DECLARE v_id uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE lower(email) = lower(p_email)) THEN
    RETURN jsonb_build_object('error', 'email_exists');
  END IF;
  INSERT INTO auth.users (email, encrypted_password, raw_user_meta_data)
  VALUES (lower(p_email), CASE WHEN p_password IS NULL THEN NULL ELSE crypt(p_password, gen_salt('bf')) END, coalesce(p_meta, '{}'))
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id, 'email', lower(p_email));
END $$;

CREATE OR REPLACE FUNCTION public.local_auth_admin_update(p_id uuid, p_password text, p_ban text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, extensions AS $$
BEGIN
  UPDATE auth.users SET
    encrypted_password = CASE WHEN p_password IS NULL THEN encrypted_password ELSE crypt(p_password, gen_salt('bf')) END,
    banned_until = CASE WHEN p_ban IS NULL THEN banned_until WHEN p_ban = 'none' THEN NULL ELSE now() + p_ban::interval END
  WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  RETURN (SELECT jsonb_build_object('id', id, 'email', email) FROM auth.users WHERE id = p_id);
END $$;

CREATE OR REPLACE FUNCTION public.local_auth_admin_delete(p_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public, auth AS $$
  WITH d AS (DELETE FROM auth.users WHERE id = p_id RETURNING id) SELECT jsonb_build_object('deleted', count(*)) FROM d;
$$;

CREATE OR REPLACE FUNCTION public.local_auth_admin_get(p_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT jsonb_build_object('id', id, 'email', email, 'user_metadata', raw_user_meta_data, 'banned_until', banned_until) FROM auth.users WHERE id = p_id;
$$;

CREATE OR REPLACE FUNCTION public.local_auth_password_sign_in(p_email text, p_password text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public, auth, extensions AS $$
  SELECT jsonb_build_object('id', id, 'email', email)
  FROM auth.users
  WHERE lower(email) = lower(p_email)
    AND encrypted_password IS NOT NULL
    AND encrypted_password = crypt(p_password, encrypted_password)
    AND (banned_until IS NULL OR banned_until < now());
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['local_auth_admin_create(text, text, jsonb)', 'local_auth_admin_update(uuid, text, text)',
                           'local_auth_admin_delete(uuid)', 'local_auth_admin_get(uuid)', 'local_auth_password_sign_in(text, text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
END $$;
