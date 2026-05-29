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
  if (kind === 'refund') return <RotateCcw size={13} className="text-[#c8a84b]" />;
  if (kind === 'dispute') return <AlertTriangle size={13} className="text-red-400" />;
  return <Bell size={13} className="text-[#a08a6a]" />;
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

// Settings is intentionally NOT in this list — it moved to a dedicated
// gear button in the top-right (next to the activity bell) so the
// horizontal nav is reserved for surfaces the user reaches every day.
// Mobile drawer still has it for the same reason it has Offline:
// long-tail destinations the user does want eventually.
const NAV_ITEMS = [
  { label: 'Home',      icon: Home,      href: '/library'   },
  { label: 'Projects',  icon: Layers,    href: '/projects'  },
  { label: 'Playlists', icon: ListMusic, href: '/playlists' },
  { label: 'Studio',    icon: Sliders,   href: '/studio'    },
  { label: 'Contacts',  icon: Users,     href: '/contacts'  },
  { label: 'Calendar',  icon: Calendar,  href: '/calendar'  },
  { label: 'Links',     icon: Link2,     href: '/links'     },
  { label: 'Store',     icon: Store,     href: '/store-editor' },
  { label: 'Offline',   icon: CloudOff,  href: '/offline'   },
];

// Mobile drawer keeps Settings reachable since there's no gear icon
// in the cramped mobile header.
const MOBILE_EXTRA_ITEMS = [
  { label: 'Profile',   icon: User,      href: '/profile'   },
  { label: 'Settings',  icon: Settings,  href: '/settings'  },
];

