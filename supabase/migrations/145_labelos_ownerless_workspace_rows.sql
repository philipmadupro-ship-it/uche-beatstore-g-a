-- 145_labelos_ownerless_workspace_rows.sql
-- Label OS (LABEL-17): org rows have NO owner on the rest of the #44 tables.
--
-- LABEL OS — NOT APPLIED. Apply at the final merge of the Label OS branch
-- into main, after 144 (docs/bstudio-label-os/16-execution-runbook.md).
--
-- The rule 139 set for contacts, 142 for projects / tracks / track_links,
-- 143 for project_assets and 144 started for project_contacts: an org row
-- carries no user_id, so no producer route — every one filters on user_id —
-- and no producer-era owner policy (user_id = auth.uid()) can ever reach it.
-- Carried from LABEL-14 (#70) and LABEL-16 (#72): before the org artist
-- workspace writes these tables, the database must refuse an OWNED org row
-- and keep producer rows owned.
--
-- Tables (each has a #44 same-owner trigger that 141 §4 gave an org path):
--   project_contacts      (122; user_id already nullable since 144)
--   contact_track_states  (123)
--   artist_portals        (125)
--   artist_messages       (130)
--   song_beats            (132)
-- track_links (142) and project_assets (143) already hold the rule.
-- project_comments is not one of them: its user_id is the commenter, a
-- nullable author column since 011, not an owner.
--
-- A CHECK cannot see the parent row, so the rule lives in each trigger:
--   org path   — every parent in one non-null org AND NEW.user_id IS NULL,
--                else "an org row has no owner";
--   owner path — unchanged (every parent owned by NEW.user_id, all producer
--                rows), which already refuses a producer row with no
--                user_id: NULL equals nothing.
-- The triggers fire on INSERT and on UPDATE OF user_id (and the parent
-- columns), as 122–132 declared them, so setting an owner on an org row
-- later is refused too.
--
-- Data: any org row written with an owner before this migration (only the
-- local check fixtures ever did; nothing is applied on production) is made
-- ownerless first, so the triggers' new rule describes every row.
--
-- Proven as anon / authenticated / service_role in
-- supabase/local/checks/145_labelos_ownerless_workspace_rows.sql.
--
-- Idempotent: CREATE OR REPLACE; the UPDATEs and DROP NOT NULL are no-ops
-- on a replay.

-- ── Nullable owners ─────────────────────────────────────────────────────

ALTER TABLE public.contact_track_states ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.artist_portals ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.artist_messages ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.song_beats ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.project_contacts ALTER COLUMN user_id DROP NOT NULL;

-- ── Triggers: the org path requires no owner ────────────────────────────

-- 122
CREATE OR REPLACE FUNCTION public.project_contacts_same_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.projects p
    JOIN public.contacts c ON c.id = NEW.contact_id AND c.org_id = p.org_id
    WHERE p.id = NEW.project_id AND p.org_id IS NOT NULL
  ) THEN
    IF NEW.user_id IS NOT NULL THEN
      RAISE EXCEPTION 'project_contacts: an org row has no owner (user_id must be NULL)';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = NEW.project_id AND p.user_id = NEW.user_id AND p.org_id IS NULL) THEN
    RAISE EXCEPTION 'project_contacts: project % is not owned by %', NEW.project_id, NEW.user_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = NEW.contact_id AND c.user_id = NEW.user_id AND c.org_id IS NULL) THEN
    RAISE EXCEPTION 'project_contacts: contact % is not owned by %', NEW.contact_id, NEW.user_id;
  END IF;
  RETURN NEW;
END $$;

-- 123
CREATE OR REPLACE FUNCTION public.contact_track_states_same_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.contacts c
    JOIN public.tracks t ON t.id = NEW.track_id AND t.org_id = c.org_id
    WHERE c.id = NEW.contact_id AND c.org_id IS NOT NULL
      AND (NEW.project_id IS NULL OR EXISTS (
        SELECT 1 FROM public.projects p WHERE p.id = NEW.project_id AND p.org_id = c.org_id
      ))
  ) THEN
    IF NEW.user_id IS NOT NULL THEN
      RAISE EXCEPTION 'contact_track_states: an org row has no owner (user_id must be NULL)';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = NEW.contact_id AND c.user_id = NEW.user_id AND c.org_id IS NULL) THEN
    RAISE EXCEPTION 'contact_track_states: contact % is not owned by %', NEW.contact_id, NEW.user_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tracks t WHERE t.id = NEW.track_id AND t.user_id = NEW.user_id AND t.org_id IS NULL) THEN
    RAISE EXCEPTION 'contact_track_states: track % is not owned by %', NEW.track_id, NEW.user_id;
  END IF;
  RETURN NEW;
