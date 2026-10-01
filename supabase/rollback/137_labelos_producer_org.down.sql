-- Rollback for 137_labelos_producer_org.sql (LABEL-07).
--
-- Lives outside supabase/migrations/ on purpose: scripts/apply-migrations.sh
-- applies every *.sql in that folder. Run by hand only.
--
-- Backlog rule: delete the org rows where kind = 'producer' and no other
-- members exist. Deleting an organization cascades to its org_members,
-- org_invitations and activity_events rows (136's FKs), and 136's "≥1 owner"
-- trigger skips an org that is itself gone. A producer org that has gained a
-- second member is kept: removing it would take someone else's access with
-- it. Then the two functions 137 added are dropped.

DELETE FROM public.organizations o
WHERE o.kind = 'producer'
  AND (SELECT count(*) FROM public.org_members om WHERE om.org_id = o.id) <= 1;

DROP FUNCTION IF EXISTS public.labelos_ensure_producer_org(uuid);
DROP FUNCTION IF EXISTS public.labelos_slugify(text);

NOTIFY pgrst, 'reload schema';
