import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { update } from '@/lib/db';
import { ProjectSharePatchBodySchema, type ProjectSharePatchBody } from '@/lib/contracts';
import { readBody } from '@/lib/validate';
import { writeWithPlayback } from '@/lib/share/playback';
import { resolveSalesRule } from '@/lib/links/share-link';
import { errorMessage } from '@/lib/errors';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

const SELECT =
  'id, project_id, token, role, allow_downloads, expires_at, invited_email, label, plays, revoked_at, created_at, recipient_kind, sales_enabled, password_hash';

/**
 * The patch a project share accepts, as a pure builder.
 *
 * `/api/shares/[shareId]` and `/api/projects/[id]/shares/[shareId]` both edit a
 * `project_shares` row and must not drift, so both call
 * `handleProjectSharePatch` below. Token / created_by / plays are never
 * client-controllable.
 */
export async function buildProjectSharePatch(
  body: ProjectSharePatchBody,
  currentKind: string | null | undefined,
  now: number = Date.now(),
): Promise<
  | { ok: true; patch: Record<string, unknown>; fullPlayback: boolean | undefined }
  | { ok: false; error: string }
> {
  const patch: Record<string, unknown> = {};
  if (typeof body.allow_downloads === 'boolean') patch.allow_downloads = body.allow_downloads;
  if (body.role) patch.role = body.role;
  if (typeof body.label === 'string') patch.label = body.label.trim() || null;
  if (typeof body.invited_email === 'string') patch.invited_email = body.invited_email.trim() || null;
  if (body.revoke === true) patch.revoked_at = new Date(now).toISOString();
  if (body.expires_days !== undefined) {
    patch.expires_at = body.expires_days > 0 ? new Date(now + body.expires_days * 86400000).toISOString() : null;
  }
  if (body.password === null) patch.password_hash = null;
  else if (typeof body.password === 'string') patch.password_hash = await bcrypt.hash(body.password, 10);

  const sales = resolveSalesRule(currentKind, body);
  if (!sales.ok) return sales;
  Object.assign(patch, sales.fields);

  // Mig 121: full track (true) or the 75 s preview (false). Goes through
  // writeWithPlayback so an unapplied migration refuses "preview" loudly.
  const fullPlayback = typeof body.full_playback === 'boolean' ? body.full_playback : undefined;
  if (Object.keys(patch).length === 0 && fullPlayback === undefined) {
    return { ok: false, error: 'No editable fields in body' };
  }
  return { ok: true, patch, fullPlayback };
}

/** Never returns the hash; says whether one is set. */
export function projectShareResponseRow(row: Record<string, unknown>, fullPlayback: boolean | undefined) {
  const { password_hash, ...rest } = row;
  return {
    ...rest,
    password_protected: Boolean(password_hash),
    ...(fullPlayback === undefined ? {} : { full_playback: fullPlayback }),
  };
}

type WriteResult = { data: Record<string, unknown> | null; error: { code?: string; message?: string } | null };

export type ProjectShareGate =
  | { ok: false; res: NextResponse }
  | { ok: true; admin: Admin | null };

/**
 * PATCH for one `project_shares` row. The caller supplies its own owner gate
 * (the two routes resolve ownership differently); `admin: null` means the
 * local-store fallback.
 */
export async function handleProjectSharePatch(
  req: NextRequest,
  shareId: string,
  gate: () => Promise<ProjectShareGate>,
): Promise<NextResponse> {
  const parsed = await readBody(req, ProjectSharePatchBodySchema);
  if (!parsed.ok) return parsed.res;
  try {
    const g = await gate();
    if (!g.ok) return g.res;

    let currentKind: string | null = null;
    if (g.admin) {
      const { data } = await g.admin.from('project_shares').select('recipient_kind').eq('id', shareId).maybeSingle();
      currentKind = (data as { recipient_kind?: string } | null)?.recipient_kind ?? null;
    }
    const built = await buildProjectSharePatch(parsed.data, currentKind);
    if (!built.ok) return NextResponse.json({ error: built.error }, { status: 400 });
    const { patch, fullPlayback } = built;

    if (!g.admin) {
      const updated = update('project_shares', shareId, fullPlayback === undefined ? patch : { ...patch, full_playback: fullPlayback });
      return NextResponse.json({ share: projectShareResponseRow(updated as Record<string, unknown>, undefined) });
    }
    const { data, error } = await writeWithPlayback(fullPlayback, (fields) =>
      (g.admin.from('project_shares').update({ ...patch, ...fields }).eq('id', shareId).select(SELECT).single()) as PromiseLike<WriteResult>,
    );
    if (error?.code === 'PLAYBACK_MIGRATION') {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error) throw error;
    return NextResponse.json({ share: projectShareResponseRow(data as Record<string, unknown>, fullPlayback) });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
