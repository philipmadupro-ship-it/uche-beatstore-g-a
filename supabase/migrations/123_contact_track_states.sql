-- 123_contact_track_states.sql
-- Artist Relationship Workspace, phase 1: one artist's decision on one beat.
--
-- Beat status used to belong to a SEND (beat_sends.status), so "interested in
-- MIDNIGHT, passed on the other 7" could not be recorded: one send carries
-- every track it contained. The decision now lives on the artist-and-beat pair.
--
-- Two axes, deliberately:
--   decision   — STORED here, set by either side:
--                interested → selected → recording → recorded → released · passed
--   engagement — never stored; derived from sends, opens, plays and downloads
--                (lib/contacts/track-engagement.ts).
-- NULL decision = no decision yet.
--
-- beat_sends.status is frozen after the one-time copy below and stays as a
-- record of the past.

CREATE TABLE IF NOT EXISTS public.contact_track_states (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id  uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  track_id    uuid NOT NULL REFERENCES public.tracks(id) ON DELETE CASCADE,
  project_id  uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  decision    text,
  set_by      text NOT NULL DEFAULT 'producer',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contact_track_states_contact_track_key UNIQUE (contact_id, track_id)
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contact_track_states_decision_check') THEN
    ALTER TABLE public.contact_track_states ADD CONSTRAINT contact_track_states_decision_check
      CHECK (decision IS NULL OR decision IN ('interested', 'selected', 'recording', 'recorded', 'released', 'passed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contact_track_states_set_by_check') THEN
    ALTER TABLE public.contact_track_states ADD CONSTRAINT contact_track_states_set_by_check
      CHECK (set_by IN ('producer', 'artist'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_contact_track_states_track ON public.contact_track_states (track_id);
CREATE INDEX IF NOT EXISTS idx_contact_track_states_user ON public.contact_track_states (user_id);
CREATE INDEX IF NOT EXISTS idx_contact_track_states_project ON public.contact_track_states (project_id);

-- Same-owner guard, as on project_contacts: contact and track must belong to
-- the row's owner.
CREATE OR REPLACE FUNCTION public.contact_track_states_same_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = NEW.contact_id AND c.user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'contact_track_states: contact % is not owned by %', NEW.contact_id, NEW.user_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tracks t WHERE t.id = NEW.track_id AND t.user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'contact_track_states: track % is not owned by %', NEW.track_id, NEW.user_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS contact_track_states_same_owner ON public.contact_track_states;
CREATE TRIGGER contact_track_states_same_owner
  BEFORE INSERT OR UPDATE OF user_id, contact_id, track_id ON public.contact_track_states
  FOR EACH ROW EXECUTE FUNCTION public.contact_track_states_same_owner();

ALTER TABLE public.contact_track_states ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contact_track_states_owner_select ON public.contact_track_states;
CREATE POLICY contact_track_states_owner_select ON public.contact_track_states
  FOR SELECT USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS contact_track_states_owner_write ON public.contact_track_states;
CREATE POLICY contact_track_states_owner_write ON public.contact_track_states
  FOR ALL USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id AND (SELECT public.is_producer()));

-- One-time copy of the old per-send statuses onto the pair, newest send wins:
--   interested → interested · negotiating → selected · placed → released · pass → passed
-- sent / opened are engagement, not decisions, and are not copied.
-- ON CONFLICT DO NOTHING keeps this idempotent AND means a re-run never
-- overwrites a decision made after the first run.
INSERT INTO public.contact_track_states (user_id, contact_id, track_id, decision, set_by, created_at, updated_at)
SELECT DISTINCT ON (bs.contact_id, t.id)
  c.user_id,
  bs.contact_id,
  t.id,
  CASE bs.status
    WHEN 'interested'  THEN 'interested'
    WHEN 'negotiating' THEN 'selected'
    WHEN 'placed'      THEN 'released'
    WHEN 'pass'        THEN 'passed'
  END,
  'producer',
  bs.sent_at,
  bs.sent_at
FROM public.beat_sends bs
JOIN public.contacts c ON c.id = bs.contact_id AND c.user_id IS NOT NULL
CROSS JOIN LATERAL unnest(bs.track_ids) AS tid(track_id)
JOIN public.tracks t ON t.id::text = tid.track_id::text AND t.user_id = c.user_id
WHERE bs.status IN ('interested', 'negotiating', 'placed', 'pass')
ORDER BY bs.contact_id, t.id, bs.sent_at DESC
ON CONFLICT (contact_id, track_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
