'use client';

import Link from 'next/link';
import { Check, Pin } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CSSProperties, ReactNode } from 'react';

/**
 * Shared cover-art grid card for Projects + Playlists (and future
 * media collections). One visual language: bordered rounded-2xl cover,
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
  /** Options menu node, rendered top-right over the cover. */
  optionsMenu?: ReactNode;
  /** Extra overlay content (play button bottom-left, count badge bottom-right…). */
  overlay?: ReactNode;
}

export function MediaCard({
  title,
  href,
  onOpen,
  coverUrl,
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
  overlay,
}: MediaCardProps) {
  const covers = (previewCovers ?? []).filter(Boolean) as string[];

  const coverBlock = (
    <div
      className={cn(
        'relative mb-2.5 aspect-square overflow-hidden rounded-xl border bg-[#11100D] transition-all duration-200 group-hover:-translate-y-0.5 sm:rounded-2xl',
        selected ? 'border-[#E7D7BE]/60' : 'border-[#211F1A] group-hover:border-[#3B372F]',
      )}
    >
      {coverUrl ? (
        <img loading="lazy" src={coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : covers.length >= 2 ? (
        <div className="absolute inset-0 grid grid-cols-2 gap-px bg-[#211F1A]">
          {covers.slice(0, 4).map((url, i) => (
            <div key={`${url}-${i}`} className="overflow-hidden bg-[#171511]">
              <img loading="lazy" src={url} alt="" className="h-full w-full object-cover" />
            </div>
          ))}
        </div>
      ) : covers.length === 1 ? (
        <img loading="lazy" src={covers[0]} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center" style={fallbackStyle}>
          <span className="text-white/15">{fallbackIcon}</span>
        </div>
      )}

      {/* Bottom scrim so overlay controls + badges read over any art */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/72 to-transparent" />

      {pinned && !selectMode && onTogglePin && (
        <button
          onClick={onTogglePin}
          disabled={pinBusy}
          className="absolute left-2 top-2 z-20 grid size-6 place-items-center rounded-full bg-[#E7D7BE] text-black shadow-sm tap"
          title="Unpin"
        >
          <Pin size={10} fill="currentColor" />
        </button>
      )}

      {!selectMode && optionsMenu && (
        <div className="absolute right-2 top-2 z-10">{optionsMenu}</div>
      )}

      {selectMode && (
        <div
          className={cn(
            'absolute right-2 top-2 grid size-6 place-items-center rounded-md border backdrop-blur-md',
            selected ? 'border-[#F3E6D1] bg-[#E7D7BE]' : 'border-white/20 bg-black/50',
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
      <h3
        className={cn(
          'truncate text-[13px] font-bold leading-tight transition-colors sm:text-[15px]',
          selected ? 'text-white' : 'text-[#F7EBDD] group-hover:text-white',
        )}
      >
        {title}
      </h3>
      {meta && (
        <div className="mt-1 flex min-w-0 items-center gap-1.5 text-meta text-[#837B6D]">
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

  if (href) {
    return (
      <Link href={href} onClick={onOpen} className="group block min-w-0">
        {coverBlock}
        {textBlock}
      </Link>
    );
  }

  return (
    <div className="group min-w-0">
      {coverBlock}
      {textBlock}
    </div>
  );
}
