-- 130_artist_messages.sql
-- Artist Relationship Workspace, phase 3: messages and requests.
--
-- Portal comments (mig 128) hang off a project or a beat. What was missing is
-- the plain conversation between the producer and one artist — "are you in
-- town next week?" — and a way for the artist to ASK for something ("send me
-- something darker"). Both are rows here, one thread per contact:
--
--   author        who wrote it: the producer (dashboard) or the artist (portal).
--   kind          'message', or 'request' — only an artist writes a request.
--   request_status open → done / declined, set by the producer. NULL for a
--                 message; the check below keeps the two in step.
--   project_id    optional: the project a request is about.
--   read_at       when the OTHER side saw it (portal load for a producer
--                 message, the workspace thread for an artist message).
--   emailed_at    when a producer message was also emailed to the artist
--                 (lib/artist-messages/email-fallback decides).

CREATE TABLE IF NOT EXISTS public.artist_messages (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id     uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  project_id     uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  author         text NOT NULL,
  kind           text NOT NULL DEFAULT 'message',
  body           text NOT NULL,
  request_status text,
  resolved_at    timestamptz,
  read_at        timestamptz,
  emailed_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'artist_messages_author_check') THEN
    ALTER TABLE public.artist_messages ADD CONSTRAINT artist_messages_author_check
      CHECK (author IN ('producer', 'artist'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'artist_messages_kind_check') THEN
    ALTER TABLE public.artist_messages ADD CONSTRAINT artist_messages_kind_check
      CHECK (kind IN ('message', 'request'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'artist_messages_request_check') THEN
    ALTER TABLE public.artist_messages ADD CONSTRAINT artist_messages_request_check
      CHECK (
        (kind = 'message' AND request_status IS NULL)
        OR (kind = 'request' AND author = 'artist' AND request_status IN ('open', 'done', 'declined'))
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'artist_messages_body_check') THEN
    ALTER TABLE public.artist_messages ADD CONSTRAINT artist_messages_body_check
      CHECK (char_length(btrim(body)) BETWEEN 1 AND 4000);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_artist_messages_contact ON public.artist_messages (contact_id, created_at);
CREATE INDEX IF NOT EXISTS idx_artist_messages_user ON public.artist_messages (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_artist_messages_open_requests
  ON public.artist_messages (user_id, contact_id) WHERE kind = 'request' AND request_status = 'open';

-- The contact (and the project, when set) must belong to the row's owner.
CREATE OR REPLACE FUNCTION public.artist_messages_same_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = NEW.contact_id AND c.user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'artist_messages: contact % is not owned by %', NEW.contact_id, NEW.user_id;
  END IF;
  IF NEW.project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.projects p WHERE p.id = NEW.project_id AND p.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'artist_messages: project % is not owned by %', NEW.project_id, NEW.user_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS artist_messages_same_owner ON public.artist_messages;
CREATE TRIGGER artist_messages_same_owner
  BEFORE INSERT OR UPDATE OF user_id, contact_id, project_id ON public.artist_messages
  FOR EACH ROW EXECUTE FUNCTION public.artist_messages_same_owner();

-- Owner-only. The portal reads and writes through the service role after the
-- token gate.
ALTER TABLE public.artist_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS artist_messages_owner_select ON public.artist_messages;
CREATE POLICY artist_messages_owner_select ON public.artist_messages
  FOR SELECT USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS artist_messages_owner_write ON public.artist_messages;
CREATE POLICY artist_messages_owner_write ON public.artist_messages
  FOR ALL USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id AND (SELECT public.is_producer()));

NOTIFY pgrst, 'reload schema';
