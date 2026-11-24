-- Behaviour checks for 202_share_token_cross_table_unique.sql (SHARE-04), run by
-- scripts/local-db/check.sh (npm run db:local:check). Every check RAISEs on failure.
--
-- Proven, in BOTH directions between every pair of tables: a token already in one share
-- table is refused (23505, constraint share_token_cross_table_unique) when inserted into
-- either of the others, and when an UPDATE rotates a row onto it; same-table reuse still
-- fails on the table's own key; a fresh token and an unchanged-token UPDATE are allowed.

\set U  '''a2020000-0000-4000-8000-000000000001'''
\set T1 '''c2020000-0000-4000-8000-000000000001'''
\set P1 '''c2020000-0000-4000-8000-000000000002'''

INSERT INTO auth.users (id, email) VALUES (:U, 'u202@local.test');
INSERT INTO public.creator_profiles (user_id, display_name, slug) VALUES (:U, 'Prod 202', 'prod-202');
INSERT INTO public.tracks (id, user_id, title, type, audio_url) VALUES (:T1, :U, 't202', 'beat', 'r2://x/y');
INSERT INTO public.projects (id, user_id, name) VALUES (:P1, :U, 'p202');

CREATE OR REPLACE FUNCTION pg_temp.ins(tbl text, tok text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE cid uuid;
BEGIN
  IF tbl = 'share_links' THEN
    INSERT INTO public.share_links (token, track_ids) VALUES (tok, ARRAY['c2020000-0000-4000-8000-000000000001']::uuid[]);
  ELSIF tbl = 'project_shares' THEN
    INSERT INTO public.project_shares (project_id, token) VALUES ('c2020000-0000-4000-8000-000000000002', tok);
  ELSE
    -- artist_portals.contact_id is UNIQUE, so every portal gets its own contact.
    INSERT INTO public.contacts (id, user_id, name, email)
      VALUES (gen_random_uuid(), 'a2020000-0000-4000-8000-000000000001', 'pc ' || tok, gen_random_uuid()::text || '@local.test') RETURNING id INTO cid;
    INSERT INTO public.artist_portals (user_id, contact_id, token) VALUES ('a2020000-0000-4000-8000-000000000001', cid, tok);
  END IF;
END $$;

-- Returns the constraint name a failed insert raised ('' if it succeeded).
CREATE OR REPLACE FUNCTION pg_temp.try_ins(tbl text, tok text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE c text; s text;
BEGIN
  PERFORM pg_temp.ins(tbl, tok);
  RETURN '';
EXCEPTION WHEN unique_violation THEN
  GET STACKED DIAGNOSTICS c = CONSTRAINT_NAME;
  RETURN coalesce(c, '?');
END $$;

DO $$
DECLARE
  tables text[] := ARRAY['share_links', 'project_shares', 'artist_portals'];
  a text; b text; tok text; got text; n int := 0;
BEGIN
  FOREACH a IN ARRAY tables LOOP
    FOREACH b IN ARRAY tables LOOP
      n := n + 1;
      tok := 'xtok202_' || n;
      PERFORM pg_temp.ins(a, tok);
      got := pg_temp.try_ins(b, tok);
      IF a = b THEN
        IF got NOT IN ('share_links_token_key', 'project_shares_token_key', 'artist_portals_token_key') THEN
          RAISE EXCEPTION '202: same-table reuse in % should hit its own key, got "%"', a, got;
        END IF;
      ELSIF got <> 'share_token_cross_table_unique' THEN
        RAISE EXCEPTION '202: token held by % was accepted by % (constraint "%")', a, b, got;
      END IF;
    END LOOP;
  END LOOP;

  -- A fresh token is accepted by every table.
  FOREACH a IN ARRAY tables LOOP
    IF pg_temp.try_ins(a, 'fresh202_' || a) <> '' THEN
      RAISE EXCEPTION '202: a fresh token was refused by %', a;
    END IF;
  END LOOP;
END $$;

-- UPDATE path: rotating a row onto a token held elsewhere is refused; leaving the token alone is not.
DO $$
DECLARE c text;
BEGIN
  -- fresh202_share_links is held by share_links; try to move the project share onto it.
  BEGIN
    UPDATE public.project_shares SET token = 'fresh202_share_links' WHERE token = 'fresh202_project_shares';
    RAISE EXCEPTION '202: UPDATE onto another table''s token was accepted';
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS c = CONSTRAINT_NAME;
    IF c <> 'share_token_cross_table_unique' THEN RAISE EXCEPTION '202: update refused on "%"', c; END IF;
  END;
  BEGIN
    UPDATE public.artist_portals SET token = 'fresh202_project_shares' WHERE token = 'fresh202_artist_portals';
    RAISE EXCEPTION '202: portal UPDATE onto another table''s token was accepted';
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS c = CONSTRAINT_NAME;
    IF c <> 'share_token_cross_table_unique' THEN RAISE EXCEPTION '202: portal update refused on "%"', c; END IF;
  END;
  -- Same token written back, and a move onto a brand-new one: both allowed.
  UPDATE public.share_links SET token = token WHERE token = 'fresh202_share_links';
  UPDATE public.project_shares SET token = 'rotated202' WHERE token = 'fresh202_project_shares';
  IF NOT EXISTS (SELECT 1 FROM public.project_shares WHERE token = 'rotated202') THEN
    RAISE EXCEPTION '202: rotating to a free token failed';
  END IF;
END $$;

-- The guard function is not callable by the API roles.
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.share_token_cross_table_guard()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.share_token_cross_table_guard()', 'EXECUTE') THEN
    RAISE EXCEPTION '202: guard function executable by an API role';
  END IF;
END $$;
