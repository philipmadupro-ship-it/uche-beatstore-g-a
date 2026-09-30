import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import { NextResponse } from 'next/server';
import { projectShareOwnerId, shareGrantsTrack } from '@/lib/share/share-owner';
import { portalProjectsWithTrack } from '@/lib/artist-portal/membership';

/**
 * One definition of how a public share token is minted, resolved and gated.
 *
 * Four tables answer to a token in a public URL:
 *   - `project_shares`       — project / playlist / single-track shares
 *   - `share_links`          — the legacy flat list of track ids
 *   - `project_access_links` — a storefront bundle purchase
 *   - `artist_portals`       — one artist's permanent portal (migration 125);
 *     it covers every track in the projects linked to that contact with
 *     `project_contacts.in_portal`, so the signed preview/peaks routes serve
 *     portal audio without a copy of their own.
 *
 * Every public route used to carry its own copy of "look the token up, then
 * refuse revoked (410), expired (410), and locked without the right password
 * (401)", and the three media routes each had an identical copy of "does this
 * share contain this track, and may its owner grant it". The copies had
 * already drifted — eight different wordings for the same three refusals, one
 * route returning 401 without `requiresPassword`, and the local-store project
 * reader checking none of it. Status codes are the contract the share pages
 * read; they are unchanged.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

// ── Tokens ───────────────────────────────────────────────────────────────

/** Length of a newly minted share token (nanoid's URL-safe alphabet, ~71 bits). */
export const SHARE_TOKEN_LENGTH = 12;

/** Mint a token for `share_links` or `project_shares`. */
export function newShareToken(): string {
  return nanoid(SHARE_TOKEN_LENGTH);
}

/**
 * Shape check before any query. Covers every token this app has issued: nanoid
 * (share links, project shares) and hex (paid bundle access). The bounds match
 * the campaigns contract (6..128). Anything else cannot be one of ours, so it
 * is refused as "not found" without spending a round trip on it.
 */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{6,128}$/;

export function isWellFormedShareToken(token: unknown): token is string {
  return typeof token === 'string' && TOKEN_PATTERN.test(token);
}

/** The password a share page sends with each request. */
export function sharePasswordFrom(req: Request): string {
  return req.headers.get('x-share-password') ?? '';
}

// ── Gate ─────────────────────────────────────────────────────────────────

export interface ShareLifecycle {
  revoked_at?: string | null;
  expires_at?: string | null;
}

export interface ShareLockable extends ShareLifecycle {
  password_hash?: string | null;
}

export type ShareGateFailure =
  | { status: 410; error: string }
  | { status: 401; error: string; requiresPassword: true };

export const SHARE_GATE_MESSAGES = {
  notFound: 'This link does not exist.',
  revoked: 'This link has been revoked.',
  expired: 'This link has expired.',
  passwordRequired: 'This link needs its password.',
  passwordIncorrect: 'Incorrect password',
} as const;

/** Revoked, then expired. Null when the share is live. */
export function shareLifecycleFailure(share: ShareLifecycle, now: number = Date.now()): ShareGateFailure | null {
  if (share.revoked_at) return { status: 410, error: SHARE_GATE_MESSAGES.revoked };
  if (share.expires_at && new Date(share.expires_at).getTime() < now) {
    return { status: 410, error: SHARE_GATE_MESSAGES.expired };
  }
  return null;
}

/**
 * Revoked → expired → password. Null when the caller may proceed.
 *
 * `checkPassword: false` is only for the HMAC-granted media routes: a grant is
 * minted after the share page itself passed this gate, and `<audio>` cannot
 * send the password header.
 */
export async function shareAccessFailure(
  share: ShareLockable,
  opts: { password: string; checkPassword?: boolean; now?: number },
): Promise<ShareGateFailure | null> {
  const lifecycle = shareLifecycleFailure(share, opts.now);
  if (lifecycle) return lifecycle;
  if (opts.checkPassword === false || !share.password_hash) return null;
  if (!opts.password) {
    return { status: 401, error: SHARE_GATE_MESSAGES.passwordRequired, requiresPassword: true };
  }
  if (!(await bcrypt.compare(opts.password, share.password_hash))) {
    return { status: 401, error: SHARE_GATE_MESSAGES.passwordIncorrect, requiresPassword: true };
  }
  return null;
}

export function shareGateResponse(failure: ShareGateFailure): NextResponse {
  const { status, ...body } = failure;
  return NextResponse.json(body, { status });
}

export function shareNotFoundResponse(): NextResponse {
  return NextResponse.json({ error: SHARE_GATE_MESSAGES.notFound }, { status: 404 });
}

// ── Resolution ───────────────────────────────────────────────────────────

