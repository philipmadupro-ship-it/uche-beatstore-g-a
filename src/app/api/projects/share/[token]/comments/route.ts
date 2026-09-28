import { NextRequest, NextResponse } from 'next/server';
import {
  isWellFormedShareToken,
  resolveShareToken,
  shareAccessFailure,
  shareGateResponse,
  shareNotFoundResponse,
  sharePasswordFrom,
} from '@/lib/share/token-access';
import { isSupabaseConfigured, getAll, insert } from '@/lib/local-store';
import { createServiceClient } from '@/lib/auth/ownership';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { rateLimitDurable, clientIp } from '@/lib/security/rate-limit';
const log = createLogger('api.projects.share.token.comments');

export const runtime = 'nodejs';

interface LocalProjectShareRow {
  token: string;
  project_id: string;
}

interface LocalProjectCommentRow {
  project_id: string;
  deleted_at?: string | null;
  created_at?: string | null;
}

/**
 * Project comments — guest authoring via a share link.
 *
 *   GET  /api/projects/share/[token]/comments  → list (anyone with the token)
 *   POST /api/projects/share/[token]/comments  → create (requires commenter|editor role)
 *
 * The token's `role` is the gate, not the caller's auth status — that's
 * what makes "share with someone via email and let them leave feedback
 * without making an account" work. Authenticated owners can still write
 * via the normal project-comments endpoint (TODO when we expose it).
 */

async function resolveShare(token: string, password: string) {
  const admin = createServiceClient();
  const resolved = await resolveShareToken(admin, token, ['project_share']);
  if (resolved?.kind !== 'project_share') return { ok: false as const, response: shareNotFoundResponse() };
  const share = resolved.row;
  const failure = await shareAccessFailure(share, { password });
  if (failure) return { ok: false as const, response: shareGateResponse(failure) };
  return { ok: true as const, share, admin };
}

function localShare(token: string): LocalProjectShareRow | undefined {
  if (!isWellFormedShareToken(token)) return undefined;
  return getAll<LocalProjectShareRow>('project_shares').find((s) => s.token === token);
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const password = sharePasswordFrom(req);
  try {
    if (!isSupabaseConfigured()) {
      const share = localShare(token);
      if (!share) return shareNotFoundResponse();
      const comments = getAll<LocalProjectCommentRow>('project_comments')
        .filter((c) => c.project_id === share.project_id && !c.deleted_at)
        .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
      return NextResponse.json({ comments });
    }

    const gate = await resolveShare(token, password);
    if (!gate.ok) return gate.response;

    const { data, error } = await gate.admin
      .from('project_comments')
      .select('id, project_id, track_id, user_id, share_token, author_name, body, parent_id, region_start, region_end, edited_at, deleted_at, created_at')
      .eq('project_id', gate.share.project_id)
      .is('deleted_at', null)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return NextResponse.json({ comments: data ?? [] });
  } catch (error: unknown) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const password = sharePasswordFrom(req);
  // Public (token-gated) comment endpoint — throttle per IP to blunt spam.
  if (!await rateLimitDurable(`sharecomment:${clientIp(req)}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }
  try {
    const body = await req.json().catch(() => ({}));
    const authorName = typeof body.author_name === 'string' ? body.author_name.trim() : '';
    const text = typeof body.body === 'string' ? body.body.trim() : '';
    const trackId = typeof body.track_id === 'string' ? body.track_id : null;
    const parentId = typeof body.parent_id === 'string' ? body.parent_id : null;
    const rawStart = typeof body.region_start === 'number' ? body.region_start : null;
    const rawEnd   = typeof body.region_end   === 'number' ? body.region_end   : null;
    // Both-or-neither — same invariant the DB CHECK enforces.
    const regionStart = rawStart != null && rawEnd != null && rawEnd > rawStart ? rawStart : null;
    const regionEnd   = regionStart != null ? rawEnd : null;

    if (!authorName) return NextResponse.json({ error: 'Name required' }, { status: 400 });
    if (!text) return NextResponse.json({ error: 'Comment cannot be empty' }, { status: 400 });
    if (text.length > 5000) return NextResponse.json({ error: 'Comment too long' }, { status: 400 });

    if (!isSupabaseConfigured()) {
      const share = localShare(token);
      if (!share) return shareNotFoundResponse();
      const row = insert('project_comments', {
        project_id: share.project_id,
        track_id: trackId,
        user_id: null,
        share_token: token,
        author_name: authorName,
        body: text,
        parent_id: parentId,
        region_start: regionStart,
        region_end: regionEnd,
        edited_at: null,
        deleted_at: null,
      });
      return NextResponse.json({ comment: row });
    }

    const gate = await resolveShare(token, password);
    if (!gate.ok) return gate.response;

    // Role gate: viewer is read-only.
    if (gate.share.role === 'viewer') {
      return NextResponse.json(
        { error: 'This share link is view-only — the sender did not grant comment access.' },
        { status: 403 },
      );
    }

    const { data, error } = await gate.admin
      .from('project_comments')
      .insert({
        project_id: gate.share.project_id,
        track_id: trackId,
        user_id: null,
        share_token: token,
        author_name: authorName,
        body: text,
        parent_id: parentId,
        region_start: regionStart,
        region_end: regionEnd,
      })
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json({ comment: data });
  } catch (error: unknown) {
    log.error('Project comment error:', { error: errorMessage(error) });
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
