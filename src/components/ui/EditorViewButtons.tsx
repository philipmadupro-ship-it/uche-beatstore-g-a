'use client';

import { Expand, Fullscreen, Minimize2, Shrink } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Expand / full-screen toggles for the canvas editors. Paired with
 * `useEditorExpand`, which owns the state and explains the two steps.
 */
export function EditorViewButtons({
  expanded,
  onToggleExpanded,
  fullscreen,
  fullscreenAvailable,
  onToggleFullscreen,
}: {
  expanded: boolean;
  onToggleExpanded: () => void;
  fullscreen: boolean;
  fullscreenAvailable: boolean;
  onToggleFullscreen: () => void;
}) {
  const pill = 'flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[11px] transition-colors';
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      {expanded && fullscreenAvailable ? (
        <button
          type="button"
          aria-pressed={fullscreen}
          onClick={onToggleFullscreen}
          title={fullscreen ? 'Leave full screen' : 'Full screen — hide the browser too'}
          className={cn(
            pill,
            fullscreen
              ? 'border-white/30 bg-white/[0.14] text-white'
              : 'border-white/[0.06] bg-white/[0.04] text-white/60 hover:bg-white/[0.08] hover:text-white',
          )}
        >
          {fullscreen ? <Minimize2 size={12} /> : <Fullscreen size={12} />}
          <span className="hidden md:inline">{fullscreen ? 'Exit full screen' : 'Full screen'}</span>
        </button>
      ) : null}
      <button
        type="button"
        aria-pressed={expanded}
        onClick={onToggleExpanded}
        title={expanded ? 'Back to the page' : 'Expand the editor to the whole window'}
        className={cn(
          pill,
          expanded
            ? 'border-white/30 bg-white/[0.14] text-white'
            : 'border-white/[0.06] bg-white/[0.04] text-white/60 hover:bg-white/[0.08] hover:text-white',
        )}
      >
        {expanded ? <Shrink size={12} /> : <Expand size={12} />}
        <span className="hidden md:inline">{expanded ? 'Collapse' : 'Expand'}</span>
      </button>
    </span>
  );
}
