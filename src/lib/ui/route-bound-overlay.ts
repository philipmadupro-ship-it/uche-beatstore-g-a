/**
 * Full-screen overlays mounted in a layout (the player's Now Playing card)
 * outlive the page they were opened on. Holding a plain `open` boolean meant
 * browser Back changed the route underneath while the overlay stayed on top:
 * the user pressed Back to leave a project bundle and was still looking at the
 * same waveform, now covering a page they could not see.
 *
 * Store the pathname the overlay was opened on instead. `open` is derived from
 * it, so the overlay is already closed on the render the route changes in.
 * `openedOn` comes back null once the route has moved, and the caller must
 * write that back — otherwise Forward returns to the original route and the
 * overlay reappears by itself.
 */
export function routeBoundOverlay(
  openedOn: string | null,
  pathname: string | null,
): { open: boolean; openedOn: string | null } {
  if (openedOn === null) return { open: false, openedOn: null };
  if (openedOn !== pathname) return { open: false, openedOn: null };
  return { open: true, openedOn };
}
