/**
 * ONE rule for "how many tag pills before +N more".
 *
 * Tag pill rows used to apply four unrelated rules: a few sliced to two or
 * three with no sign anything was cut, one rendered everything. A track with
 * 60 tags made the store detail page eleven rows tall. The rule is a fixed
 * count rather than a measured width — measuring needs layout, differs between
 * the server and the client, and shifts a card grid when it settles.
 *
 * Never collapse for a single tag: "+1 more" takes the same room as the pill
 * it hides, so a set of limit + 1 shows everything.
 */

export const TAG_LIMIT_ROW = 2;
export const TAG_LIMIT_CARD = 3;
export const TAG_LIMIT_DETAIL = 8;
export const TAG_LIMIT_EDIT = 10;

export interface TagSplit<T> {
  visible: T[];
  hidden: T[];
  hiddenCount: number;
  /** True when a toggle is worth showing (something is, or was, hidden). */
  canToggle: boolean;
}

export function splitTags<T>(tags: readonly T[], opts: { limit: number; expanded?: boolean; strict?: boolean }): TagSplit<T> {
  const limit = Math.max(0, Math.floor(opts.limit));
  // `strict` is for fixed-width rows, where one extra pill would be clipped.
  const collapsible = tags.length > (opts.strict ? limit : limit + 1);
  if (!collapsible || opts.expanded) {
    return { visible: [...tags], hidden: [], hiddenCount: 0, canToggle: collapsible };
  }
  const hidden = tags.slice(limit);
  return { visible: tags.slice(0, limit), hidden: [...hidden], hiddenCount: hidden.length, canToggle: true };
}

/** `title` text for a non-interactive "+N" chip: the names it stands for. */
export function hiddenTagsTitle(hidden: readonly string[]): string {
  return hidden.join(', ');
}
