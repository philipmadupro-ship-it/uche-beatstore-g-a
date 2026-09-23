/**
 * Pure model behind `components/ui/ActionMenu`.
 *
 * Every ⋯ menu in the app was previously hand-rolled: a `useState(open)`, an
 * absolutely-positioned div, and a flat list of buttons in whatever order the
 * feature happened to grow in. That made three things impossible to get right
 * consistently — keyboard navigation, grouping by frequency, and keeping the
 * destructive action visually last.
 *
 * The rules that matter live here rather than inside the component, because
 * per CLAUDE.md "logic inside React components can't be tested in isolation
 * and gets silently reverted".
 *
 *  - Sections render in the order given EXCEPT `danger`, which is always
 *    pinned last no matter where the caller put it. A menu should not be able
 *    to place Delete above Rename by accident.
 *  - Hidden items are dropped before flattening, so keyboard indices only ever
 *    address items the user can actually see.
 *  - Empty sections disappear, so a caller can conditionally hide every item in
 *    a group without leaving a stray heading and separator behind.
 */

export interface MenuAction {
  id: string;
  label: string;
  /** Hidden items never render and never take a keyboard index. */
  hidden?: boolean;
  disabled?: boolean;
  /** Rendered right-aligned, e.g. "R" or "⌘K". Display only. */
  shortcut?: string;
  /** Single printable key that triggers this item while the menu is open. */
  shortcutKey?: string;
  /** Muted second line under the label. */
  hint?: string;
  /** Shows a check mark — for toggles and current-value rows. */
  checked?: boolean;
  danger?: boolean;
  /** While true the row shows a spinner and cannot be invoked. */
  busy?: boolean;
  /** Returning `'keep-open'` leaves the menu open (toggles, multi-set rows). */
  onSelect: () => void | 'keep-open' | Promise<void | 'keep-open'>;
}

export interface MenuSection {
  id: string;
  /** Optional 10px mono heading above the group. */
  label?: string;
  /** Pins the section last and tints its items red. */
  danger?: boolean;
  items: MenuAction[];
}

/** A section with hidden/empty items removed. */
export interface ResolvedSection extends MenuSection {
  items: MenuAction[];
}

/**
 * Drop hidden items and empty sections, then move every danger section to the
 * end preserving relative order within each bucket.
 */
export function resolveSections(sections: MenuSection[]): ResolvedSection[] {
  const cleaned = sections
    .map((s) => ({ ...s, items: s.items.filter((i) => !i.hidden) }))
    .filter((s) => s.items.length > 0);
  const safe = cleaned.filter((s) => !s.danger);
  const danger = cleaned.filter((s) => s.danger);
  return [...safe, ...danger];
}

/** Visible items in render order — the array keyboard indices address. */
export function flattenActions(sections: MenuSection[]): MenuAction[] {
  return resolveSections(sections).flatMap((s) => s.items);
}

/**
 * Next selectable index when the user presses an arrow key.
 *
 * Wraps at both ends and skips disabled/busy rows. Returns -1 when nothing in
 * the menu can be focused, so callers don't highlight a dead row.
 */
export function nextEnabledIndex(
  items: MenuAction[],
  from: number,
  dir: 1 | -1,
): number {
  if (items.length === 0) return -1;
  for (let step = 1; step <= items.length; step += 1) {
    const idx = (from + dir * step + items.length * step) % items.length;
    const item = items[idx];
    if (item && !item.disabled && !item.busy) return idx;
  }
  return -1;
}

/** First selectable index, for when the menu opens. */
export function firstEnabledIndex(items: MenuAction[]): number {
  return nextEnabledIndex(items, -1, 1);
}

/**
 * Index of the item bound to a printable key, or -1.
 *
 * Case-insensitive so a producer hitting Shift by habit still gets the action,
 * and disabled rows are never matched.
 */
export function indexForShortcutKey(items: MenuAction[], key: string): number {
  const k = key.toLowerCase();
  return items.findIndex(
    (i) => i.shortcutKey?.toLowerCase() === k && !i.disabled && !i.busy,
  );
}
