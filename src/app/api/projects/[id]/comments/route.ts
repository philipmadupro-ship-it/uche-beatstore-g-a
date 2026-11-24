import { NextRequest, NextResponse } from 'next/server';
import {
  isSupabaseConfigured,
  getAll,
  insert,
  requireRowOwnership,
} from '@/lib/db';
import { readBody } from '@/lib/validate';
import { ProjectCommentCreateBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { isMissingSchema } from '@/lib/artists/workspace-load';
import { contactRefOf, type ContactRef } from '@/lib/share/collaborator';
import { createLogger } from '@/lib/log';

const log = createLogger('api.projects.comments');

export const runtime = 'nodejs';

/**
 * Owner-side comments API for a project.
 *
 *   GET  → all comments on this project (excluding soft-deleted)
 *   POST → owner reply, stamped with their real user_id
 *
 * The PUBLIC reader/composer lives at /api/projects/share/[token]/comments
 * and authenticates anonymous guests via a share token. This endpoint
 * authenticates via project ownership.
 */

interface CommentRow {
  id: string;
  project_id: string;
  track_id: string | null;
  user_id: string | null;
  share_token: string | null;
  author_name: string;
  body: string;
  parent_id: string | null;
  region_start: number | null;
  region_end: number | null;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
}

const REGION_SELECT = 'id, project_id, track_id, user_id, share_token, author_name, body, parent_id, region_start, region_end, edited_at, deleted_at, created_at';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    if (isSupabaseConfigured()) {
      const owner = await requireRowOwnership('projects', id);
      if (!owner.ok) return owner.res;

      const read = (select: string) => owner.admin
        .from('project_comments')
        .select(select)
        .eq('project_id', id)
        .is('deleted_at', null)
        .order('created_at', { ascending: true });
      // `share_contact_id` (mig 204) names the contact a share link was issued
      // to. Producer-only: this route is owner-gated and the public share JSON
      // never carries it. Before 204 the read steps down to the old columns.
      let { data, error } = await read(`${REGION_SELECT}, share_contact_id`);
      if (error && isMissingSchema(error)) ({ data, error } = await read(REGION_SELECT));
      if (error) throw error;
      const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
      const contactIds = [...new Set(rows.map((r) => r.share_contact_id).filter((v): v is string => typeof v === 'string'))];
      const refs = new Map<string, ContactRef>();
      if (contactIds.length > 0) {
        const { data: contacts } = await owner.admin
          .from('contacts')
          .select('id, name')
          .eq('user_id', owner.userId)
          .in('id', contactIds);
        for (const c of contacts ?? []) {
          const ref = contactRefOf(c);
          if (ref) refs.set(ref.id, ref);
        }
      }
      return NextResponse.json({
        comments: rows.map(({ share_contact_id, ...rest }) => ({
          ...rest,
          share_contact: typeof share_contact_id === 'string' ? refs.get(share_contact_id) ?? null : null,
        })),
      });
    }

    const comments = (getAll('project_comments') as unknown as CommentRow[])
      .filter((c) => c.project_id === id && !c.deleted_at)
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    return NextResponse.json({ comments });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await readBody(req, ProjectCommentCreateBodySchema);
  if (!parsed.ok) return parsed.res;
  const { body, track_id, parent_id, author_name, region_start, region_end } = parsed.data;
  const text = body.trim();
  const trackId = track_id ?? null;
  const parentId = parent_id ?? null;
  const overrideName = author_name?.trim() ?? '';

  // Normalize region: both-or-neither. If only one was sent (partial UI
  // state), drop both — better than failing the CHECK constraint.
  const hasBothBounds = typeof region_start === 'number' && typeof region_end === 'number' && region_end > region_start;
  const regionStart = hasBothBounds ? region_start : null;
  const regionEnd = hasBothBounds ? region_end : null;

  try {
    if (isSupabaseConfigured()) {
      const owner = await requireRowOwnership('projects', id);
      if (!owner.ok) return owner.res;

      // Resolve the owner's display name. Use the body override if given;
      // otherwise email-local-part; otherwise "Owner".
      const { data: userRow } = await owner.admin.auth.admin.getUserById(owner.userId);
      const fallbackName = overrideName
        || (userRow?.user?.email ? userRow.user.email.split('@')[0] : null)
        || 'Owner';

      // A reply in an artist's portal thread stays in that thread (mig 128),
      // so the artist sees the answer in their portal. Before 128 the column
      // is missing and the reply is an ordinary project comment.
      let contactId: string | null = null;
      if (parentId) {
        const { data: parent, error: parentErr } = await owner.admin
          .from('project_comments')
          .select('contact_id')
          .eq('id', parentId)
          .eq('project_id', id)
          .maybeSingle();
        if (!parentErr) contactId = (parent as { contact_id?: string | null } | null)?.contact_id ?? null;
      }

      const { data, error } = await owner.admin
        .from('project_comments')
        .insert({
          project_id: id,
          track_id: trackId,
          user_id: owner.userId,
          share_token: null,
          author_name: fallbackName,
          body: text,
          parent_id: parentId,
          region_start: regionStart,
          region_end: regionEnd,
          ...(contactId ? { contact_id: contactId } : {}),
        })
        .select()
        .single();
      if (error) throw error;
      return NextResponse.json({ comment: data });
    }

    const row = insert('project_comments', {
      project_id: id,
      track_id: trackId,
      user_id: 'local-user',
      share_token: null,
      author_name: overrideName || 'Owner',
      body: text,
      parent_id: parentId,
      region_start: regionStart,
      region_end: regionEnd,
      edited_at: null,
      deleted_at: null,
    });
    return NextResponse.json({ comment: row });
  } catch (error) {
    log.error('post failed', { projectId: id, error: errorMessage(error) });
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
