import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, update } from '@/lib/local-store';
import { requireRowOwnership } from '@/lib/auth/ownership';
import { errorMessage } from '@/lib/errors';

export const runtime = 'nodejs';

/**
 * DELETE /api/projects/[id]/comments/[commentId]
 *
 * Soft-deletes a comment on the owner's project. We use a soft delete so
 * the audit trail survives — the row remains, `deleted_at` is stamped,
 * and the comment is filtered out of both the owner panel and the public
 * reader. Authored content (especially guest comments from share links)
 * is the kind of thing you might want to recover later if a recipient
 * complains they were misquoted.
 *
 * Ownership flows through the parent project, not the comment row itself
 * — guests aren't tracked as users, so we can't gate on "did the caller
 * author this comment." The project owner is the authoritative moderator.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; commentId: string }> },
) {
  const { id, commentId } = await params;
  try {
    if (isSupabaseConfigured()) {
      const owner = await requireRowOwnership('projects', id);
      if (!owner.ok) return owner.res;

      // Verify the comment actually belongs to this project before deleting,
      // so a forged commentId can't piggyback on the owner's project access
      // to nuke unrelated rows.
      const { data: comment, error: cErr } = await owner.admin
        .from('project_comments')
        .select('id, project_id, deleted_at')
        .eq('id', commentId)
        .maybeSingle();
      if (cErr) throw cErr;
      if (!comment) return NextResponse.json({ error: 'Comment not found' }, { status: 404 });
      if (comment.project_id !== id) {
        return NextResponse.json({ error: 'Comment does not belong to this project' }, { status: 400 });
      }

      const { error } = await owner.admin
        .from('project_comments')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', commentId);
      if (error) throw error;
      return NextResponse.json({ success: true });
    }

    update('project_comments', commentId, { deleted_at: new Date().toISOString() });
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
