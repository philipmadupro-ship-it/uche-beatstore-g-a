/**
 * Height rule for a textarea that grows with its content instead of reserving a
 * fixed number of rows. `rows={20}` on the License Contract editor drew a
 * 375px blank box under a one-line description whenever the template was empty.
 *
 * `contentHeight` is the textarea's `scrollHeight` (padding included) measured
 * with its height reset to `auto`. The result is clamped into [min, max] and
 * says whether the content overflows the max, so the caller can show a scrollbar
 * only then.
 */
export const TEMPLATE_TEXTAREA_MIN_PX = 160;
export const TEMPLATE_TEXTAREA_MAX_PX = 480;

export interface AutosizeResult {
  height: number;
  scroll: boolean;
}

export function autosizeHeight(
  contentHeight: number,
  min = TEMPLATE_TEXTAREA_MIN_PX,
  max = TEMPLATE_TEXTAREA_MAX_PX,
): AutosizeResult {
  const content = Number.isFinite(contentHeight) ? Math.max(0, contentHeight) : 0;
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return { height: Math.min(Math.max(Math.ceil(content), lo), hi), scroll: content > hi };
}
