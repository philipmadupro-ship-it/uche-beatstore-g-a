'use client';

import Link from 'next/link';
import { COLLECTION_DRAG_MIME } from '@/lib/collections/folders';
import { useState } from 'react';
import { Check, Pin } from 'lucide-react';
import { cn } from '@/lib/utils';
import { InlineText } from './InlineText';
import type { CSSProperties, ReactNode } from 'react';
import { ArtworkFallback } from './ArtworkFallback';
import type { ArtworkKind } from '@/lib/artwork/gradient';

/**
 * Shared cover-art grid card for Projects + Playlists (and future
 * media collections). One visual language: bordered 12px cover,
 * bottom scrim, title-first hierarchy, single quiet metadata line.
 *
 * Slots over flags: pin / options / play / badge render whatever the
 * caller passes, so page-specific features (store toggle, play queue)
 * stay in the page while the chrome stays identical.
 */
interface MediaCardProps {
  title: string;
  href?: string;
  /** Fired when the card link is followed (e.g. record "recently opened"). */
  onOpen?: () => void;
  coverUrl?: string | null;
  /** Stable id for the generated fallback. Falls back to the title, which is
   *  less stable — a rename changes the artwork — so pass the row id. */
  artworkSeed?: string;
  /** Projects and playlists take different palette slices. */
  kind?: ArtworkKind;
  /** 2–4 track covers compose a grid when there's no dedicated cover. */
  previewCovers?: (string | null)[];
  /** Icon shown when no cover at all. */
  fallbackIcon?: ReactNode;
  /** Background for the fallback tile (e.g. seededGradient(id)). */
  fallbackStyle?: CSSProperties;
  /** Single quiet line under the title (count · time · tags). */
  meta?: ReactNode;
  pinned?: boolean;
  onTogglePin?: (e: React.MouseEvent) => void;
  pinBusy?: boolean;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  /** Options menu, rendered top-right over the cover. Pass a function to get
   *  `startRename`, which flips the card's title into an inline field — that is
   *  how a ⋯ menu offers Rename without owning a second editor of its own. */
  optionsMenu?: ReactNode | ((args: { startRename: () => void }) => ReactNode);
  /** Enables inline rename. Return false to keep the field open on failure. */
  onRename?: (next: string) => Promise<boolean> | boolean;
  /** Extra overlay content (play button bottom-left, count badge bottom-right…). */
  overlay?: ReactNode;
  /** Makes the card draggable onto a folder (see CollectionFolderStrip). */
  dragId?: string;
}

export function MediaCard({
  title,
  href,
  onOpen,
  coverUrl,
  artworkSeed,
  kind = 'project',
  previewCovers,
  fallbackIcon,
  fallbackStyle,
  meta,
  pinned,
  onTogglePin,
  pinBusy,
  selectMode,
  selected,
  onToggleSelect,
  optionsMenu,
  onRename,
  overlay,
  dragId,
}: MediaCardProps) {
  const covers = (previewCovers ?? []).filter(Boolean) as string[];
  const [renaming, setRenaming] = useState(false);
  const canRename = !!onRename;

  const coverBlock = (
    <div
      className={cn(
        'relative mb-2.5 aspect-square overflow-hidden rounded-xl border bg-white/[0.02] transition-all duration-200 group-hover:-translate-y-0.5',
        selected ? 'border-white/40' : 'border-white/10 group-hover:border-white/20',
      )}
    >
      {coverUrl ? (
        <img loading="lazy" src={coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : covers.length >= 2 ? (
        <div className="absolute inset-0 grid grid-cols-2 gap-px bg-white/[0.05]">
          {covers.slice(0, 4).map((url, i) => (
            <div key={`${url}-${i}`} className="overflow-hidden bg-white/[0.04]">
              <img loading="lazy" src={url} alt="" className="h-full w-full object-cover" />
            </div>
          ))}
        </div>
      ) : covers.length === 1 ? (
        <img loading="lazy" src={covers[0]} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        /* No cover and no track art to compose from: a brand gradient, keyed
           to this collection's id so two projects never look alike, and
           tinted by kind so a project reads differently from a playlist. */
        <div className="absolute inset-0">
          <ArtworkFallback seed={artworkSeed ?? title} kind={kind}>
            <span className="text-white/25">{fallbackIcon}</span>
          </ArtworkFallback>
        </div>
      )}

      {/* Bottom scrim so overlay controls + badges read over any art */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/72 to-transparent" />

      {pinned && !selectMode && onTogglePin && (
        <button
          onClick={onTogglePin}
          disabled={pinBusy}
          className="glass-play glass-play-surface absolute left-2 top-2 z-20 grid size-6 place-items-center rounded-full tap"
          title="Unpin"
        >
          <Pin size={10} fill="currentColor" />
        </button>
      )}

      {!selectMode && optionsMenu && (
        <div className="absolute right-2 top-2 z-10">
          {typeof optionsMenu === 'function'
            ? optionsMenu({ startRename: () => setRenaming(true) })
            : optionsMenu}
        </div>
      )}

      {selectMode && (
        <div
          className={cn(
            'absolute right-2 top-2 grid size-6 place-items-center rounded-lg border backdrop-blur-md',
            selected ? 'border-white/30 bg-white' : 'border-white/20 bg-black/50',
          )}
        >
          {selected && <Check size={12} className="text-black" strokeWidth={3} />}
        </div>
      )}

      {!selectMode && overlay}
    </div>
  );

  const textBlock = (
    <>
      {renaming && canRename ? (
        <InlineText
          label="Name"
          value={title}
          editing
          onEditingChange={setRenaming}
          onSave={onRename!}
          maxLength={200}
          inputClassName="text-[13px] sm:text-[14px] font-bold"
        />
      ) : (
      <h3
        className={cn(
          'truncate text-[13px] font-bold leading-tight transition-colors sm:text-[14px]',
          selected ? 'text-white' : 'text-white group-hover:text-white',
        )}
      >
        {title}
      </h3>
      )}
      {meta && (
        <div className="mt-1 flex min-w-0 items-center gap-1.5 text-meta text-white/40">
          {meta}
        </div>
      )}
    </>
  );

  if (selectMode) {
    return (
      <button type="button" onClick={onToggleSelect} className="group min-w-0 text-left">
        {coverBlock}
        {textBlock}
      </button>
    );
  }

  const dragProps = dragId && !renaming && !selectMode
    ? {
        draggable: true,
        onDragStart: (e: React.DragEvent) => {
          e.dataTransfer.setData(COLLECTION_DRAG_MIME, dragId);
          e.dataTransfer.effectAllowed = 'copyMove';
        },
      }
    : {};

  if (href && !renaming) {
    return (
      <Link href={href} onClick={onOpen} className="group block min-w-0" {...dragProps}>
        {coverBlock}
        {textBlock}
      </Link>
    );
  }

  return (
    <div className="group min-w-0" {...dragProps}>
      {coverBlock}
      {textBlock}
    </div>
  );
}