export function TopBar() {
  const pathname = usePathname();
  const openPalette = useCommandPalette((s) => s.setOpen);
  const [activityOpen, setActivityOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => { setMobileOpen(false); }, [pathname]);

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
      <header className="fixed top-0 left-0 right-0 h-14 bg-[#0a0907]/95 backdrop-blur-md border-b border-[#1a160f] z-30 flex items-center px-4 md:px-6 gap-3 md:gap-6">
        {/* Mobile hamburger — visible below md, opens the slide-in menu */}
        <button
          onClick={() => setMobileOpen(true)}
          className="md:hidden w-8 h-8 rounded-md flex items-center justify-center text-[#a08a6a] hover:text-white hover:bg-white/[0.04] transition-colors"
          aria-label="Open navigation menu"
        >
          <Menu size={16} />
        </button>

        {/* Brand */}
        <Link href="/library" className="flex items-center gap-2.5 group shrink-0">
          <div className="w-6 h-6 rounded-[6px] bg-[#E8DCC8] flex items-center justify-center">
            <span className="text-[10px] font-black text-black tracking-tighter">U2C</span>
          </div>
          <span className="text-[11px] font-semibold tracking-[0.22em] uppercase text-[#E8DCC8] group-hover:text-white hidden sm:inline">
            u2c beatstore
          </span>
        </Link>

        {/* Desktop nav — hidden below md (replaced by the mobile drawer) */}
        <nav className="hidden md:flex items-center gap-0.5 flex-1 overflow-x-auto no-scrollbar">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + '/');
            const Icon = item.icon;
            return (
              <Link
                key={item.label}
                href={item.href}
                className={cn(
                  'flex items-center gap-2 px-3 py-1.5 rounded-md text-[12px] transition-colors shrink-0',
                  active
                    ? 'bg-[#16130e] text-white'
                    : 'text-[#6a5d4a] hover:text-[#E8DCC8] hover:bg-[#101010]',
                )}
              >
                <Icon size={13} strokeWidth={1.75} className={active ? 'text-white' : ''} />
                <span className="font-medium tracking-tight">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Spacer — only when mobile nav is hidden so the right-side
            controls hug the right edge instead of left-floating. */}
        <div className="flex-1 md:hidden" />

        {/* Search trigger — hidden below md to save horizontal room.
            Mobile users can still hit ⌘K / Ctrl+K. */}
        <button
          onClick={() => openPalette(true)}
          className="hidden md:flex items-center gap-2 w-56 bg-[#14110d] border border-[#1a160f] rounded-md py-1.5 px-3 text-[11px] text-[#3a3328] hover:border-[#2d2620] hover:text-[#6a5d4a] transition-colors shrink-0"
          title="Search (⌘K)"
        >
          <Search size={12} />
          <span className="flex-1 text-left">Search</span>
          <kbd className="text-[9px] font-mono border border-[#1a160f] rounded px-1 py-0.5">⌘K</kbd>
        </button>

        {/* View Storefront — external link to /store. Hidden below md
            where the mobile drawer has a Store nav item already. */}
        <Link
          href="/store"
          target="_blank"
          rel="noopener noreferrer"
          title="View public storefront"
          className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-mono uppercase tracking-wider text-[#6a5d4a] hover:text-[#D4BFA0] hover:bg-[#16130e] border border-transparent hover:border-[#1f1a13] transition-all shrink-0"
        >
          <Store size={11} />
          <span>Store</span>
          <ExternalLink size={9} className="opacity-60" />
        </Link>

        {/* Notifications bell ─ badge shows unread count; dropdown on click */}
        <div className="relative shrink-0" ref={notifRef}>
          <button
            onClick={openNotifs}
            className="w-8 h-8 rounded-full flex items-center justify-center text-[#a08a6a] hover:text-white hover:bg-white/[0.04] transition-colors relative"
            aria-label="Notifications"
            title="Notifications"
          >
            <Bell size={14} />
            {unread > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-[#6DC6A4] text-black text-[8px] font-black flex items-center justify-center leading-none">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </button>

          {notifOpen && (
            <div className="absolute right-0 top-full mt-2 w-80 bg-[#0e0c09] border border-[#1f1a13] rounded-2xl shadow-2xl z-50 overflow-hidden">
              <div className="px-4 py-3 border-b border-[#1a160f] flex items-center justify-between">
                <span className="text-[11px] font-mono uppercase tracking-wider text-[#a08a6a]">Notifications</span>
                <button
                  onClick={() => setActivityOpen(true)}
                  className="text-[9px] font-mono uppercase tracking-wider text-[#5a5142] hover:text-[#a08a6a] transition-colors"
                >
                  Activity log →
                </button>
              </div>
              <div className="max-h-80 overflow-y-auto">
                {notifs.length === 0 ? (
                  <div className="px-4 py-8 text-center text-[11px] text-[#3a3328]">
                    No notifications yet
                  </div>
                ) : (
                  notifs.map((n) => (
                    <div
                      key={n.id}
                      className={`flex items-start gap-3 px-4 py-3 border-b border-[#1a160f]/60 last:border-0 transition-colors ${n.read ? 'opacity-60' : 'bg-[#14110d]/40'}`}
                    >
                      <div className="w-6 h-6 rounded-lg bg-[#1a160f] border border-[#2d2620] flex items-center justify-center shrink-0 mt-0.5">
                        {notifIcon(n.kind)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-medium text-[#E8DCC8] leading-tight">{n.title}</p>
                        {n.body && <p className="text-[10px] text-[#5a5142] mt-0.5 leading-snug">{n.body}</p>}
                        <p className="text-[9px] font-mono text-[#3a3328] mt-1">{timeAgo(n.created_at)}</p>
                      </div>
                      {!n.read && <div className="w-1.5 h-1.5 rounded-full bg-[#6DC6A4] shrink-0 mt-1.5" />}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Activity panel — still accessible via "Activity log →" link above */}
        <button
          onClick={() => setActivityOpen(true)}
          className="hidden w-8 h-8 rounded-full items-center justify-center text-[#a08a6a] hover:text-white hover:bg-white/[0.04] transition-colors shrink-0"
          aria-label="Open activity"
          title="Activity"
        >
          <Bell size={14} />
        </button>

        {/* Settings gear — moved out of the horizontal nav so it lives
            next to the activity bell on every page. Desktop only;
            mobile users reach it via the drawer below. The active
            state ring makes it clear when the user IS on /settings. */}
        <Link
          href="/settings"
          aria-label="Open settings"
          title="Settings"
          className={cn(
            'hidden md:flex w-8 h-8 rounded-full items-center justify-center transition-colors shrink-0',
            pathname === '/settings' || pathname.startsWith('/settings/')
              ? 'bg-[#16130e] text-white'
              : 'text-[#a08a6a] hover:text-white hover:bg-white/[0.04]',
          )}
        >
          <Settings size={14} />
        </Link>

        {/* User badge — links to creator profile */}
        <Link
          href="/profile"
          aria-label="Creator profile"
          title="Profile"
          className={cn(
            'flex items-center gap-2 shrink-0 w-7 h-7 rounded-full transition-colors',
            pathname === '/profile' || pathname.startsWith('/profile/')
              ? 'bg-[#D4BFA0]/20 border border-[#D4BFA0]/40'
              : 'bg-[#1a160f] border border-[#2d2620] hover:border-[#D4BFA0]/30',
          )}
        >
          <div className="w-full h-full rounded-full flex items-center justify-center">
            <User size={12} className={pathname === '/profile' ? 'text-[#D4BFA0]' : 'text-[#a08a6a]'} />
          </div>
        </Link>

        <style jsx>{`
          .no-scrollbar::-webkit-scrollbar { display: none; }
          .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        `}</style>
      </header>

      {/* Mobile menu drawer — slide-in from the left below md.
          Backdrop is a darkened glass overlay; clicking it closes. */}
      {mobileOpen && (
        <>
          <div
            onClick={() => setMobileOpen(false)}
            className="md:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-40 animate-in fade-in duration-200"
          />
          <aside
            className="md:hidden fixed top-0 left-0 bottom-0 w-72 z-50 bg-[#0a0907] border-r border-white/[0.06] flex flex-col animate-in slide-in-from-left duration-300"
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.04]">
              <span className="text-[11px] font-semibold tracking-[0.22em] uppercase text-[#E8DCC8]">
                U2C Beatstore
              </span>
              <button
                onClick={() => setMobileOpen(false)}
                className="w-7 h-7 rounded-full flex items-center justify-center text-[#6a5d4a] hover:text-white hover:bg-white/[0.04] transition-colors"
                aria-label="Close menu"
              >
                <X size={14} />
              </button>
            </div>
            <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
              {[...NAV_ITEMS, ...MOBILE_EXTRA_ITEMS].map((item) => {
                const active = pathname === item.href || pathname.startsWith(item.href + '/');
                const Icon = item.icon;
                return (
                  <Link
                    key={item.label}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2.5 rounded-md text-[13px] transition-colors',
                      active
                        ? 'bg-[#16130e] text-white'
                        : 'text-[#a08a6a] hover:text-white hover:bg-white/[0.04]',
                    )}
                  >
                    <Icon size={15} strokeWidth={1.75} />
                    <span className="font-medium tracking-tight">{item.label}</span>
                  </Link>
                );
              })}
            </nav>
          </aside>
        </>
      )}

      <ActivityPanel open={activityOpen} onClose={() => setActivityOpen(false)} />
    </>
  );
}
