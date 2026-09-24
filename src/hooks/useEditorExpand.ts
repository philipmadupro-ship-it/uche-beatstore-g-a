'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

/**
 * "Make the editor bigger", in two steps.
 *
 *  1. Expanded — the editor covers the dashboard chrome (TopBar, PlayerBar)
 *     and fills the window. Pure CSS (`fixed inset-0`), so it always works.
 *  2. Full screen — on top of that, the browser's own Fullscreen API hides
 *     the browser chrome too. Requested on the DOCUMENT element, never the
 *     editor: every popover, menu and toast portals to <body>, and fullscreen
 *     on a sub-element would render all of them invisibly behind it.
 *
 * Collapsing also leaves browser fullscreen, so one click always gets the
 * producer back to the page they came from. Leaving fullscreen with the
 * browser's own Escape keeps the expanded view — that is the step they took
 * back, not both.
 */
const subscribeFullscreen = (onChange: () => void) => {
  document.addEventListener('fullscreenchange', onChange);
  return () => document.removeEventListener('fullscreenchange', onChange);
};
const subscribeNever = () => () => {};

export function useEditorExpand() {
  const [expanded, setExpanded] = useState(false);
  // External stores, not effect-set state: the server snapshot (false) keeps
  // SSR and hydration in agreement, and there is no second render pass.
  const fullscreen = useSyncExternalStore(subscribeFullscreen, () => Boolean(document.fullscreenElement), () => false);
  const fullscreenAvailable = useSyncExternalStore(subscribeNever, () => Boolean(document.fullscreenEnabled), () => false);

  // The page underneath must not scroll while the editor covers it; with two
  // scrollbars a wheel over the stage edge scrolls the hidden page instead.
  useEffect(() => {
    if (!expanded) return undefined;
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = 'hidden';
    return () => { root.style.overflow = previous; };
  }, [expanded]);

  const toggleExpanded = useCallback(() => {
    // Side effect outside the updater — React may run an updater twice.
    if (expanded && document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    setExpanded(!expanded);
  }, [expanded]);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
      return;
    }
    setExpanded(true);
    // Refused outside a user gesture or by policy; the expanded view is
    // already a complete answer, so a refusal needs no message.
    void document.documentElement.requestFullscreen?.().catch(() => {});
  }, []);

  return { expanded, toggleExpanded, fullscreen, fullscreenAvailable, toggleFullscreen };
}
