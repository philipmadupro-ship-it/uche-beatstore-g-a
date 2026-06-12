'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect, useRef } from 'react';
import {
  Home,
  Layers,
  ListMusic,
  Users,
  Calendar,
  Link2,
  Settings,
  Search,
  Sliders,
  CloudOff,
  Bell,
  Menu,
  X,
  User,
  Store,
  ExternalLink,
  ShoppingBag,
  RotateCcw,
  AlertTriangle,
  Tag,
  Library,
  BarChart3,
  Send,
} from 'lucide-react';
import { useCommandPalette } from '@/hooks/useCommandPalette';
import { ActivityPanel } from '@/components/activity/ActivityPanel';
import { useRealtimeTable } from '@/hooks/useRealtimeTable';
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
  if (kind === 'refund') return <RotateCcw size={13} className="text-[#D6BE7A]" />;
  if (kind === 'dispute') return <AlertTriangle size={13} className="text-red-400" />;
  if (kind === 'buyer_offer') return <Tag size={13} className="text-[#E7D7BE]" />;
  return <Bell size={13} className="text-[#D0C3AF]" />;
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

/**
 * Navigation model — Spotify-style hubs.
 *
 * The 12+ dashboard surfaces are grouped into 3 primary HUBS (Catalog / Store
 * / CRM) plus an Account group reached via the avatar. Routes are unchanged —
 * this is purely how the nav is presented:
 *   - Row 1 (desktop): the 3 hub buttons. Clicking a hub goes to its first
 *     surface. The hub you're in is highlighted.
 *   - Row 2: the active hub's surfaces as sub-tabs (the "you're in Catalog,
 *     here's what's in it" strip). Works on mobile as a scroll row.
 *   - Mobile: hub switching happens in the drawer (grouped with headers);
 *     sub-tab switching happens in Row 2.
 *
 * Collapsing a scrolling row of 9 into 3 destinations is the whole point —
 * "you always know where you are."
 */
interface NavItem { label: string; href: string; icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>; }
interface NavGroup { key: string; label: string; icon: NavItem['icon']; items: NavItem[]; }

const NAV_GROUPS: NavGroup[] = [
  {
    key: 'catalog', label: 'Catalog', icon: Library,
    items: [
      { label: 'Library', href: '/library', icon: Home },
      { label: 'Projects', href: '/projects', icon: Layers },
      { label: 'Playlists', href: '/playlists', icon: ListMusic },
      { label: 'Studio', href: '/studio', icon: Sliders },
      { label: 'Offline', href: '/offline', icon: CloudOff },
    ],
  },
  {
    key: 'store', label: 'Store', icon: Store,
    items: [
      { label: 'Editor', href: '/store-editor', icon: Store },
      { label: 'Sales', href: '/sales', icon: ShoppingBag },
      { label: 'Analytics', href: '/analytics', icon: BarChart3 },
    ],
  },
  {
    key: 'crm', label: 'CRM', icon: Users,
    items: [
      { label: 'Contacts', href: '/contacts', icon: Users },
      { label: 'Campaigns', href: '/campaigns', icon: Send },
      { label: 'Calendar', href: '/calendar', icon: Calendar },
      { label: 'Links', href: '/links', icon: Link2 },
    ],
  },
];

// Reached via the avatar (not a primary hub button), but still a valid group
// so the sub-tab strip stays populated on /profile and /settings.
const ACCOUNT_GROUP: NavGroup = {
  key: 'account', label: 'Account', icon: User,
  items: [
    { label: 'Profile', href: '/profile', icon: User },
    { label: 'Settings', href: '/settings', icon: Settings },
  ],
};

const ALL_GROUPS = [...NAV_GROUPS, ACCOUNT_GROUP];

function isItemActive(href: string, pathname: string): boolean {
  return pathname === href || pathname.startsWith(href + '/');
}

function activeGroupFor(pathname: string): NavGroup {
  return ALL_GROUPS.find((g) => g.items.some((it) => isItemActive(it.href, pathname))) ?? NAV_GROUPS[0];
}

