'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Music } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ProductListProps {
  children: ReactNode;
  className?: string;
}

export function ProductList({ children, className }: ProductListProps) {
  return (
    <div className={cn('relative overflow-hidden rounded-[24px] border border-white/[0.08] bg-[#14110d]/80 shadow-[0_18px_52px_rgba(0,0,0,0.42)]', className)}>
      {children}
    </div>
  );
}

interface ProductListRowProps {
  href?: string;
  title: string;
  coverUrl?: string | null;
  coverFallback?: ReactNode;
  eyebrow?: ReactNode;
  meta?: ReactNode;
  tags?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  menu?: ReactNode;
  pinned?: ReactNode;
  atmosphereUrl?: string | null;
  onOpen?: () => void;
  onPress?: () => void;
  selected?: boolean;
  className?: string;
}

export function ProductListRow({
  href,
  title,
  coverUrl,
  coverFallback,
  eyebrow,
  meta,
  tags,
  status,
  actions,
  menu,
  pinned,
  atmosphereUrl,
  onOpen,
  onPress,
  selected,
  className,
}: ProductListRowProps) {
  const coverContent = (
    <>
      {coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={coverUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-[#6E685B]">
          {coverFallback ?? <Music size={17} aria-hidden="true" />}
        </div>
      )}
      {pinned && <div className="absolute left-1.5 top-1.5">{pinned}</div>}
    </>
  );

  const titleContent = (
    <>
      {eyebrow && <div className="mb-1 flex min-h-4 items-center gap-2 text-[9px] font-mono uppercase tracking-[0.18em] text-[#837B6D]">{eyebrow}</div>}
      <h3 className="truncate text-[15px] font-bold leading-tight text-[#F7EBDD] transition-colors group-hover:text-[#fff7ea] sm:text-[16px]">
        {title}
      </h3>
      {meta && <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-mono text-[#9B9282]">{meta}</div>}
    </>
  );

  return (
    <article
      className={cn(
        'group relative border-b border-white/[0.055] last:border-b-0 transition-colors hover:bg-white/[0.045]',
        selected && 'bg-white/[0.06]',
        className,
      )}
    >
      {atmosphereUrl && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-0 blur-2xl saturate-125 transition-opacity duration-500 group-hover:opacity-20"
          style={{
            backgroundImage: `url(${atmosphereUrl})`,
            backgroundPosition: 'center',
            backgroundSize: 'cover',
            transform: 'scale(1.08)',
          }}
        />
      )}
      <div className="relative grid grid-cols-[52px_minmax(0,1fr)] gap-3 px-3 py-3 sm:grid-cols-[56px_minmax(0,1.2fr)_minmax(140px,0.8fr)_auto] sm:items-center sm:gap-4 sm:px-5 sm:py-3.5">
        {href ? (
          <Link
            href={href}
            onClick={onOpen}
            className="relative size-[52px] overflow-hidden rounded-xl border border-white/[0.08] bg-[#090907] shadow-[0_10px_22px_rgba(0,0,0,0.34)] sm:size-14"
            aria-label={title}
          >
            {coverContent}
          </Link>
        ) : (
          <button
            type="button"
            onClick={onPress}
            className="relative size-[52px] overflow-hidden rounded-xl border border-white/[0.08] bg-[#090907] shadow-[0_10px_22px_rgba(0,0,0,0.34)] sm:size-14"
            aria-label={title}
          >
            {coverContent}
          </button>
        )}

        {href ? (
          <Link href={href} onClick={onOpen} className="min-w-0 self-center text-left">
            {titleContent}
          </Link>
        ) : (
          <button type="button" onClick={onPress} className="min-w-0 self-center text-left">
            {titleContent}
          </button>
        )}

        <div className="col-span-2 min-w-0 sm:col-span-1">
          {tags && <div className="flex min-w-0 flex-wrap items-center gap-1.5">{tags}</div>}
        </div>

        <div className="col-span-2 flex items-center justify-between gap-3 sm:col-span-1 sm:justify-end">
          <div className="flex min-w-0 items-center gap-2">{status}</div>
          <div className="flex shrink-0 items-center gap-2">
            {actions}
            {menu}
          </div>
        </div>
      </div>
    </article>
  );
}

interface FolderContainerCardProps {
  label: string;
  active?: boolean;
  count?: number;
  color?: string | null;
  covers?: (string | null | undefined)[];
  onClick: () => void;
  actions?: ReactNode;
}

export function FolderContainerCard({
  label,
  active,
  count,
  covers = [],
  onClick,
  actions,
}: FolderContainerCardProps) {
  const visibleCovers = (covers.filter(Boolean) as string[])
    .filter((cover, index, all) => all.indexOf(cover) === index)
    .slice(0, 4);

  return (
    <div className={cn('group relative shrink-0 transition-colors')}>
      <button type="button" onClick={onClick} className="block w-[112px] text-left sm:w-[124px]">
        <div className={cn(
          'relative mb-2 aspect-square overflow-hidden rounded-[20px] bg-[#202020] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition-transform group-hover:-translate-y-0.5',
          active && 'ring-2 ring-[#F7EBDD]/80',
        )}>
          {visibleCovers.length > 0 ? (
            <div className={cn(
              'absolute left-2.5 top-2.5 grid gap-1.5',
              visibleCovers.length === 1 ? 'grid-cols-1' : 'grid-cols-2',
            )}>
              {visibleCovers.map((cover, slot) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={`${cover}-${slot}`}
                  src={cover}
                  alt=""
                  className={cn(
                    'rounded-xl object-cover shadow-[0_8px_18px_rgba(0,0,0,0.28)]',
                    visibleCovers.length === 1 ? 'h-16 w-16 sm:h-[72px] sm:w-[72px]' : 'h-10 w-10 sm:h-11 sm:w-11',
                  )}
                />
              ))}
            </div>
          ) : (
            <div className="absolute left-2.5 top-2.5 grid grid-cols-2 gap-1.5" aria-hidden="true">
              <div className="h-10 w-10 rounded-xl bg-[#2A2926] sm:h-11 sm:w-11" />
              <div className="h-10 w-10 rounded-xl bg-[#252421] sm:h-11 sm:w-11" />
            </div>
          )}
        </div>
        <p className="truncate text-[12px] font-bold text-[#F7EBDD] sm:text-[13px]">{label}</p>
        {count != null && <p className="mt-0.5 text-[10px] text-[#837B6D]">{count} item{count === 1 ? '' : 's'}</p>}
      </button>
      {actions && <div className="absolute right-2 top-2 flex items-center gap-1">{actions}</div>}
    </div>
  );
}