export interface ProjectShareRecord extends ShareLockable {
  id?: string;
  token?: string;
  content_type?: string | null;
  project_id?: string | null;
  playlist_id?: string | null;
  track_id?: string | null;
  allow_downloads?: boolean | null;
  [key: string]: unknown;
}

export interface ShareLinkRecord extends ShareLockable {
  id?: string;
  token?: string;
  user_id?: string | null;
  track_ids?: string[] | null;
  allow_downloads?: boolean | null;
  [key: string]: unknown;
}

export interface PaidAccessRecord {
  id?: string;
  token?: string;
  project_id: string;
  buyer_email?: string | null;
  created_at?: string;
  expires_at?: string | null;
}

export interface ArtistPortalRecord extends ShareLockable {
  id?: string;
  token?: string;
  user_id: string;
  contact_id: string;
  [key: string]: unknown;
}

export type ResolvedShare =
  | { kind: 'project_share'; row: ProjectShareRecord }
  | { kind: 'share_link'; row: ShareLinkRecord }
  | { kind: 'paid_access'; row: PaidAccessRecord }
  | { kind: 'artist_portal'; row: ArtistPortalRecord };

export type ShareKind = ResolvedShare['kind'];

const TABLE: Record<ShareKind, string> = {
  project_share: 'project_shares',
  share_link: 'share_links',
  paid_access: 'project_access_links',
  artist_portal: 'artist_portals',
};

/** Resolution order: a project share wins, then a flat link, then a purchase, then a portal. */
const ORDER: ShareKind[] = ['project_share', 'share_link', 'paid_access', 'artist_portal'];

/**
 * Look a token up in the tables `kinds` names — and only those, so a route
 * never starts honouring a kind of token it did not honour before. A
 * malformed token resolves to null without a query. A database error throws
 * rather than reading as "not found" and falling through to the next table.
 */
export async function resolveShareToken(
  admin: Admin,
  token: string,
  kinds: readonly ShareKind[],
): Promise<ResolvedShare | null> {
  if (!isWellFormedShareToken(token)) return null;
  for (const kind of ORDER) {
    if (!kinds.includes(kind)) continue;
    const { data, error } = await admin.from(TABLE[kind]).select('*').eq('token', token).maybeSingle();
    if (error) throw error;
    if (data) return { kind, row: data } as ResolvedShare;
  }
  return null;
}

/**
 * The gate fields of any resolved share. A purchase can't be revoked or
 * locked; a refund ends it by setting `expires_at`.
 */
export function lockableOf(resolved: ResolvedShare): ShareLockable {
  if (resolved.kind === 'paid_access') {
    return { revoked_at: null, expires_at: resolved.row.expires_at ?? null, password_hash: null };
  }
  return resolved.row;
}

// ── Membership ───────────────────────────────────────────────────────────

/**
 * Does this share cover `trackId`, AND may its owner grant it
 * (`lib/share/share-owner`)? Both halves, for every kind of token.
 */
export async function resolvedShareIncludesTrack(
  admin: Admin,
  resolved: ResolvedShare,
  trackId: string,
): Promise<boolean> {
  if (resolved.kind === 'share_link') {
    const ids = resolved.row.track_ids;
    if (!Array.isArray(ids) || !ids.includes(trackId)) return false;
    return shareGrantsTrack(admin, resolved.row.user_id, trackId);
  }
  if (resolved.kind === 'artist_portal') {
    return (await portalProjectsWithTrack(admin, resolved.row, trackId)).length > 0
      && shareGrantsTrack(admin, resolved.row.user_id, trackId);
  }
  const ref = resolved.kind === 'paid_access'
    ? { content_type: 'project', project_id: resolved.row.project_id }
    : resolved.row;
  return (await projectShareRefIncludesTrack(admin, ref, trackId))
    && shareGrantsTrack(admin, await projectShareOwnerId(admin, ref), trackId);
}

async function projectShareRefIncludesTrack(
  admin: Admin,
  share: { content_type?: string | null; project_id?: string | null; playlist_id?: string | null; track_id?: string | null },
  trackId: string,
): Promise<boolean> {
  const kind = share.content_type ?? 'project';
  if (kind === 'track') return share.track_id === trackId;
  // A playlist share without a playlist id falls through to the project, as
  // `projectShareOwnerId` does — the two must agree on what the share is.
  if (kind === 'playlist' && share.playlist_id) {
    return junctionHas(admin, 'playlist_tracks', 'playlist_id', share.playlist_id, trackId);
  }
  return share.project_id ? junctionHas(admin, 'project_tracks', 'project_id', share.project_id, trackId) : false;
}

async function junctionHas(admin: Admin, table: string, key: string, id: string, trackId: string): Promise<boolean> {
  const { data } = await admin.from(table).select('track_id').eq(key, id).eq('track_id', trackId).maybeSingle();
  return !!data;
}
