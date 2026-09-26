-- 117: stop any authenticated user from minting a creator_profiles row.
--
-- A creator_profiles row is what identifies THE producer: src/proxy.ts and
-- requireProducer (lib/auth/ownership.ts) both treat "has a row" as "is the
-- producer". Buyers sign in through the same Supabase auth (magic link /
-- Google at /store/account), and creator_profiles_insert (mig 015/026)
-- allowed `user_id = auth.uid()`, so any buyer could POST their own row
-- straight to PostgREST with the anon key + their JWT and pass every
-- producer gate — including the masters proxy at /api/audio.
--
-- Profile writes go through /api/profile, which uses the service role and
-- now only creates a row when none exists (first-run bootstrap). No client
-- path inserts directly, so dropping the policy removes nothing legitimate.
-- The owner UPDATE and public SELECT policies are unchanged.

DROP POLICY IF EXISTS creator_profiles_insert ON public.creator_profiles;

NOTIFY pgrst, 'reload schema';
