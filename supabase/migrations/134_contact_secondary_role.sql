-- 134_contact_secondary_role.sql
-- Contact roles: one main role (the existing `category`) plus one extra.
--
-- /contacts has a tab per role — Artists, Producers, Labels & A&R, Other —
-- and someone who raps and produces belongs in two of them. The main role
-- stays `category`; `secondary_category` is the one extra (lib/contacts/roles).
-- Free text like `category`, validated in the app; NULL = no extra role.

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS secondary_category text;

CREATE INDEX IF NOT EXISTS contacts_secondary_category_idx
  ON public.contacts (secondary_category) WHERE secondary_category IS NOT NULL;

NOTIFY pgrst, 'reload schema';
