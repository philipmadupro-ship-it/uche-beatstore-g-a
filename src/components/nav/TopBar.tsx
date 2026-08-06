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
  const [activityOpen, setActivityOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobilePanelRef = useDialogBehavior({ open: mobileOpen, onClose: () => setMobileOpen(false) });

  const group = activeGroupFor(pathname);

  // ── Notifications ──────────────────────────────────────────────
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  const fetchNotifs = async () => {
    try {
      const res = await fetch('/api/notifications');
      if (!res.ok) return;
      const j = await res.json();
      setNotifs(j.notifications ?? []);
      setUnread(j.unread ?? 0);
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

  const openNotifs = async () => {
    setNotifOpen(true);
    if (unread > 0) {
      setUnread(0);
      setNotifs((prev) => prev.map((n) => ({ ...n, read: true })));
      fetch('/api/notifications?action=read_all', { method: 'PATCH' }).catch(() => undefined);
    }
  };

  // Close on outside click
  useEffect(() => {
    if (!notifOpen) return;
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [notifOpen]);

  return (
    <>
      <header className="fixed top-0 left-0 right-0 bg-[#090907]/95 backdrop-blur-md border-b border-white/10 z-30">
        {/* ── Row 1: brand · hubs · utilities ─────────────────────── */}
        <div className="h-14 flex items-center px-4 md:px-6 gap-3 md:gap-5">
          {/* Brand */}
          <Link href="/library" className="flex items-center gap-2.5 group shrink-0">
            <div className="w-6 h-6 rounded-[6px] bg-white flex items-center justify-center">
              <span className="text-[10px] font-black text-black tracking-tighter">U2C</span>
            </div>
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

          {/* Notifications */}
          <div className="relative shrink-0" ref={notifRef}>
            <button
              onClick={openNotifs}
              className="tap w-9 h-9 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/[0.04] transition-colors relative"
              aria-label="Notifications"
              title="Notifications"
            >
              <Bell size={18} />
              {unread > 0 && (
                <span className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-[#6DC6A4] text-black text-[9px] font-black flex items-center justify-center leading-none">
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </button>

            {notifOpen && (
              <div className="absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-2rem)] bg-[#0e0c09] border border-white/10 rounded-2xl shadow-[0_24px_60px_-12px_rgba(0,0,0,0.7)] z-50 overflow-hidden">
                <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
                  <span className="text-[11px] font-mono uppercase tracking-wider text-white">Notifications</span>
                  <button
                    onClick={() => setActivityOpen(true)}
                    className="text-[9px] font-mono uppercase tracking-wider text-white/50 hover:text-white transition-colors"
                  >
                    Activity log →
                  </button>
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
                    notifs.map((n) => (
                      <div
                        key={n.id}
                        className={`flex items-start gap-3 px-4 py-3 border-b border-white/20 last:border-0 transition-colors ${n.read ? 'opacity-60' : 'bg-white/[0.04]/40'}`}
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
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

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
            className="md:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-40 animate-in fade-in duration-200"
          />
          <aside
            ref={mobilePanelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            tabIndex={-1}
            className="md:hidden fixed top-0 right-0 bottom-0 w-[min(85vw,300px)] z-50 bg-[#090907] border-l border-white/[0.06] flex flex-col animate-in slide-in-from-right duration-300 focus:outline-none"
            style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.04]">
              <span className="text-[11px] font-semibold tracking-[0.22em] uppercase text-white">
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
          aria-haspopup="true"
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
        <div className="p-1" role="menu">
          {group.items.map((it) => {
            const itemActive = isItemActive(it.href, pathname);
            const ItemIcon = it.icon;
            return (
              <Link
                key={it.href}
                href={it.href}
                role="menuitem"
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
        </div>
      )}
    </Popover>
  );
}
