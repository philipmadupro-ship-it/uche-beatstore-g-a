/**
 * Share-link plumbing, as pure functions.
 *
 * `/links` merges two tables into one list: `share_links` (a track share,
 * addressed by its token) and `project_shares` (a project share, addressed by
 * its row id, with `title` stored under a different column name). Every read
 * and write therefore has to branch on `link.source`, and that branch was
 * copy-pasted four times on the page — once in `deleteLink`, again in the bulk
 * delete, and twice inside `patchLink` for the request and the response.
 *
 * Four copies of a rule is four chances to update three of them. Sending a
 * project share `{ title }` instead of `{ label }` does not fail — PostgREST
 * accepts the request, changes nothing, and the page optimistically renders the
 * new title until the next refetch puts the old one back.
 *
 * Per the pure-logic rule in CLAUDE.md, the branch lives here and is tested.
 */

export type ShareLinkSource = 'share_links' | 'project_shares';

/** The fields the routing/filtering rules actually read. */
export interface ShareLinkRef {
  id: string;
  source: ShareLinkSource;
  token: string;
}

export interface ShareLinkFacts extends ShareLinkRef {
  title: string | null;
  content_title?: string | null;
  kind?: string | null;
  /**
   * Page opens, despite the column name: both share routes increment it each
   * time the page is loaded, before anything is played. Show it through
   * `shareOpensLabel`. Real per-track listening is in `play_head_pings`.
   */
  plays?: number | null;
  expires_at: string | null;
  revoked_at: string | null;
  allow_downloads: boolean;
  /** Full track (default) or the 75 s preview only. Absent = full (mig 121). */
  full_playback?: boolean;
  password_protected: boolean;
  /** Share variant. Optional: older list responses omit it. */
  recipient_kind?: string | null;
  /** Buy buttons on the page. Optional for the same reason. */
  sales_enabled?: boolean | null;
}

/**
 * "1 open" / "12 opens". The `plays` column on `share_links` and
 * `project_shares` counts page loads, and /links used to call it plays, which
 * overstated how much was actually listened to.
 */
export function shareOpensLabel(count: number | null | undefined): string {
  const n = typeof count === 'number' && Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  return `${n.toLocaleString('en-US')} ${n === 1 ? 'open' : 'opens'}`;
}

/** The API path that reads, patches and deletes this link. */
export function shareLinkEndpoint(link: ShareLinkRef): string {
  return link.source === 'project_shares' ? `/api/shares/${link.id}` : `/api/share/${link.token}`;
}

/**
 * Stable identity across both tables.
 *
 * Namespaced by source: the two tables have independent id sequences, so an id
 * alone can name two different links.
 */
export function shareLinkKey(link: ShareLinkRef): string {
  return `${link.source}:${link.id}`;
}

/**
 * Expired means revoked *or* past its expiry. Revoked has no date to compare,
 * so checking `expires_at` alone silently treats a revoked link as live.
 */
export function isShareLinkExpired(
  link: Pick<ShareLinkFacts, 'expires_at' | 'revoked_at'>,
  now: Date = new Date(),
): boolean {
  if (link.revoked_at) return true;
  if (!link.expires_at) return false;
  const at = new Date(link.expires_at);
  if (Number.isNaN(at.getTime())) return false;
  return at < now;
}

export const SHARE_RECIPIENT_KINDS = ['client', 'producer', 'rapper', 'friend'] as const;
export type ShareRecipientKind = (typeof SHARE_RECIPIENT_KINDS)[number];

export interface ShareLinkPatch {
  title?: string | null;
  allow_downloads?: boolean;
  /** Both tables accept it: full track (true) or the 75 s preview (false). */
  full_playback?: boolean;
  expires_at?: string | null;
  /** Both tables set expiry as a day count; `0` means never. */
  expires_days?: number;
  /** `null` clears the password; omitted leaves it untouched. */
  password?: string | null;
  /** Which share variant the recipient sees. Both tables. */
  recipient_kind?: ShareRecipientKind;
  /** Buy buttons on the page. Meaningful for `client` links only. */
  sales_enabled?: boolean;
  /** Token shares only: the new, ordered track list. Never empty. */
  track_ids?: string[];
}

/**
 * Selling is for client links only: the Buy buttons exist in the client share
 * variant and nowhere else. This is the ONE rule both PATCH routes apply.
 *
 * - Moving a link away from `client` clears `sales_enabled` (returned, so the
 *   optimistic UI matches what was stored).
 * - Asking for `sales_enabled: true` on a link that is not (or is not becoming)
 *   a client link is an error, never silently dropped.
 */
