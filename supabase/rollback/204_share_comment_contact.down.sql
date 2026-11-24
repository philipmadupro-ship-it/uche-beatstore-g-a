-- Rollback for 204_share_comment_contact.sql (SHARE-07). Run by hand only.
-- Share comments keep their typed author_name; the producer's "Name (Contact)"
-- attribution disappears and the routes fall back to the old insert.
DROP TRIGGER IF EXISTS project_comments_share_contact_same_owner ON public.project_comments;
DROP FUNCTION IF EXISTS public.project_comments_share_contact_same_owner();
DROP INDEX IF EXISTS public.idx_project_comments_share_contact;
ALTER TABLE public.project_comments DROP COLUMN IF EXISTS share_contact_id;
NOTIFY pgrst, 'reload schema';
