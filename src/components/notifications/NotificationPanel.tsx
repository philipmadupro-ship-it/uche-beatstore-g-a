'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  AlertTriangle, Bell, FileUp, HandHelping, Heart, ListChecks, MessageCircle, MessageSquare,
  PackageX, RotateCcw, ShieldCheck, ShoppingBag, Tag,
} from 'lucide-react';
import {
  formatFullTimestamp,
  formatRelativeTime,
  presentNotification,
  type NotificationIcon,
  type NotificationTone,
} from '@/lib/notifications/presentation';

export interface PanelNotification {
  id: string;
  kind: string;
  title: string;
  body?: string | null;
  data?: unknown;
  read: boolean;
  created_at: string;
}

const ICONS: Record<NotificationIcon, typeof Bell> = {
  'shopping-bag': ShoppingBag,
  'rotate-ccw': RotateCcw,
  'alert-triangle': AlertTriangle,
  'shield-check': ShieldCheck,
  tag: Tag,
  'package-x': PackageX,
  'message-square': MessageSquare,
  heart: Heart,
  'message-circle': MessageCircle,
  'hand-helping': HandHelping,
  'file-up': FileUp,
  'list-checks': ListChecks,
  bell: Bell,
};

/** Mint is positive only, red is refund / dispute only, amber is "needs a look". */
const TONE_CLASS: Record<NotificationTone, string> = {
  positive: 'text-[#6DC6A4]',
  danger: 'text-red-400',
  warning: 'text-[var(--warning)]',
  neutral: 'text-white/80',
};

export const PANEL_MAX_WIDTH = 320;

/** The panel's width: 320, but never wider than the viewport less a 16px gutter each side. */
export function usePanelWidth(): number {
  const [width, setWidth] = useState(PANEL_MAX_WIDTH);
  useEffect(() => {
    const update = () => setWidth(Math.max(240, Math.min(PANEL_MAX_WIDTH, window.innerWidth - 32)));
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return width;
}

interface Props {
  notifications: PanelNotification[];
  unread: number;
  hasMore: boolean;
  /** The org bell: its own rows, no store-attention row, no producer activity log. */
  orgBell: boolean;
  /** Beats listed without a cover, price, or BPM/key (producer bell only). */
  attention: number;
  /** Where a row opens. Producer rows come from the pure presentation module; org rows from the org's own links. */
  hrefFor: (n: PanelNotification) => string | null;
  onMarkRead: (ids: string[]) => void;
  onMarkAllRead: () => void;
  onOpenActivity: () => void;
  /** Close the panel and go to `href`. */
  onNavigate: (href: string) => void;
}

export function NotificationPanel({
  notifications, unread, hasMore, orgBell, attention, hrefFor, onMarkRead, onMarkAllRead, onOpenActivity, onNavigate,
}: Props) {
  const shownUnread = notifications.filter((n) => !n.read).length;
  const markAllHint = hasMore && unread > shownUnread
    ? `Marks all ${unread} unread, not just these ${notifications.length}`
    : null;

  return (
    <div className="overflow-hidden rounded-xl">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b border-white/10 px-4 py-3">
        <span className="whitespace-nowrap font-mono text-[11px] uppercase tracking-wider text-white">Notifications</span>
        <div className="flex items-center gap-3 whitespace-nowrap">
          {unread > 0 && (
            <button
              type="button"
              onClick={onMarkAllRead}
              title={markAllHint ?? undefined}
              className="whitespace-nowrap font-mono text-[10px] uppercase tracking-wider text-white/50 transition-colors hover:text-white"
            >
              Mark all read
            </button>
          )}
          {!orgBell && (
            <button
              type="button"
              onClick={onOpenActivity}
              className="whitespace-nowrap font-mono text-[10px] uppercase tracking-wider text-white/50 transition-colors hover:text-white"
            >
              Activity log →
            </button>
          )}
        </div>
      </div>
      {markAllHint && unread > 0 && (
        <p className="border-b border-white/10 px-4 py-1.5 text-[10px] leading-snug text-white/40">{markAllHint}</p>
      )}
      <ul className="max-h-[min(30rem,calc(100vh-8rem))] overflow-y-auto">
        {!orgBell && attention > 0 && (
          <li className="border-b border-white/10">
            <Link
              href="/store-editor"
              onClick={() => onNavigate('/store-editor')}
              className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-white/[0.03]"
            >
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.05]">
                <AlertTriangle size={13} className="text-[var(--warning)]" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] font-medium leading-tight text-white">
                  {attention} beat{attention === 1 ? '' : 's'} need attention
                </span>
                <span className="mt-0.5 block text-[10px] leading-snug text-white/60">
                  Listed without a cover, price, or BPM and key
                </span>
              </span>
            </Link>
          </li>
        )}
        {notifications.length === 0 && (orgBell || attention === 0) ? (
          <li className="px-4 py-8 text-center text-[11px] text-white/50">No notifications yet</li>
        ) : (
          notifications.map((n) => (
            <PanelRow
              key={n.id}
              n={n}
              href={hrefFor(n)}
              onMarkRead={onMarkRead}
              onNavigate={onNavigate}
            />
          ))
        )}
      </ul>
      {hasMore && orgBell && (
        <p className="border-t border-white/10 px-4 py-2.5 text-center font-mono text-[10px] uppercase tracking-wider text-white/40">
          Showing the latest 20
        </p>
      )}
      {hasMore && !orgBell && (
        <button
          type="button"
          onClick={onOpenActivity}
          className="block w-full border-t border-white/10 px-4 py-2.5 text-center font-mono text-[10px] uppercase tracking-wider text-white/50 transition-colors hover:bg-white/[0.04] hover:text-white"
        >
          Showing the latest 20 — open activity log →
        </button>
      )}
    </div>
  );
}

