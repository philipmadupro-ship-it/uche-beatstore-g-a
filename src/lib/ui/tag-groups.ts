/**
 * Pure helpers behind `components/ui/InlineTagStrip`.
 *
 * Removing a tag needs the category it was stored under — the tag APIs take
 * `{ tag, category }` on both POST and DELETE — but the inline strip only ever
 * has the tag NAME to work from, because that is all the tags endpoints hand
 * back to the pickers. Resolving name → category is therefore a real lookup
 * with a real fallback, not a formatting detail, so it lives here where it can
 * be tested rather than inside the click handler.
 */

export interface TagGroup {
  /** Persisted category value, e.g. 'genre' or 'project_type'. */
  category: string;
  /** Human label for the group heading. */
  label: string;
  options: readonly string[];
}

/** Category a tag belongs to, or 'custom' for anything user-invented. */
export function categoryForTag(groups: TagGroup[], tag: string): string {
  const hit = groups.find((g) => g.options.some((o) => o.toLowerCase() === tag.toLowerCase()));
  return hit?.category ?? 'custom';
}

/**
 * Active tags ordered the way the groups are declared, with custom tags last.
 *
 * Without this the strip renders tags in whatever order the API returned —
 * effectively insertion order — so the same project reads differently after
 * every edit and the eye has nothing stable to anchor on.
 */
export function orderTags(groups: TagGroup[], tags: string[]): string[] {
  const rank = new Map<string, number>();
  groups.forEach((g, gi) => {
    g.options.forEach((o, oi) => rank.set(o.toLowerCase(), gi * 1000 + oi));
  });
  const CUSTOM = Number.MAX_SAFE_INTEGER;
  return [...tags].sort((a, b) => {
    const ra = rank.get(a.toLowerCase()) ?? CUSTOM;
    const rb = rank.get(b.toLowerCase()) ?? CUSTOM;
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b);
  });
}

/**
 * Whether a typed custom tag can be added: non-empty after trim, and not
 * already applied (case-insensitively — "Trap" and "trap" are the same tag to
 * a person, and letting both exist makes the filter facets lie).
 */
export function canAddCustomTag(tags: string[], draft: string): boolean {
  const t = draft.trim();
  if (!t) return false;
  return !tags.some((x) => x.toLowerCase() === t.toLowerCase());
}
