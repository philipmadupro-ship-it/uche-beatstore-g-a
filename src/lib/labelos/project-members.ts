/**
 * External project members (LABEL-21, 06 §2.6, 04 W4): the rules, pure.
 * Routes and pages load and write; this module decides.
 *
 * An external member is a person with their own account admitted to ONE org
 * project — viewer, commenter, contributor or editor — without becoming an
 * org member. Their reach is the project's songs and recordings and nothing
 * else: no artist workspace, no org screens, no other project (the routes
 * answer 403/404 to everything not named in `EXTERNAL_ROUTES`). What each
 * role may DO is `externalCan` (lib/labelos/capabilities), cell for cell the
 * §2.6 table; this module only asks it the right question for each request.
 *
 * Decisions held here (each with a test):
 *  - A membership is live until `expires_at`; the read is made on every
 *    request, so revoking or expiring takes effect on the next one.
 *  - Listening is `listen`. Anything that hands the file over — `download=1`,
 *    the WAV, a stem — is `download_masters`, and is audited
 *    (`recording.downloaded`). A viewer or commenter gets it only when the
 *    membership has `allow_downloads`; a contributor or editor always does.
 *  - An external upload is a NEW VERSION of a song in the member's own
 *    project (`upload_versions`): appended, never overwriting (W4). It lands
 *    in the member's projects only, not in every project the song sits in.
 *    The kinds that VOUCH for finished material (master, instrumental) and a
 *    new song for an artist are not offered: the first claims a decision the
 *    project's owners make, the second needs an artist this person cannot see.
 *  - D3: when a member leaves, what they uploaded stays in the project,
 *    credited to them — it carries `tracks.created_by`, not the membership.
 *
 * The SQL twin of "which projects does this person reach" is
 * `public.can_see_project` (migration 148).
 */
import {
  EXTERNAL_ACTIONS,
  EXTERNAL_PROJECT_ROLES,
  EXTERNAL_PROJECT_ROLE_TABLE,
  externalCan,
  type ExternalAction,
  type ExternalProjectRole,
} from './capabilities';
import type { OrgAudioVariant } from './org-audio';
import { normalizeEmailOrNull } from '@/lib/contacts/email';
import { isUUID } from '@/lib/validate';

export const PROJECT_ROLE_LABELS: Readonly<Record<ExternalProjectRole, string>> = {
  viewer: 'Viewer',
  commenter: 'Commenter',
  contributor: 'Contributor',
  editor: 'Editor',
};

/** One line per role, written from the §2.6 table so the two cannot disagree. */
export function projectRoleSummary(role: ExternalProjectRole, allowDownloads: boolean): string {
  const t = EXTERNAL_PROJECT_ROLE_TABLE[role];
  const parts = ['Listens'];
  if (t.comment) parts.push('comments');
  if (t.upload_versions) parts.push('uploads versions');
  if (t.edit_metadata) parts.push('edits metadata');
  const downloads = externalCan(role, 'download_masters', { allowDownloads });
  return `${parts.join(', ')}${downloads ? '; downloads masters' : '; no downloads'}`;
}

export function isExternalProjectRole(value: unknown): value is ExternalProjectRole {
  return typeof value === 'string' && (EXTERNAL_PROJECT_ROLES as readonly string[]).includes(value);
}

// ── Memberships ─────────────────────────────────────────────────────────

/** A live external membership of one project, as the access helpers hand it around. */
export type ExternalMembership = {
  projectId: string;
  role: ExternalProjectRole;
  allowDownloads: boolean;
};

/** A membership row as stored (`project_members`, migration 148). */
export type ProjectMemberRow = {
  project_id: string;
  role: string;
  allow_downloads: boolean | null;
  expires_at: string | null;
};

/** Live = no expiry, or one in the future. An unparseable date is NOT live (fail closed). */
export function membershipLive(expiresAt: string | null | undefined, now: Date = new Date()): boolean {
  if (expiresAt === null || expiresAt === undefined) return true;
  const at = Date.parse(expiresAt);
  return Number.isFinite(at) && at > now.getTime();
}

/** The membership a row is, or null when it has expired or names an unknown role. */
export function toMembership(row: ProjectMemberRow, now: Date = new Date()): ExternalMembership | null {
  if (!isExternalProjectRole(row.role)) return null;
  if (!membershipLive(row.expires_at, now)) return null;
  return { projectId: row.project_id, role: row.role, allowDownloads: row.allow_downloads === true };
}

/** May any of these memberships take the action? (A recording can sit in two shared projects.) */
export function externalMayAny(memberships: readonly ExternalMembership[], action: ExternalAction): boolean {
  return memberships.some((m) => externalCan(m.role, action, { allowDownloads: m.allowDownloads }));
}

/** The memberships that grant the action, for narrowing where an effect may land. */
export function membershipsGranting(memberships: readonly ExternalMembership[], action: ExternalAction): ExternalMembership[] {
  return memberships.filter((m) => externalCan(m.role, action, { allowDownloads: m.allowDownloads }));
}

// ── Audio ───────────────────────────────────────────────────────────────

/**
 * The §2.6 action a request for audio is. Streaming the clip, the peaks or
 * the master in the player is `listen`. `download=1`, the WAV and a stem are
 * the file itself leaving: `download_masters`.
 */
export function externalAudioAction(variant: OrgAudioVariant, download: boolean): Extract<ExternalAction, 'listen' | 'download_masters'> {
  if (download) return 'download_masters';
  return variant.kind === 'wav' || variant.kind === 'stem' ? 'download_masters' : 'listen';
}

