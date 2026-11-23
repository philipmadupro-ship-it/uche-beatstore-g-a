-- 202_share_token_cross_table_unique.sql (SHARE-04)
--
-- One URL token is looked up across share_links, project_shares and
-- artist_portals (resolveShareToken). Each table's token is UNIQUE on its own,
-- but nothing stopped the SAME token existing in two of them, so the wrong
-- share could resolve. These triggers refuse it, raising unique_violation
-- (23505) with the constraint name `share_token_cross_table_unique`, which
-- lib/share/token-mint.ts recognises and answers by minting a fresh token.
--
-- Run supabase/apply/editor/202_find_cross_table_token_dupes.sql FIRST: a
-- token already in two tables is not touched by this migration (an UPDATE that
-- leaves the token as it is is allowed), but it should be reissued by hand.
--
-- The check takes a transaction-level advisory lock on the token, so two
-- concurrent inserts of one token into DIFFERENT tables (which cannot see each
-- other's uncommitted row) are serialised: the second waits, then sees the first.

CREATE OR REPLACE FUNCTION public.share_token_cross_table_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  taken boolean := false;
BEGIN
  IF NEW.token IS NULL THEN
    RETURN NEW;
  END IF;
  -- Same token on the same row (an UPDATE of another column in the list): nothing to prove.
  IF TG_OP = 'UPDATE' AND NEW.token IS NOT DISTINCT FROM OLD.token THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('share_token:' || NEW.token, 0));

  IF TG_TABLE_NAME <> 'share_links' THEN
    taken := taken OR EXISTS (SELECT 1 FROM public.share_links WHERE token = NEW.token);
  END IF;
  IF TG_TABLE_NAME <> 'project_shares' THEN
    taken := taken OR EXISTS (SELECT 1 FROM public.project_shares WHERE token = NEW.token);
  END IF;
  IF TG_TABLE_NAME <> 'artist_portals' THEN
    taken := taken OR EXISTS (SELECT 1 FROM public.artist_portals WHERE token = NEW.token);
  END IF;

  IF taken THEN
    RAISE EXCEPTION 'duplicate key value violates unique constraint "share_token_cross_table_unique"'
      USING ERRCODE = 'unique_violation',
            CONSTRAINT = 'share_token_cross_table_unique',
            DETAIL = 'Key (token) already exists in another share table.';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.share_token_cross_table_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS share_links_token_cross_table ON public.share_links;
CREATE TRIGGER share_links_token_cross_table
  BEFORE INSERT OR UPDATE OF token ON public.share_links
  FOR EACH ROW EXECUTE FUNCTION public.share_token_cross_table_guard();

DROP TRIGGER IF EXISTS project_shares_token_cross_table ON public.project_shares;
CREATE TRIGGER project_shares_token_cross_table
  BEFORE INSERT OR UPDATE OF token ON public.project_shares
  FOR EACH ROW EXECUTE FUNCTION public.share_token_cross_table_guard();

DROP TRIGGER IF EXISTS artist_portals_token_cross_table ON public.artist_portals;
CREATE TRIGGER artist_portals_token_cross_table
  BEFORE INSERT OR UPDATE OF token ON public.artist_portals
  FOR EACH ROW EXECUTE FUNCTION public.share_token_cross_table_guard();

NOTIFY pgrst, 'reload schema';
