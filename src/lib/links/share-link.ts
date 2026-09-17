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
  plays?: number | null;
  expires_at: string | null;
  revoked_at: string | null;
  allow_downloads: boolean;
  password_protected: boolean;
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

export interface ShareLinkPatch {
  title?: string | null;
  allow_downloads?: boolean;
  expires_at?: string | null;
  /** Token shares set expiry as a day count; `0` means never. */
  expires_days?: number;
  /** `null` clears the password; omitted leaves it untouched. */
  password?: string | null;
}

/**
 * Rename the patch fields for the table being written.
 *
 * `project_shares` stores the display name in `label`, and accepts none of the
 * token-share fields. Keys whose value is `undefined` are dropped so a patch of
 * one property never blanks another.
 */
export function toSharePatchBody(
  link: ShareLinkRef,
  patch: ShareLinkPatch,
): Record<string, unknown> {
  const body: Record<string, unknown> =
    link.source === 'project_shares'
      ? { label: patch.title, allow_downloads: patch.allow_downloads }
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
 * own `content_title` keeps the row readable when the label is cleared.
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
