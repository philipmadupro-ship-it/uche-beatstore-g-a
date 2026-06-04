-- 095_contact_tasks.sql
-- Follow-up tasks / reminders per contact — "follow up with X on June 10".
-- The piece that turns the CRM from a record into a workflow: the producer
-- can schedule the next touch and see what's due today across the pipeline.
--
-- done_at null = open; set = completed. due_at null = someday/no date.
-- Owner RLS with (SELECT auth.uid()) per Supabase perf guidance (mig 093).

CREATE TABLE IF NOT EXISTS public.contact_tasks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id  uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title       text NOT NULL,
  due_at      timestamptz,
  done_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Per-contact task list.
CREATE INDEX IF NOT EXISTS idx_contact_tasks_contact
  ON public.contact_tasks (contact_id, done_at, due_at);

-- "What's due" feed: open tasks for an owner, soonest first. Partial index on
-- open tasks keeps the due-today query tiny even with lots of done history.
CREATE INDEX IF NOT EXISTS idx_contact_tasks_due
  ON public.contact_tasks (user_id, due_at)
  WHERE done_at IS NULL;

ALTER TABLE public.contact_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contact_tasks_owner ON public.contact_tasks;
CREATE POLICY contact_tasks_owner ON public.contact_tasks
  FOR ALL
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

NOTIFY pgrst, 'reload schema';
