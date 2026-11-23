/**
 * Resolve the link a beat-send email carries.
 *
 * `beat_sends.share_token` holds one of two kinds of token, and they open on
 * different pages:
 *
 *   share_links.token     → /share/<token>           (track sends, SendBeatModal)
 *   project_shares.token  → /projects/share/<token>  (project sends, via the
 *                                                     campaign targets route)
 *
 * The follow-up nudge re-sends whatever token the last send had, so it must
 * be resolved here, not assumed to be a track share. Assuming that sent every
 * nudged project recipient a `/share/<token>` link that page cannot open.
 *
 * The permissions row (expiry, downloads) comes from the row, never from the
 * request. Ownership is enforced on the service client the caller passes in,
 * after it has run requireProducer: `share_links` by `user_id`, a project
 * share through its project's `user_id` (project_shares has no owner column).
 */
import type { createServiceClient } from '@/lib/auth/ownership';
import { shareLifecycleFailure, type ShareLifecycle } from '@/lib/share/token-access';
import { isFullPlayback } from '@/lib/share/playback';
import { sharePathFor, type BeatSendRole } from '@/lib/email/beat-send-input';

type Admin = ReturnType<typeof createServiceClient>;

interface EmailShareRow extends ShareLifecycle {
  allow_downloads?: boolean | null;
  project_id?: string | null;
  full_playback?: boolean | null;
  role?: string | null;
}

export type EmailShareResolution =
  | {
      ok: true;
      kind: 'tracks' | 'project';
      /** Path on the app origin, e.g. `/projects/share/abc`. */
      path: string;
      expiresAt: string | null;
      allowDownloads: boolean;
      /** Full track (true) or the 75 s preview; a missing column reads as full. */
      fullPlayback: boolean;
      /** Project shares only. */
      role: BeatSendRole | null;
      /** The project a project share opens. */
      projectId: string | null;
    }
  | { ok: false; status: 404 | 409; error: string };

function live(row: EmailShareRow, kind: 'tracks' | 'project', path: string): EmailShareResolution {
  const dead = shareLifecycleFailure(row);
  if (dead) {
    // Emailing a link the recipient cannot open is worse than not sending.
    return { ok: false, status: 409, error: `${dead.error} Create a new link to send.` };
  }
  return {
    ok: true,
    kind,
    path,
    expiresAt: row.expires_at ?? null,
    allowDownloads: row.allow_downloads !== false,
    fullPlayback: isFullPlayback(row),
    role: row.role === 'commenter' || row.role === 'editor' || row.role === 'viewer' ? row.role : null,
    projectId: row.project_id ?? null,
  };
}

export async function resolveEmailShare(
  admin: Admin,
  ownerId: string,
  token: string,
): Promise<EmailShareResolution> {
  const { data: trackShare, error: trackErr } = await admin
    .from('share_links')
    .select('*')
    .eq('token', token)
    .eq('user_id', ownerId)
    .maybeSingle();
  if (trackErr) throw trackErr;
  if (trackShare) return live(trackShare as EmailShareRow, 'tracks', sharePathFor('tracks', token));

  const { data: projectShare, error: projectErr } = await admin
    .from('project_shares')
    .select('*')
    .eq('token', token)
    .maybeSingle();
  if (projectErr) throw projectErr;
  const projectId = (projectShare as EmailShareRow | null)?.project_id;
  if (projectShare && projectId) {
    const { data: project, error: ownErr } = await admin
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('user_id', ownerId)
      .maybeSingle();
    if (ownErr) throw ownErr;
    if (project) return live(projectShare as EmailShareRow, 'project', sharePathFor('project', token));
  }

  // Unknown, or owned by someone else: the same answer either way, so the
  // route does not confirm another producer's token exists.
  return { ok: false, status: 404, error: 'Share link not found' };
}
