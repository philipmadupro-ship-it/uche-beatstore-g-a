'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect, useRef } from 'react';
import {
  Settings,
  Store,
  ChevronDown,
  Search,
  Bell,
  Menu,
  X,
  User,
  ShoppingBag,
  RotateCcw,
  AlertTriangle,
  Tag,
} from 'lucide-react';
import { useCommandPalette } from '@/hooks/useCommandPalette';
import { NAV_GROUPS, ALL_GROUPS, activeGroupFor, isItemActive, type NavGroup } from './model';
import { Popover } from '@/components/ui/Popover';
import { ActivityPanel } from '@/components/activity/ActivityPanel';
import { useRealtimeTable } from '@/hooks/useRealtimeTable';
import { useDialogBehavior } from '@/hooks/useDialogBehavior';
import { cn } from '@/lib/utils';
import { useBrandArtwork } from '@/hooks/useBrandArtwork';
import { planMarkAllRead, planMarkRead } from '@/lib/notifications/read-state';
import {
  desktopNotificationsActive,
  selectDesktopNotifications,
  summarizeBurst,
} from '@/lib/notifications/desktop';

interface Notification {
  id: string;
  kind: string;
  title: string;
  body?: string | null;
  read: boolean;
  created_at: string;
}

function notifIcon(kind: string) {
  if (kind === 'purchase') return <ShoppingBag size={13} className="text-[#6DC6A4]" />;
  if (kind === 'refund') return <RotateCcw size={13} className="text-white" />;
  if (kind === 'dispute') return <AlertTriangle size={13} className="text-red-400" />;
  if (kind === 'buyer_offer') return <Tag size={13} className="text-white" />;
  return <Bell size={13} className="text-white/60" />;
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function TopBar() {
  const pathname = usePathname();
  const openPalette = useCommandPalette((s) => s.setOpen);
  const { logoUrl } = useBrandArtwork();
  const [activityOpen, setActivityOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobilePanelRef = useDialogBehavior({ open: mobileOpen, onClose: () => setMobileOpen(false) });

  const group = activeGroupFor(pathname);

  // ── Notifications ──────────────────────────────────────────────
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  /** The panel renders a page of rows; the badge counts every unread row. */
  const [hasMore, setHasMore] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);

  /**
   * Ids already handed to the OS, and whether we have completed a first fetch.
   *
   * Refs, not state: changing them must not re-render the whole top bar, and
   * they have to be readable by the very next poll rather than after React
   * flushes.
   */
  const desktopSeen = useRef<Set<string>>(new Set());
  const desktopPrimed = useRef(false);

  const fetchNotifs = async () => {
    try {
      const res = await fetch('/api/notifications');
      if (!res.ok) return;
      const j = await res.json();
      const rows: Notification[] = j.notifications ?? [];
      setNotifs(rows);
      setUnread(j.unread ?? 0);
      setHasMore(Boolean(j.hasMore));

      // Tell the operating system about anything new. The first pass through
      // here is priming: it records what already existed without firing, so
      // opening the app does not detonate the whole table at once.
      const picked = selectDesktopNotifications(rows, {
        seen: desktopSeen.current,
        primed: desktopPrimed.current,
      });
      desktopSeen.current = picked.seen;
      desktopPrimed.current = true;

      if (picked.fire.length > 0 && desktopNotificationsActive()) {
        for (const item of summarizeBurst(picked.fire)) {
          try {
            new window.Notification(item.title, {
              body: item.body ?? undefined,
              // Collapses repeats of the same row rather than stacking them.
              tag: item.id,
              // The only icon this project ships. Some platforms ignore SVG
              // here and fall back to the browser's own mark, which is fine —
              // a missing icon must not stop the alert.
              icon: '/icon.svg',
            });
          } catch {/* the OS refused it; not worth breaking the poll over */}
        }
      }
    } catch {/* silent */}
  };

  // ── Store attention ────────────────────────────────────────────
  // Listed beats missing a cover, a price, or BPM/key. This used to be a chip
  // on the library page; it belongs with the other things demanding the
  // producer's attention. Server-computed via /api/tracks/store-summary so we
  // don't pull the whole catalogue into the nav just to count three fields.
  //
  // Deliberately NOT added to `unread`: that badge is backed by the
  // notifications table and is cleared by marking rows read. A derived count
  // has nothing to mark, so folding it in would leave a badge that can never
  // be dismissed.
  const [attention, setAttention] = useState(0);

  const fetchAttention = async () => {
    try {
      const res = await fetch('/api/tracks/store-summary');
      if (!res.ok) return;
      const j = await res.json();
      const i = j?.issues ?? {};
      setAttention(
        (i.noCover?.count ?? 0) + (i.noPrice?.count ?? 0) + (i.noBpmKey?.count ?? 0),
      );
    } catch {/* silent */}
  };

  useEffect(() => {
    const id = window.setTimeout(() => {
      void fetchNotifs();
      void fetchAttention();
    }, 0);
    return () => window.clearTimeout(id);
  }, []);
  // 60-second polling fallback in case the realtime subscription doesn't fire
  // (e.g. the notifications table isn't in the realtime publication yet).
  useEffect(() => {
    const id = setInterval(fetchNotifs, 60_000);
    return () => clearInterval(id);
  }, []);

  useRealtimeTable({
    table: 'notifications',
    onChange: fetchNotifs,
  });

  /**
   * Reading is something the producer does to a notification, not something
   * that happens because a panel rendered.
   *
   * Opening the bell used to fire `read_all`, so glancing at the panel cleared
   * everything in it — open it to check one sale and the other nineteen rows
   * were silently marked read and gone from the badge, whether or not they had
   * been scrolled to. Now nothing changes on open; a row is marked when it is
   * clicked, and clearing the lot is a button you press on purpose.
   */
  const markRead = (ids: string[]) => {
    const plan = planMarkRead(notifs, unread, ids);
    if (!plan.changed) return;
    setNotifs(plan.next);
    setUnread(plan.unread);
    fetch('/api/notifications?action=read', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: plan.ids }),
    }).catch(() => undefined);
  };

  const markAllRead = () => {
    const plan = planMarkAllRead(notifs, unread);
    if (!plan.changed) return;
    setNotifs(plan.next);
    setUnread(plan.unread);
    fetch('/api/notifications?action=read_all', { method: 'PATCH' }).catch(() => undefined);
  };

  return (
    <>
      <header className="fixed top-0 left-0 right-0 bg-[#090907]/95 backdrop-blur-md border-b border-white/10 z-30">
        {/* ── Row 1: brand · hubs · utilities ─────────────────────── */}
        <div className="h-14 flex items-center px-4 md:px-6 gap-3 md:gap-5">
          {/* Brand — the producer's logo when they have set one. Contained
              rather than covered: a wide wordmark cropped to fill loses its
              ends, and this is the one place the mark has to stay legible at
              24px. */}
          <Link href="/library" className="flex items-center gap-2.5 group shrink-0">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt=""
                className="h-7 w-7 rounded-[6px] object-contain"
              />
            ) : (
              <div className="w-6 h-6 rounded-[6px] bg-white flex items-center justify-center">
                <span className="text-[10px] font-black text-black tracking-tighter">U2C</span>
              </div>
            )}
            <span className="text-[11px] font-semibold tracking-[0.22em] uppercase text-white/90 group-hover:text-white hidden lg:inline">
              u2c beatstore
            </span>
          </Link>

          {/* Primary hubs — each opens its surfaces as a dropdown, so every
              destination is one click from a single row. This is what replaced
              the permanent second row of sub-tabs. */}
          <nav className="hidden md:flex items-center gap-1 flex-1">
            {NAV_GROUPS.map((g) => (
              <HubMenu key={g.key} group={g} active={group.key === g.key} pathname={pathname} />
            ))}
          </nav>

          {/* Spacer on mobile so the right cluster hugs the edge */}
          <div className="flex-1 md:hidden" />

          {/* Search (⌘K) — desktop */}
          <button
            onClick={() => openPalette(true)}
            className="hidden md:flex items-center gap-2 w-48 lg:w-56 bg-white/[0.04] border border-white/10 rounded-md py-1.5 px-3 text-[11px] text-white/60 hover:border-white/20 hover:text-white transition-colors shrink-0"
            title="Search (⌘K)"
          >
            <Search size={14} />
            <span className="flex-1 text-left">Search</span>
            <kbd className="text-[9px] font-mono border border-white/10 rounded px-1 py-0.5">⌘K</kbd>
          </button>

          {/* Search icon — mobile (opens ⌘K palette) */}
          <button
            onClick={() => openPalette(true)}
            className="tap md:hidden w-10 h-10 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/[0.04] transition-colors"
            aria-label="Search"
          >
            <Search size={19} />
          </button>

          {/* Notifications — the panel was `absolute`, alone among the app's
              overlays, so it clipped inside any ancestor with overflow or a
              backdrop-blur stacking context. `ui/Popover` portals to <body>,
              positions with viewport rect coords, clamps to the screen, and
              already closes on Escape and outside click. */}
          <Popover
            width={320}
            align="right"
            open={notifOpen}
            onOpenChange={setNotifOpen}
            trigger={({ open, toggle, ref }) => (
              <button
                ref={ref as (el: HTMLButtonElement | null) => void}
                onClick={toggle}
                aria-expanded={open}
                aria-haspopup="dialog"
                className="tap w-9 h-9 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/[0.04] transition-colors relative shrink-0"
                aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
                title="Notifications"
              >
                <Bell size={18} />
                {unread > 0 && (
                  <span className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-[#6DC6A4] text-black text-[9px] font-black flex items-center justify-center leading-none">
                    {unread > 9 ? '9+' : unread}
                  </span>
                )}
              </button>
            )}
          >
              <div className="overflow-hidden rounded-xl">
                <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between gap-2">
                  <span className="text-[11px] font-mono uppercase tracking-wider text-white">Notifications</span>
                  <div className="flex items-center gap-3">
                    {unread > 0 && (
                      <button
                        onClick={markAllRead}
                        className="text-[9px] font-mono uppercase tracking-wider text-white/50 hover:text-white transition-colors"
                      >
                        Mark all read
                      </button>
                    )}
                    <button
                      onClick={() => setActivityOpen(true)}
                      className="text-[9px] font-mono uppercase tracking-wider text-white/50 hover:text-white transition-colors"
                    >
                      Activity log →
                    </button>
                  </div>
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {attention > 0 && (
                    <Link
                      href="/store-editor"
                      onClick={() => setNotifOpen(false)}
                      className="flex items-start gap-3 border-b border-white/20 px-4 py-3 transition-colors hover:bg-white/[0.03]"
                    >
                      <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg border border-white/20 bg-white/[0.05]">
                        <AlertTriangle size={13} className="text-white" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-medium leading-tight text-white">
                          {attention} beat{attention === 1 ? '' : 's'} need attention
                        </p>
                        <p className="mt-0.5 text-[10px] leading-snug text-white/60">
                          Listed without a cover, price, or BPM and key
                        </p>
                      </div>
                    </Link>
                  )}
                  {notifs.length === 0 && attention === 0 ? (
                    <div className="px-4 py-8 text-center text-[11px] text-white/50">
                      No notifications yet
                    </div>
                  ) : (
                    notifs.map((n) => {
                      // An unread row is the button that reads it; a read one
                      // has nothing left to do, so it stays inert rather than
                      // offering a click that changes nothing.
                      const Row = n.read ? 'div' : 'button';
                      return (
                        <Row
                          key={n.id}
                          {...(n.read
                            ? {}
                            : {
                                type: 'button' as const,
                                onClick: () => markRead([n.id]),
                                'aria-label': `Mark "${n.title}" read`,
                              })}
                          className={`flex w-full items-start gap-3 px-4 py-3 text-left border-b border-white/20 last:border-0 transition-colors ${
                            n.read ? 'opacity-60' : 'bg-white/[0.04] hover:bg-white/[0.07]'
                          }`}
                        >
                          <div className="w-6 h-6 rounded-lg bg-white/[0.05] border border-white/20 flex items-center justify-center shrink-0 mt-0.5">
                            {notifIcon(n.kind)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[11px] font-medium text-white leading-tight">{n.title}</p>
                            {n.body && <p className="text-[10px] text-white/60 mt-0.5 leading-snug">{n.body}</p>}
                            <p className="text-[9px] font-mono text-white/40 mt-1">{timeAgo(n.created_at)}</p>
                          </div>
                          {!n.read && <div className="w-1.5 h-1.5 rounded-full bg-[#6DC6A4] shrink-0 mt-1.5" />}
                        </Row>
                      );
                    })
                  )}
                </div>
                {hasMore && (
                  <button
                    onClick={() => { setNotifOpen(false); setActivityOpen(true); }}
                    className="block w-full border-t border-white/10 px-4 py-2.5 text-center text-[9px] font-mono uppercase tracking-wider text-white/50 transition-colors hover:bg-white/[0.04] hover:text-white"
                  >
                    Showing the latest 20 — open activity log →
                  </button>
                )}
              </div>
          </Popover>

          {/* View public storefront */}
          <Link
            href="/store"
            target="_blank"
            rel="noopener noreferrer"
            title="View public storefront"
            aria-label="View public storefront"
            className="tap hidden md:flex w-9 h-9 rounded-full items-center justify-center text-white/60 hover:text-white hover:bg-white/[0.04] transition-colors shrink-0"
          >
            <Store size={17} />
          </Link>

          {/* Settings */}
          <Link
            href="/settings"
            aria-label="Open settings"
            title="Settings"
            aria-current={isItemActive('/settings', pathname) ? 'page' : undefined}
            className={cn(
              'tap hidden md:flex w-9 h-9 rounded-full items-center justify-center transition-colors shrink-0',
              isItemActive('/settings', pathname)
                ? 'bg-[#0D0D0A] text-white'
                : 'text-white/60 hover:text-white hover:bg-white/[0.04]',
            )}
          >
            <Settings size={17} />
          </Link>

          {/* Mobile menu — on the right, because that is the edge the drawer
              slides in from. A left-hand control opening a right-hand panel
              reads as a mistake every time. */}
          <button
            onClick={() => setMobileOpen(true)}
            className="tap md:hidden w-10 h-10 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/[0.04] transition-colors order-last"
            aria-label="Open navigation menu"
          >
            <Menu size={22} />
          </button>

          {/* Profile */}
          <Link
            href="/profile"
            aria-label="Creator profile"
            title="Profile"
            aria-current={isItemActive('/profile', pathname) ? 'page' : undefined}
            className={cn(
              'tap flex items-center justify-center shrink-0 w-9 h-9 rounded-full transition-colors',
              isItemActive('/profile', pathname)
                ? 'bg-white/20 border border-white/40'
                : 'bg-white/[0.05] border border-white/20 hover:border-white/30',
            )}
          >
            <User size={16} className={isItemActive('/profile', pathname) ? 'text-white' : 'text-white/60'} />
          </Link>
        </div>

      </header>

      {/* ── Mobile drawer — grouped by hub ──────────────────────── */}
      {mobileOpen && (
        <>
          <div
            onClick={() => setMobileOpen(false)}
 className="md:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-40 ui-fade-in duration-200"
          />
          <aside
            ref={mobilePanelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            tabIndex={-1}
 className="md:hidden fixed top-0 right-0 bottom-0 w-[min(85vw,300px)] z-50 bg-[#090907] border-l border-white/[0.06] flex flex-col ui-drawer-right duration-300 focus:outline-none"
            style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.04]">
              <span className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.22em] uppercase text-white">
                {logoUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logoUrl} alt="" className="h-6 w-6 rounded-[5px] object-contain" />
                )}
                U2C Beatstore
              </span>
              <button
                onClick={() => setMobileOpen(false)}
                className="tap w-9 h-9 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/[0.04] transition-colors"
                aria-label="Close menu"
              >
                <X size={19} />
              </button>
            </div>
            <nav className="flex-1 px-3 py-4 overflow-y-auto">
              {ALL_GROUPS.map((g) => (
                <div key={g.key} className="mb-4 last:mb-0">
                  <p className="px-3 mb-1.5 text-[9px] font-mono uppercase tracking-[0.2em] text-white/50 flex items-center gap-1.5">
                    <g.icon size={14} />
                    {g.label}
                  </p>
                  <div className="space-y-0.5">
                    {g.items.map((it) => {
                      const active = isItemActive(it.href, pathname);
                      const Icon = it.icon;
                      return (
                        <Link
                          key={it.href}
                          href={it.href}
                          onClick={() => setMobileOpen(false)}
                          aria-current={active ? 'page' : undefined}
                          className={cn(
                            'flex items-center gap-3 px-3 py-2.5 rounded-md text-[13px] transition-colors',
                            active
                              ? 'bg-[#0D0D0A] text-white'
                              : 'text-white/60 hover:text-white hover:bg-white/[0.04]',
                          )}
                        >
                          <Icon size={19} strokeWidth={1.75} />
                          <span className="font-medium tracking-tight">{it.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </nav>
          </aside>
        </>
      )}

      <ActivityPanel open={activityOpen} onClose={() => setActivityOpen(false)} />
    </>
  );
}

/**
 * One primary hub, rendered as a dropdown of its surfaces.
 *
 * Replaces the second fixed nav row. That row showed the active hub's
 * surfaces permanently — 44px of chrome on every page to serve the moment you
 * actually change surface. As a menu, every destination stays one click away
 * while costing nothing at rest.
 *
 * The trigger navigates as well as opens: clicking "Catalog" goes to the
 * hub's first surface, so the common case (switch hub, take the default page)
 * is still a single click and does not require aiming at a menu item.
 */
function HubMenu({ group, active, pathname }: { group: NavGroup; active: boolean; pathname: string }) {
  const Icon = group.icon;

  return (
    <Popover
      width={216}
      trigger={({ open, toggle, ref }) => (
        <button
          ref={ref as (el: HTMLButtonElement | null) => void}
          onClick={toggle}
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-current={active ? 'page' : undefined}
          className={cn(
            'flex items-center gap-2 rounded-lg px-3.5 py-2 text-[13px] font-medium tracking-tight transition-colors',
            active || open
              ? 'bg-[#0D0D0A] text-white'
              : 'text-white/60 hover:bg-[#101010] hover:text-white',
          )}
        >
          <Icon size={18} strokeWidth={1.75} />
          <span>{group.label}</span>
          <ChevronDown
            size={13}
            aria-hidden
            className={cn('transition-transform duration-[var(--dur-fast)]', open ? 'rotate-180' : '')}
          />
        </button>
      )}
    >
      {(close) => (
        /* A list of destinations, not a command menu. It used to declare
           role="menu" with role="menuitem" links, which tells a screen reader
           to expect arrow-key navigation this popover never implemented —
           and the ARIA menu pattern is for application commands, not links.
           A labelled nav list keeps Tab working the way links already do. */
        <nav className="p-1" aria-label={`${group.label} pages`}>
          {group.items.map((it) => {
            const itemActive = isItemActive(it.href, pathname);
            const ItemIcon = it.icon;
            return (
              <Link
                key={it.href}
                href={it.href}
                onClick={close}
                aria-current={itemActive ? 'page' : undefined}
                className={cn(
                  'tap flex min-h-10 items-center gap-3 rounded-lg px-2.5 text-[13px] font-medium tracking-tight transition-colors',
                  itemActive ? 'bg-[#0D0D0A] text-white' : 'text-white/65 hover:bg-white/[0.06] hover:text-white',
                )}
              >
                <ItemIcon size={17} strokeWidth={1.75} className="shrink-0" />
                <span className="truncate">{it.label}</span>
              </Link>
            );
          })}
        </nav>
      )}
    </Popover>
  );
}
