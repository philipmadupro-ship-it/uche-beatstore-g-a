-- 149_labelos_song_reviews.sql
-- Label OS (LABEL-25): per-reviewer ratings and verdicts on a song — the A&R
-- side of 04 W3 (17 R7: keyed by the song's track_id; distinct from
-- contact_track_states, which is the RECIPIENT's decision on a beat).
--
-- LABEL OS — NOT APPLIED. Apply at the final merge of the Label OS branch
-- into main, after 148. Never part of supabase/apply/pending.sql.
--
-- One new table, org-only (no user_id, the 139/142/143/144 rule):
--
--   song_reviews (track_id, reviewer_id) — one row per reviewer per song, so two
--   A&Rs never overwrite each other (upsert by that key). A rating 1–5 and a
--   verdict (shortlist | hold | pass | changes_requested), either may be
--   absent (a keystroke rating has no verdict yet), plus an optional note.
--   At least one of the three is set: an empty review is not a row.
--
-- Who reads (the security core; D5 + 06):
--
--   review.comment (implied by review.write, and implying catalog.read) AND
--     whole-org member (scope 'org', not a roster artist)  → every review of the org
--     else the song is in the member's scope → that is, in a project the
--       member's artist scope reaches (labelos_scoped_projects(), 147): an
--       artist's Inbox or a project linking them. A roster artist's scope is
--       their own contact, so THEY read every review of THEIR songs (D5);
--       another artist of the same label has a different scope and reads none.
--   An external project member (LABEL-21) is not an org member: the policy is
--   keyed on org membership only, so they read nothing.
--
--   No per-row SECURITY DEFINER call (R-08, measured in #76): the scope
--   disjunct is an uncorrelated subquery over labelos_scoped_tracks(), the
--   songs of the scoped projects, planned as a hashed subplan evaluated once
--   per statement. The capability is asked of the caller's own memberships
--   (`org_id IN (SELECT … FROM org_members WHERE has_org_cap(...))`), also an
--   uncorrelated hashed subplan: has_org_cap(org_id, …) on the ROW would be
--   correlated and run once per review (measured: 564 ms vs 13 ms for the
--   newest 100 of 6,000 reviews).
--
-- Writes: service role only. No INSERT/UPDATE/DELETE policy, and 141's
-- labelos_org_rows_service_only trigger refuses any write by the API roles.
-- A BEFORE trigger keeps a row inside its song's org and fixes its identity.
--
-- Idempotent: IF NOT EXISTS, CREATE OR REPLACE, DROP ... IF EXISTS first.

CREATE TABLE IF NOT EXISTS public.song_reviews (
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  track_id    uuid NOT NULL REFERENCES public.tracks(id) ON DELETE CASCADE,
  reviewer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating      smallint,
  verdict     text,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (track_id, reviewer_id),
  CONSTRAINT song_reviews_rating_check CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  CONSTRAINT song_reviews_verdict_check CHECK (verdict IS NULL OR verdict IN ('shortlist', 'hold', 'pass', 'changes_requested')),
  CONSTRAINT song_reviews_note_check CHECK (note IS NULL OR (length(note) BETWEEN 1 AND 2000)),
  CONSTRAINT song_reviews_not_empty CHECK (rating IS NOT NULL OR verdict IS NOT NULL OR note IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_song_reviews_org_updated ON public.song_reviews (org_id, updated_at DESC);

ALTER TABLE public.song_reviews ENABLE ROW LEVEL SECURITY;

-- ── Integrity ────────────────────────────────────────────────────────────
-- The song is a track of the row's own org (never a producer track, never
-- another org's), and a row's identity never changes: a reviewer's review is
-- rewritten in place, not re-pointed.

CREATE OR REPLACE FUNCTION public.song_reviews_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.org_id <> OLD.org_id OR NEW.track_id <> OLD.track_id OR NEW.reviewer_id <> OLD.reviewer_id) THEN
    RAISE EXCEPTION 'song_reviews: a review keeps its organization, song and reviewer'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.tracks t
    WHERE t.id = NEW.track_id AND t.org_id IS NOT NULL AND t.org_id = NEW.org_id AND t.type = 'song'
  ) THEN
    RAISE EXCEPTION 'song_reviews: the song must be a song of the same organization'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.song_reviews_integrity() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.song_reviews_integrity() FROM PUBLIC;

DROP TRIGGER IF EXISTS song_reviews_integrity ON public.song_reviews;
CREATE TRIGGER song_reviews_integrity BEFORE INSERT OR UPDATE ON public.song_reviews
  FOR EACH ROW EXECUTE FUNCTION public.song_reviews_integrity();

DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.song_reviews;
CREATE TRIGGER labelos_org_rows_service_only BEFORE INSERT OR UPDATE OR DELETE ON public.song_reviews
  FOR EACH ROW EXECUTE FUNCTION public.labelos_org_rows_service_only('self', 'org_id');

-- ── labelos_scoped_tracks ────────────────────────────────────────────────
-- The org tracks that sit in a project the caller's artist scope reaches
-- (labelos_scoped_projects, 147): can_see_org_track (141) for a member
-- limited to some artists, written as one set instead of a per-track test.
-- Empty for a whole-org member. Scope only; capabilities are has_org_cap's.
-- SECURITY DEFINER because project_tracks has no member policy. EXECUTE for
-- authenticated and anon, like labelos_scoped_projects: the policy runs as the
-- invoker for every role and anon must evaluate it to an empty result.

CREATE OR REPLACE FUNCTION public.labelos_scoped_tracks()
RETURNS TABLE (org_id uuid, track_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT sp.org_id, pt.track_id
  FROM public.labelos_scoped_projects() sp
  JOIN public.project_tracks pt ON pt.project_id = sp.project_id
  JOIN public.tracks t ON t.id = pt.track_id AND t.org_id = sp.org_id;
$$;

ALTER FUNCTION public.labelos_scoped_tracks() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_scoped_tracks() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.labelos_scoped_tracks() TO authenticated, anon;

-- ── The policy ───────────────────────────────────────────────────────────

DROP POLICY IF EXISTS song_reviews_member_read ON public.song_reviews;
CREATE POLICY song_reviews_member_read ON public.song_reviews
  FOR SELECT
  USING (
    -- review.comment (which review.write implies, and which implies catalog.read) in the
    -- row's org, asked of the caller's few memberships (not of every review row:
    -- has_org_cap(org_id, …) on the row would run once per row). Marketing, legal and
    -- engineers read the catalogue but hold no review ability, so they read no review:
    -- a rating of a working demo is not theirs, and the routes' D4 row rule is not the
    -- only line of defence against a member's own JWT on PostgREST.
    org_id IN (
      SELECT cm.org_id
      FROM public.org_members cm
      WHERE cm.user_id = (SELECT auth.uid())
        AND public.has_org_cap(cm.org_id, 'review.comment')
    )
    AND (
      org_id IN (
        SELECT om.org_id
        FROM public.org_members om
        WHERE om.user_id = (SELECT auth.uid())
          AND om.scope = 'org'
          AND om.role <> 'artist'
      )
      OR (org_id, track_id) IN (SELECT st.org_id, st.track_id FROM public.labelos_scoped_tracks() st)
    )
  );

NOTIFY pgrst, 'reload schema';