export function TopBar() {
  const pathname = usePathname();
  const openPalette = useCommandPalette((s) => s.setOpen);
  const [activityOpen, setActivityOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => { setMobileOpen(false); }, [pathname]);

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

  useEffect(() => { fetchNotifs(); }, []);
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
      <header className="fixed top-0 left-0 right-0 bg-[#090907]/95 backdrop-blur-md border-b border-[#211F1A] z-30">
        {/* ── Row 1: brand · hubs · utilities ─────────────────────── */}
        <div className="h-14 flex items-center px-4 md:px-6 gap-3 md:gap-5">
          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileOpen(true)}
            className="tap md:hidden w-9 h-9 rounded-md flex items-center justify-center text-[#D0C3AF] hover:text-white hover:bg-white/[0.04] transition-colors"
            aria-label="Open navigation menu"
          >
            <Menu size={18} />
          </button>

          {/* Brand */}
          <Link href="/library" className="flex items-center gap-2.5 group shrink-0">
            <div className="w-6 h-6 rounded-[6px] bg-[#F7EBDD] flex items-center justify-center">
              <span className="text-[10px] font-black text-black tracking-tighter">U2C</span>
            </div>
            <span className="text-[11px] font-semibold tracking-[0.22em] uppercase text-[#F7EBDD] group-hover:text-white hidden lg:inline">
              u2c beatstore
            </span>
          </Link>

          {/* Primary hubs — desktop only (mobile switches hubs via drawer) */}
          <nav className="hidden md:flex items-center gap-1 flex-1">
            {NAV_GROUPS.map((g) => {
              const active = group.key === g.key;
              const Icon = g.icon;
              return (
                <Link
                  key={g.key}
                  href={g.items[0].href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-2 px-3.5 py-2 rounded-lg text-[13px] font-medium tracking-tight transition-colors',
                    active
                      ? 'bg-[#1A1813] text-white'
                      : 'text-[#B4AA99] hover:text-[#F7EBDD] hover:bg-[#101010]',
                  )}
                >
                  <Icon size={15} strokeWidth={1.75} />
                  <span>{g.label}</span>
                </Link>
              );
            })}
          </nav>

          {/* Spacer on mobile so the right cluster hugs the edge */}
          <div className="flex-1 md:hidden" />

          {/* Search (⌘K) — desktop */}
          <button
            onClick={() => openPalette(true)}
            className="hidden md:flex items-center gap-2 w-48 lg:w-56 bg-[#171511] border border-[#211F1A] rounded-md py-1.5 px-3 text-[11px] text-[#B4AA99] hover:border-[#3B372F] hover:text-[#D0C3AF] transition-colors shrink-0"
            title="Search (⌘K)"
          >
            <Search size={12} />
            <span className="flex-1 text-left">Search</span>
            <kbd className="text-[9px] font-mono border border-[#211F1A] rounded px-1 py-0.5">⌘K</kbd>
          </button>

          {/* Search icon — mobile (opens ⌘K palette) */}
          <button
            onClick={() => openPalette(true)}
            className="tap md:hidden w-9 h-9 rounded-full flex items-center justify-center text-[#D0C3AF] hover:text-white hover:bg-white/[0.04] transition-colors"
            aria-label="Search"
          >
            <Search size={16} />
          </button>

          {/* View public storefront */}
          <Link
            href="/store"
            target="_blank"
            rel="noopener noreferrer"
            title="View public storefront"
            className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-mono uppercase tracking-wider text-[#B4AA99] hover:text-[#E7D7BE] hover:bg-[#1A1813] border border-transparent hover:border-[#2B2821] transition-all shrink-0"
          >
            <Store size={11} />
            <span>Store</span>
            <ExternalLink size={9} className="opacity-60" />
          </Link>

          {/* Notifications */}
          <div className="relative shrink-0" ref={notifRef}>
            <button
              onClick={openNotifs}
              className="tap w-9 h-9 rounded-full flex items-center justify-center text-[#D0C3AF] hover:text-white hover:bg-white/[0.04] transition-colors relative"
              aria-label="Notifications"
              title="Notifications"
            >
              <Bell size={15} />
              {unread > 0 && (
                <span className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-[#6DC6A4] text-black text-[8px] font-black flex items-center justify-center leading-none">
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </button>

            {notifOpen && (
              <div className="absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-2rem)] bg-[#0e0c09] border border-[#2B2821] rounded-2xl shadow-2xl z-50 overflow-hidden">
                <div className="px-4 py-3 border-b border-[#211F1A] flex items-center justify-between">
                  <span className="text-[11px] font-mono uppercase tracking-wider text-[#D0C3AF]">Notifications</span>
                  <button
                    onClick={() => setActivityOpen(true)}
                    className="text-[9px] font-mono uppercase tracking-wider text-[#B4AA99] hover:text-[#D0C3AF] transition-colors"
                  >
                    Activity log →
                  </button>
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {notifs.length === 0 ? (
                    <div className="px-4 py-8 text-center text-[11px] text-[#B4AA99]">
                      No notifications yet
                    </div>
                  ) : (
                    notifs.map((n) => (
                      <div
                        key={n.id}
                        className={`flex items-start gap-3 px-4 py-3 border-b border-[#211F1A]/60 last:border-0 transition-colors ${n.read ? 'opacity-60' : 'bg-[#171511]/40'}`}
                      >
                        <div className="w-6 h-6 rounded-lg bg-[#211F1A] border border-[#3B372F] flex items-center justify-center shrink-0 mt-0.5">
                          {notifIcon(n.kind)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[12px] font-medium text-[#F7EBDD] leading-tight">{n.title}</p>
                          {n.body && <p className="text-[10px] text-[#8a7a5c] mt-0.5 leading-snug">{n.body}</p>}
                          <p className="text-[9px] font-mono text-[#B4AA99] mt-1">{timeAgo(n.created_at)}</p>
                        </div>
                        {!n.read && <div className="w-1.5 h-1.5 rounded-full bg-[#6DC6A4] shrink-0 mt-1.5" />}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Settings — desktop */}
          <Link
            href="/settings"
            aria-label="Open settings"
            title="Settings"
            aria-current={isItemActive('/settings', pathname) ? 'page' : undefined}
            className={cn(
              'tap hidden md:flex w-9 h-9 rounded-full items-center justify-center transition-colors shrink-0',
              isItemActive('/settings', pathname)
                ? 'bg-[#1A1813] text-white'
                : 'text-[#D0C3AF] hover:text-white hover:bg-white/[0.04]',
            )}
          >
            <Settings size={15} />
          </Link>

          {/* Profile */}
          <Link
            href="/profile"
            aria-label="Creator profile"
            title="Profile"
            aria-current={isItemActive('/profile', pathname) ? 'page' : undefined}
            className={cn(
              'tap flex items-center justify-center shrink-0 w-8 h-8 rounded-full transition-colors',
              isItemActive('/profile', pathname)
                ? 'bg-[#E7D7BE]/20 border border-[#E7D7BE]/40'
                : 'bg-[#211F1A] border border-[#3B372F] hover:border-[#E7D7BE]/30',
            )}
          >
            <User size={13} className={isItemActive('/profile', pathname) ? 'text-[#E7D7BE]' : 'text-[#D0C3AF]'} />
          </Link>
        </div>

        {/* ── Row 2: sub-tabs of the active hub ───────────────────── */}
        <div className="h-11 flex items-center gap-1 px-3 md:px-6 border-t border-[#211F1A]/60 overflow-x-auto no-scrollbar">
          {/* On mobile, show which hub you're in (since hub buttons are in the drawer) */}
          <span className="md:hidden flex items-center gap-1.5 pr-2 mr-1 border-r border-[#211F1A] text-[10px] font-mono uppercase tracking-[0.15em] text-[#B4AA99] shrink-0">
            <group.icon size={12} />
            {group.label}
          </span>
          {group.items.map((it) => {
            const active = isItemActive(it.href, pathname);
            const Icon = it.icon;
            return (
              <Link
                key={it.href}
                href={it.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium tracking-tight transition-colors shrink-0 whitespace-nowrap',
                  active
                    ? 'text-[#E7D7BE] bg-[#1A1813]'
                    : 'text-[#8a7a5c] hover:text-[#F7EBDD] hover:bg-[#101010]',
                )}
              >
                <Icon size={13} strokeWidth={1.75} />
                <span>{it.label}</span>
              </Link>
            );
          })}
        </div>

        <style jsx>{`
          .no-scrollbar::-webkit-scrollbar { display: none; }
          .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        `}</style>
      </header>

      {/* ── Mobile drawer — grouped by hub ──────────────────────── */}
      {mobileOpen && (
        <>
          <div
            onClick={() => setMobileOpen(false)}
            className="md:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-40 animate-in fade-in duration-200"
          />
          <aside
            className="md:hidden fixed top-0 left-0 bottom-0 w-[min(85vw,300px)] z-50 bg-[#090907] border-r border-white/[0.06] flex flex-col animate-in slide-in-from-left duration-300"
            style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.04]">
              <span className="text-[11px] font-semibold tracking-[0.22em] uppercase text-[#F7EBDD]">
                U2C Beatstore
              </span>
              <button
                onClick={() => setMobileOpen(false)}
                className="tap w-9 h-9 rounded-full flex items-center justify-center text-[#D0C3AF] hover:text-white hover:bg-white/[0.04] transition-colors"
                aria-label="Close menu"
              >
                <X size={16} />
              </button>
            </div>
            <nav className="flex-1 px-3 py-4 overflow-y-auto">
              {ALL_GROUPS.map((g) => (
                <div key={g.key} className="mb-4 last:mb-0">
                  <p className="px-3 mb-1.5 text-[9px] font-mono uppercase tracking-[0.2em] text-[#9B9282] flex items-center gap-1.5">
                    <g.icon size={11} />
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
                              ? 'bg-[#1A1813] text-white'
                              : 'text-[#D0C3AF] hover:text-white hover:bg-white/[0.04]',
                          )}
                        >
                          <Icon size={15} strokeWidth={1.75} />
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
