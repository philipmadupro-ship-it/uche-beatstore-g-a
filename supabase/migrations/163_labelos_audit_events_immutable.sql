-- 163_labelos_audit_events_immutable.sql
-- Label OS (LABEL-43, review G1 F6): "an audit event is never changed or
-- deleted" becomes a database fact, for every role — the service role too.
--
-- LABEL OS — NOT APPLIED. Apply at the final merge of the Label OS branch
-- into main, after 136 (and 146). Never part of supabase/apply/pending.sql.
--
-- 136 made activity_events append-only for the API roles (no UPDATE/DELETE
-- policy or grant). The service role bypasses both, so until now only code
-- review kept a route from rewriting or deleting an audit row. This trigger
-- refuses, for an `audit = true` row:
--
--   · every UPDATE, except the one Postgres itself makes when an account is
--     deleted: `actor_id … REFERENCES auth.users ON DELETE SET NULL`. That
--     update changes `actor_id` to NULL and nothing else, and the user row is
--     already gone. Refusing it would make every account with an audit event
--     impossible to delete (erasure), so it is let through — the event stays,
--     without the person;
--   · every DELETE, except the cascade from deleting the organization: the
--     LABEL-39 purge (`purge-deleted-orgs`) deletes the one `organizations`
--     row and its whole history goes with it (D10). By the time the cascade
--     reaches an event, its organization row is gone, which a direct DELETE
--     can never see (the FK holds while the org exists) — the test 136's
--     `org_members_keep_an_owner` uses for the same cascade.
--
-- An everyday row may not be turned into an audit one (that would forge an
-- immutable, back-dated record); otherwise everyday (`audit = false`) rows
-- are untouched, so `prune-org-events`
-- (which deletes only `audit = false` rows older than 24 months, D9) keeps
-- working. Nothing in the app updates an event; the only app delete is that
-- prune, and no erasure flow anonymises events (checked for LABEL-43).
--
-- Nothing reads a role, a GUC or a session setting, so nothing short of
-- dropping the trigger (a migration) turns it off. TRUNCATE is not covered
-- (no route can issue it; see the LABEL-43 PR, "Found, not fixed").
--
-- Idempotent: CREATE OR REPLACE, DROP TRIGGER IF EXISTS first.

CREATE OR REPLACE FUNCTION public.activity_events_audit_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT OLD.audit THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    -- An event is audit-class from its INSERT on; promoting an everyday row
    -- would forge (and back-date) an audit record that could then never change.
    IF NEW.audit THEN
      RAISE EXCEPTION 'activity_events: an everyday event never becomes an audit event (event %)', OLD.id
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = OLD.org_id) THEN
      RETURN OLD; -- the organization is being purged
    END IF;
    RAISE EXCEPTION 'activity_events: an audit event is never deleted (event %)', OLD.id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF OLD.actor_id IS NOT NULL
     AND NEW.actor_id IS NULL
     AND (to_jsonb(NEW) - 'actor_id') = (to_jsonb(OLD) - 'actor_id')
     AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = OLD.actor_id) THEN
    RETURN NEW; -- the actor's account was deleted
  END IF;
  RAISE EXCEPTION 'activity_events: an audit event is never changed (event %)', OLD.id
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

ALTER FUNCTION public.activity_events_audit_immutable() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.activity_events_audit_immutable() FROM PUBLIC;

DROP TRIGGER IF EXISTS activity_events_audit_immutable ON public.activity_events;
CREATE TRIGGER activity_events_audit_immutable
  BEFORE UPDATE OR DELETE ON public.activity_events
  FOR EACH ROW EXECUTE FUNCTION public.activity_events_audit_immutable();

NOTIFY pgrst, 'reload schema';