export function resolveSalesRule(
  currentKind: string | null | undefined,
  patch: { recipient_kind?: string; sales_enabled?: boolean },
): { ok: true; fields: { recipient_kind?: string; sales_enabled?: boolean } } | { ok: false; error: string } {
  const effective = patch.recipient_kind ?? currentKind ?? 'client';
  const fields: { recipient_kind?: string; sales_enabled?: boolean } = {};
  if (patch.recipient_kind !== undefined) fields.recipient_kind = patch.recipient_kind;
  if (patch.sales_enabled === true && effective !== 'client') {
    return { ok: false, error: 'Selling is for client links only' };
  }
  if (patch.sales_enabled !== undefined) fields.sales_enabled = patch.sales_enabled;
  if (patch.recipient_kind !== undefined && effective !== 'client') fields.sales_enabled = false;
  return { ok: true, fields };
}

/** Drop repeats, keep the first occurrence's position. Empty stays empty. */
export function normalizeTrackIds(ids: readonly string[]): string[] {
  return Array.from(new Set(ids));
}

/**
 * Rename the patch fields for the table being written.
 *
 * `project_shares` stores the display name in `label`, and has no track list
 * (it points at a project / playlist / track, so `track_ids` is never sent).
 * Keys whose value is `undefined` are dropped so a patch of one property never
 * blanks another.
 */
export function toSharePatchBody(
  link: ShareLinkRef,
  patch: ShareLinkPatch,
): Record<string, unknown> {
  const body: Record<string, unknown> =
    link.source === 'project_shares'
      ? {
          label: patch.title,
          allow_downloads: patch.allow_downloads,
          full_playback: patch.full_playback,
          expires_days: patch.expires_days,
          password: patch.password,
          recipient_kind: patch.recipient_kind,
          sales_enabled: patch.sales_enabled,
        }
      : { ...patch };
  for (const key of Object.keys(body)) {
    if (body[key] === undefined) delete body[key];
  }
  return body;
}

/**
 * Map a PATCH response back onto the merged row shape.
 *
 * For a project share the response speaks `label`; falling back to the link's
 * own `content_title` keeps the row readable when the label is cleared. Both
 * routes answer `password_protected` (never the hash).
 */
export function fromSharePatchResponse<T extends ShareLinkFacts>(
  link: T,
  share: Record<string, unknown>,
): Partial<T> {
  if (link.source !== 'project_shares') return share as Partial<T>;
  // Generic over the caller's row type so the merged result keeps that type;
  // the fields below are a subset of ShareLinkFacts, which T extends.
  return {
    title: (share.label as string | null) ?? link.content_title ?? null,
    allow_downloads: share.allow_downloads as boolean,
    ...(typeof share.full_playback === 'boolean' ? { full_playback: share.full_playback } : {}),
    ...(typeof share.password_protected === 'boolean' ? { password_protected: share.password_protected } : {}),
    ...(typeof share.recipient_kind === 'string' ? { recipient_kind: share.recipient_kind } : {}),
    ...(typeof share.sales_enabled === 'boolean' ? { sales_enabled: share.sales_enabled } : {}),
    expires_at: (share.expires_at as string | null) ?? null,
    revoked_at: (share.revoked_at as string | null) ?? null,
  } as Partial<T>;
}

export const LINK_FILTERS = ['All', 'Active', 'Expired', 'Protected', 'Downloads'] as const;
export type LinkFilter = (typeof LINK_FILTERS)[number];

/**
 * Facet + text filter for the list.
 *
 * Matches title, token and kind, because a link the producer has not titled is
 * only findable by its token — which is exactly the link they are most likely
 * to be hunting for.
 */
export function filterShareLinks<T extends ShareLinkFacts>(
  links: T[],
  opts: { filter: LinkFilter; search: string; now?: Date },
): T[] {
  const q = opts.search.trim().toLowerCase();
  const now = opts.now ?? new Date();
  return links.filter((link) => {
    const expired = isShareLinkExpired(link, now);
    if (opts.filter === 'Active' && expired) return false;
    if (opts.filter === 'Expired' && !expired) return false;
    if (opts.filter === 'Protected' && !link.password_protected) return false;
    if (opts.filter === 'Downloads' && link.allow_downloads === false) return false;
    if (q) {
      const haystack = `${link.title ?? ''} ${link.token} ${link.kind ?? ''}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}
