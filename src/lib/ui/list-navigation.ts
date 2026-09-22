/**
 * Keyboard navigation through a list of tracks — auditioning by arrow key.
 *
 * Adapted from splicedd, a sample browser, where it is the single most
 * important interaction: a producer judges a sound in under a second and moves
 * on, so the list has to be playable without the mouse. ↑/↓ move, Enter plays,
 * Home/End jump to the ends.
 *
 * ## Why this is not `nextEnabledIndex`
 *
 * `lib/ui/action-menu.ts` already navigates a list by arrow key, and the rule
 * in this codebase is to extend it rather than write a second copy. It is not
 * reused here on purpose: it WRAPS at both ends. That is correct in a menu of
 * six items, where wrapping is how you reach the bottom from the top. In a
 * catalogue it is wrong — holding ↓ to skim past the last row would throw the
 * producer back to the first one, mid-audition, with no sign it had happened.
 * A track list clamps.
 *
 * It is also typed to menu items, which carry `disabled` and `busy`; a track
 * row has neither.
 */

export type ListKeyAction =
  | { type: 'move'; index: number }
  | { type: 'activate'; index: number }
  | null;

/**
 * What a key does, given where the cursor is.
 *
 * `activeIndex` is -1 when nothing is selected yet; the first arrow press then
 * lands on the first row in either direction, rather than ↑ jumping to the
 * bottom of a list the producer has not started browsing.
 *
 * Returns null for any key this does not own, so the caller knows to leave the
 * event alone — which is what lets volume keep ↑/↓ everywhere outside a list.
 */
export function listKeyAction(key: string, activeIndex: number, count: number): ListKeyAction {
  if (count <= 0) return null;
  const last = count - 1;
  const from = Math.min(activeIndex, last);

  switch (key) {
    case 'ArrowDown':
      return { type: 'move', index: from < 0 ? 0 : Math.min(last, from + 1) };
    case 'ArrowUp':
      return { type: 'move', index: from < 0 ? 0 : Math.max(0, from - 1) };
    case 'Home':
      return { type: 'move', index: 0 };
    case 'End':
      return { type: 'move', index: last };
    case 'Enter':
      return from < 0 ? null : { type: 'activate', index: from };
    default:
      return null;
  }
}

/**
 * The rows either side of `index`, to warm while the current one plays.
 *
 * From splicedd: whichever way the producer presses next, that preview has
 * already started loading, so moving on plays instantly instead of pausing on
 * a network round-trip every step.
 */
export function neighbourIndices(index: number, count: number): number[] {
  return [index + 1, index - 1].filter((i) => i >= 0 && i < count);
}

/**
 * Whether a key belongs to the control it was pressed on, rather than to the
 * list around it.
 *
 * It depends on the key, not just the element:
 *
 *   - A text field, a menu, a dialog or a slider owns every key this list
 *     handles. Arrows in a field move the caret; in a menu they move through
 *     the menu; on a slider they move the value. Taking ↑/↓ from any of them
 *     leaves a keyboard user stuck.
 *   - A button or a link owns ENTER — Enter on the ⋯ trigger should open the
 *     menu, not play the row — but NOT the arrows. A row's own play button is
 *     precisely what has focus while someone browses, so refusing arrows there
 *     would make the feature do nothing in the one place it is used.
 */
export function isOwnedByAnotherControl(target: EventTarget | null, key: string): boolean {
  if (!target || typeof (target as Element).closest !== 'function') return false;
  const el = target as HTMLElement;
  if (el.isContentEditable) return true;

  const ownsEverything = el.closest(
    'input, textarea, select, [contenteditable="true"], [role="menu"], [role="dialog"], [role="listbox"], [role="slider"]',
  );
  if (ownsEverything) return true;

  if (key === 'Enter') return el.closest('button, a[href]') != null;
  return false;
}