function PanelRow({ n, href, onMarkRead, onNavigate }: {
  n: PanelNotification;
  href: string | null;
  onMarkRead: (ids: string[]) => void;
  onNavigate: (href: string) => void;
}) {
  const p = presentNotification(n);
  const Icon = ICONS[p.icon];
  const full = formatFullTimestamp(n.created_at);

  // The row's visible text is its accessible name; "unread" and the action are
  // appended as screen-reader-only text rather than replacing it.
  const content = (
    <>
      <span
        className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.05] ${TONE_CLASS[p.tone]}`}
        aria-hidden
      >
        <Icon size={13} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">
            {!n.read && <span className="sr-only">Unread. </span>}
            {p.label}
          </span>
          <time dateTime={n.created_at} title={full} className="shrink-0 font-mono text-[10px] text-white/40">
            {formatRelativeTime(n.created_at)}
            <span className="sr-only">, {full}</span>
          </time>
        </span>
        <span className="mt-0.5 line-clamp-2 break-words text-[11px] font-medium leading-tight text-white" title={n.title}>{n.title}</span>
        {n.body && (
          <span className="mt-0.5 line-clamp-2 break-words text-[10px] leading-snug text-white/60">{n.body}</span>
        )}
        {!n.read && !href && <span className="sr-only">Activate to mark read.</span>}
      </span>
      {!n.read && <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-white/80" />}
    </>
  );

  const cls = `flex w-full items-start gap-3 px-4 py-3 text-left transition-colors ${
    n.read ? 'opacity-60 hover:opacity-100' : 'bg-white/[0.04] hover:bg-white/[0.07]'
  }`;

  return (
    <li className="border-b border-white/10 last:border-0">
      {href ? (
        <button
          type="button"
          className={cls}
          onClick={() => {
            // Opening a row is reading it.
            if (!n.read) onMarkRead([n.id]);
            onNavigate(href);
          }}
        >
          {content}
        </button>
      ) : n.read ? (
        <div className={cls}>{content}</div>
      ) : (
        <button type="button" className={cls} onClick={() => onMarkRead([n.id])}>
          {content}
        </button>
      )}
    </li>
  );
}