END $$;

-- 125
CREATE OR REPLACE FUNCTION public.artist_portals_same_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = NEW.contact_id AND c.org_id IS NOT NULL) THEN
    IF NEW.user_id IS NOT NULL THEN
      RAISE EXCEPTION 'artist_portals: an org row has no owner (user_id must be NULL)';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = NEW.contact_id AND c.user_id = NEW.user_id AND c.org_id IS NULL) THEN
    RAISE EXCEPTION 'artist_portals: contact % is not owned by %', NEW.contact_id, NEW.user_id;
  END IF;
  RETURN NEW;
END $$;

-- 130
CREATE OR REPLACE FUNCTION public.artist_messages_same_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.contacts c
    WHERE c.id = NEW.contact_id AND c.org_id IS NOT NULL
      AND (NEW.project_id IS NULL OR EXISTS (
        SELECT 1 FROM public.projects p WHERE p.id = NEW.project_id AND p.org_id = c.org_id
      ))
  ) THEN
    IF NEW.user_id IS NOT NULL THEN
      RAISE EXCEPTION 'artist_messages: an org row has no owner (user_id must be NULL)';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = NEW.contact_id AND c.user_id = NEW.user_id AND c.org_id IS NULL) THEN
    RAISE EXCEPTION 'artist_messages: contact % is not owned by %', NEW.contact_id, NEW.user_id;
  END IF;
  IF NEW.project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.projects p WHERE p.id = NEW.project_id AND p.user_id = NEW.user_id AND p.org_id IS NULL
  ) THEN
    RAISE EXCEPTION 'artist_messages: project % is not owned by %', NEW.project_id, NEW.user_id;
  END IF;
  RETURN NEW;
END $$;

-- 132
CREATE OR REPLACE FUNCTION public.song_beats_same_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.tracks s
    JOIN public.tracks b ON b.id = NEW.beat_track_id AND b.org_id = s.org_id
    WHERE s.id = NEW.song_track_id AND s.org_id IS NOT NULL
  ) THEN
    IF NEW.user_id IS NOT NULL THEN
      RAISE EXCEPTION 'song_beats: an org row has no owner (user_id must be NULL)';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tracks t WHERE t.id = NEW.song_track_id AND t.user_id = NEW.user_id AND t.org_id IS NULL) THEN
    RAISE EXCEPTION 'song_beats: song % is not owned by %', NEW.song_track_id, NEW.user_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tracks t WHERE t.id = NEW.beat_track_id AND t.user_id = NEW.user_id AND t.org_id IS NULL) THEN
    RAISE EXCEPTION 'song_beats: beat % is not owned by %', NEW.beat_track_id, NEW.user_id;
  END IF;
  RETURN NEW;
END $$;

-- ── Data: owned org rows become ownerless ───────────────────────────────
-- Each UPDATE sets user_id on rows the org path accepts, so the new
-- triggers pass them.

UPDATE public.project_contacts pc SET user_id = NULL
  FROM public.projects p
 WHERE p.id = pc.project_id AND p.org_id IS NOT NULL AND pc.user_id IS NOT NULL;
UPDATE public.contact_track_states s SET user_id = NULL
  FROM public.contacts c
 WHERE c.id = s.contact_id AND c.org_id IS NOT NULL AND s.user_id IS NOT NULL;
UPDATE public.artist_portals ap SET user_id = NULL
  FROM public.contacts c
 WHERE c.id = ap.contact_id AND c.org_id IS NOT NULL AND ap.user_id IS NOT NULL;
UPDATE public.artist_messages m SET user_id = NULL
  FROM public.contacts c
 WHERE c.id = m.contact_id AND c.org_id IS NOT NULL AND m.user_id IS NOT NULL;
UPDATE public.song_beats sb SET user_id = NULL
  FROM public.tracks s
 WHERE s.id = sb.song_track_id AND s.org_id IS NOT NULL AND sb.user_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
