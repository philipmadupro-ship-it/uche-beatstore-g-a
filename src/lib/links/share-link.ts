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
  /** client | producer | rapper | friend — only rows that carry it get the Recipient facet. */
  recipient_kind?: string | null;
  created_at?: string | null;
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

export interface ShareLinkPatch {
  title?: string | null;
  allow_downloads?: boolean;
  /** Both tables accept it: full track (true) or the 75 s preview (false). */
  full_playback?: boolean;
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
      ? { label: patch.title, allow_downloads: patch.allow_downloads, full_playback: patch.full_playback }
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
    ...(typeof share.full_playback === 'boolean' ? { full_playback: share.full_playback } : {}),
    expires_at: (share.expires_at as string | null) ?? null,
    revoked_at: (share.revoked_at as string | null) ?? null,
  } as Partial<T>;
}

export const LINK_FILTERS = ['All', 'Active', 'Expired', 'Protected', 'Downloads'] as const;
export type LinkFilter = (typeof LINK_FILTERS)[number];

// ── Facets ───────────────────────────────────────────────────────────────
// Within a group any selection matches; across groups all must — the same rule
// as the Library's Tags facet.
export const LINK_STATUS_FACETS = ['active', 'expired', 'revoked', 'unopened'] as const;
export const LINK_KIND_FACETS = ['track', 'project', 'playlist'] as const;
export const LINK_RECIPIENT_FACETS = ['client', 'producer', 'rapper', 'friend'] as const;
export const LINK_OPTION_FACETS = ['password', 'downloads_on', 'downloads_off'] as const;
export const LINK_SORTS = ['newest', 'oldest', 'opens', 'expiring', 'title'] as const;

export type LinkStatusFacet = (typeof LINK_STATUS_FACETS)[number];
export type LinkKindFacet = (typeof LINK_KIND_FACETS)[number];
export type LinkRecipientFacet = (typeof LINK_RECIPIENT_FACETS)[number];
export type LinkOptionFacet = (typeof LINK_OPTION_FACETS)[number];
export type LinkSort = (typeof LINK_SORTS)[number];

export const DEFAULT_LINK_SORT: LinkSort = 'newest';

export interface LinkFacets {
  status: ReadonlySet<LinkStatusFacet>;
  kind: ReadonlySet<LinkKindFacet>;
  recipient: ReadonlySet<LinkRecipientFacet>;
  options: ReadonlySet<LinkOptionFacet>;
}

export function emptyLinkFacets(): LinkFacets {
  return { status: new Set(), kind: new Set(), recipient: new Set(), options: new Set() };
}

export function hasActiveLinkFacets(f: LinkFacets): boolean {
  return f.status.size + f.kind.size + f.recipient.size + f.options.size > 0;
}

/** What the row's `kind` says, folded to the three facet values ('share'/unknown → none). */
export function linkKindOf(link: Pick<ShareLinkFacts, 'kind'>): LinkKindFacet | null {
  const k = (link.kind ?? '').toLowerCase();
  return (LINK_KIND_FACETS as readonly string[]).includes(k) ? (k as LinkKindFacet) : null;
}

function statusMatches(link: ShareLinkFacts, s: LinkStatusFacet, now: Date): boolean {
  switch (s) {
    case 'revoked':
      return Boolean(link.revoked_at);
    case 'expired':
      return isShareLinkExpired(link, now);
    case 'active':
      return !isShareLinkExpired(link, now);
    case 'unopened':
      return !(typeof link.plays === 'number' && link.plays > 0);
  }
}

function optionMatches(link: ShareLinkFacts, o: LinkOptionFacet): boolean {
  switch (o) {
    case 'password':
      return link.password_protected;
    case 'downloads_on':
      return link.allow_downloads !== false;
    case 'downloads_off':
      return link.allow_downloads === false;
  }
}

/**
 * Facet + text filter for the list.
 *
 * Text matches title, content title, token and kind: a link the producer has
 * not titled is only findable by its token, and a renamed one by what it points
 * at. `facets` is optional so the legacy single-select `filter` keeps working.
 */
export function filterShareLinks<T extends ShareLinkFacts>(
  links: T[],
  opts: { filter?: LinkFilter; search: string; facets?: LinkFacets; now?: Date },
): T[] {
  const q = opts.search.trim().toLowerCase();
  const now = opts.now ?? new Date();
  const filter = opts.filter ?? 'All';
  const f = opts.facets;
  return links.filter((link) => {
    const expired = isShareLinkExpired(link, now);
    if (filter === 'Active' && expired) return false;
    if (filter === 'Expired' && !expired) return false;
    if (filter === 'Protected' && !link.password_protected) return false;
    if (filter === 'Downloads' && link.allow_downloads === false) return false;
    if (f) {
      if (f.status.size && !Array.from(f.status).some((s) => statusMatches(link, s, now))) return false;
      if (f.kind.size) {
        const k = linkKindOf(link);
        if (!k || !f.kind.has(k)) return false;
      }
      if (f.recipient.size) {
        const r = (link.recipient_kind ?? '').toLowerCase() as LinkRecipientFacet;
        if (!f.recipient.has(r)) return false;
      }
      if (f.options.size && !Array.from(f.options).some((o) => optionMatches(link, o))) return false;
    }
    if (q) {
      const haystack =
        `${link.title ?? ''} ${link.content_title ?? ''} ${link.token} ${link.kind ?? ''}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

function time(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

function labelOf(l: ShareLinkFacts): string {
  return (l.title || l.content_title || l.token || '').toLowerCase();
}

/**
 * Sorted copy. Ties fall back to newest, then token, so the order is stable
 * between renders. "Expiring soon" lists live links by nearest expiry; links
 * with no expiry follow, and expired/revoked ones go last.
 */
export function sortShareLinks<T extends ShareLinkFacts>(
  links: T[],
  sort: LinkSort,
  now: Date = new Date(),
): T[] {
  const created = (l: T) => time(l.created_at) ?? 0;
  const tie = (a: T, b: T) => created(b) - created(a) || a.token.localeCompare(b.token);
  const rank = (l: T): number => {
    if (isShareLinkExpired(l, now)) return 2;
    return time(l.expires_at) === null ? 1 : 0;
  };
  return links.slice().sort((a, b) => {
    switch (sort) {
      case 'oldest':
        return created(a) - created(b) || a.token.localeCompare(b.token);
      case 'opens':
        return (b.plays ?? 0) - (a.plays ?? 0) || tie(a, b);
      case 'title':
        return labelOf(a).localeCompare(labelOf(b)) || tie(a, b);
      case 'expiring': {
        const ra = rank(a);
        const rb = rank(b);
        if (ra !== rb) return ra - rb;
        if (ra === 0) return (time(a.expires_at) ?? 0) - (time(b.expires_at) ?? 0) || tie(a, b);
        return tie(a, b);
      }
      case 'newest':
      default:
        return tie(a, b);
    }
  });
}