/** Only handing the file over is audited; listening is not. */
export function externalAudioIsAudited(action: ExternalAction): boolean {
  return action === 'download_masters';
}

// ── Uploads ─────────────────────────────────────────────────────────────

/** What an external contributor may upload: a new version of a song in their project. */
export const EXTERNAL_UPLOAD_RELATIONS = ['version'] as const;

export type ExternalUploadPlan =
  | { ok: true; projectIds: string[] }
  | { ok: false; status: 403 | 404 | 409; error: string };

/**
 * Where an external upload of `relation` onto a song may land: the song's
 * projects in which the member may upload versions — never the song's other
 * projects. Nothing to land in = 404 (the song is not theirs to know about).
 */
export function planExternalUpload(
  memberships: readonly ExternalMembership[],
  songProjectIds: readonly string[],
  relation: string,
): ExternalUploadPlan {
  const reach = memberships.filter((m) => songProjectIds.includes(m.projectId));
  if (reach.length === 0) return { ok: false, status: 404, error: 'Not found' };
  const may = membershipsGranting(reach, 'upload_versions');
  if (may.length === 0) return { ok: false, status: 403, error: 'Your role in this project cannot upload' };
  if (!(EXTERNAL_UPLOAD_RELATIONS as readonly string[]).includes(relation)) {
    return { ok: false, status: 403, error: 'You can add new versions of a song here' };
  }
  return { ok: true, projectIds: [...new Set(may.map((m) => m.projectId))] };
}

// ── Invitations + changes ───────────────────────────────────────────────

export type ProjectInviteInput = { email: string; role: string; allowDownloads?: boolean };
export type ProjectInvite =
  | { ok: true; email: string; role: ExternalProjectRole; allowDownloads: boolean }
  | { ok: false; error: string };

export function validateProjectInvite(input: ProjectInviteInput): ProjectInvite {
  const email = normalizeEmailOrNull(input.email);
  if (!email || !/^[^\s@]+@[^\s@]+$/.test(email)) return { ok: false, error: 'Enter a valid email address' };
  if (!isExternalProjectRole(input.role)) return { ok: false, error: `Unknown project role "${input.role}"` };
  return { ok: true, email, role: input.role, allowDownloads: input.allowDownloads === true };
}

export type ProjectMemberPatchInput = { role?: string; allowDownloads?: boolean; expiresAt?: string | null };
export type ProjectMemberCurrent = { role: string; allow_downloads: boolean | null; expires_at: string | null };
export type ProjectMemberPlan =
  | {
      ok: true;
      /** The keys that change, as `labelos_audit_project_member_update` takes them. */
      patch: Record<string, unknown>;
      /** The audit payload: what each changed key was and became. */
      payload: Record<string, { from: unknown; to: unknown }>;
    }
  | { ok: false; error: string };

/** Only what actually changes is written and audited; nothing to change is an error, not a silent no-op. */
export function planProjectMemberChange(
  current: ProjectMemberCurrent,
  input: ProjectMemberPatchInput,
  now: Date = new Date(),
): ProjectMemberPlan {
  const patch: Record<string, unknown> = {};
  const payload: Record<string, { from: unknown; to: unknown }> = {};
  if (input.role !== undefined) {
    if (!isExternalProjectRole(input.role)) return { ok: false, error: `Unknown project role "${input.role}"` };
    if (input.role !== current.role) {
      patch.role = input.role;
      payload.role = { from: current.role, to: input.role };
    }
  }
  if (input.allowDownloads !== undefined && input.allowDownloads !== (current.allow_downloads === true)) {
    patch.allow_downloads = input.allowDownloads;
    payload.allow_downloads = { from: current.allow_downloads === true, to: input.allowDownloads };
  }
  if (input.expiresAt !== undefined) {
    if (input.expiresAt !== null) {
      const at = Date.parse(input.expiresAt);
      if (!Number.isFinite(at)) return { ok: false, error: 'expires_at is not a date' };
      if (at <= now.getTime()) return { ok: false, error: 'expires_at must be in the future; remove the member to end access now' };
    }
    const same =
      input.expiresAt === current.expires_at ||
      (input.expiresAt !== null && current.expires_at !== null && Date.parse(input.expiresAt) === Date.parse(current.expires_at));
    if (!same) {
      patch.expires_at = input.expiresAt;
      payload.expires_at = { from: current.expires_at, to: input.expiresAt };
    }
  }
  if (Object.keys(patch).length === 0) return { ok: false, error: 'Nothing to change' };
  return { ok: true, patch, payload };
}

// ── Where a shared project lives ────────────────────────────────────────

/** `/shared/<project>`: the external member's view (no org chrome, 07 §1). */
export function sharedProjectHref(projectId: string): string {
  return `/shared/${encodeURIComponent(projectId)}`;
}

export type SharedProjectRef = { id: string; name: string; orgName: string; role: ExternalProjectRole; href: string };

/** "Shared with me" as the switcher and `/shared` list it: sorted by project name, then org. */
export function sortSharedProjects<T extends { name: string; orgName?: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name) || (a.orgName ?? '').localeCompare(b.orgName ?? ''));
}

export function isProjectId(value: unknown): value is string {
  return typeof value === 'string' && isUUID(value);
}

/** Every §2.6 action, for a role: the permission list the members panel shows. */
export function allowedActions(role: ExternalProjectRole, allowDownloads: boolean): ExternalAction[] {
  return EXTERNAL_ACTIONS.filter((a) => externalCan(role, a, { allowDownloads }));
}
