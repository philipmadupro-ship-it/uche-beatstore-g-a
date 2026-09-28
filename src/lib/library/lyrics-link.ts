/**
 * The one address for "open this track in Lyrics Studio".
 *
 * Lyrics Studio lives inside the track page, under the `#lyrics` section, so
 * every entry point — the details drawer and each Library ⋯ menu — links to
 * the same hash. It is written here once so the menus and the page that has to
 * honour the hash cannot drift apart.
 *
 * The hash alone does not work. `/library/[id]` fetches the track on the
 * client and renders a spinner first, so when the router looks for `#lyrics`
 * the element does not exist yet: navigation succeeded, and the producer
 * landed at the top of a long page with the studio several screens below.
 * `focusLyricsSection` is what the page calls once the section has mounted.
 */

export const LYRICS_ANCHOR = 'lyrics';

export function lyricsStudioHref(trackId: string): string {
  return `/library/${encodeURIComponent(trackId)}#${LYRICS_ANCHOR}`;
}

export function isLyricsHash(hash: string | null | undefined): boolean {
  return (hash ?? '').replace(/^#/, '') === LYRICS_ANCHOR;
}

/**
 * Scroll to and focus the Lyrics Studio section when the URL asks for it.
 *
 * Focus moves as well as the viewport: a keyboard user who chose "Open in
 * Lyrics Studio" would otherwise have their focus left at the top of the page
 * while the screen shows the editor, and the next Tab would start from there.
 * The scroll is instant rather than smooth, so there is no motion to gate on
 * `prefers-reduced-motion`.
 *
 * Returns whether it acted, so the caller can do this once per track rather
 * than yanking the page back every time it re-renders.
 */
export function focusLyricsSection(doc: Document, hash: string): boolean {
  if (!isLyricsHash(hash)) return false;
  const el = doc.getElementById(LYRICS_ANCHOR);
  if (!el) return false;
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: 'start' });
  return true;
}
