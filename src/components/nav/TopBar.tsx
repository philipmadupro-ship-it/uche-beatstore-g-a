'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import {
  Disc3,
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
} from 'lucide-react';
import { useCommandPalette } from '@/hooks/useCommandPalette';
import { ActivityPanel } from '@/components/activity/ActivityPanel';
import { cn } from '@/lib/utils';

// Settings is intentionally NOT in this list — it moved to a dedicated
// gear button in the top-right (next to the activity bell) so the
// horizontal nav is reserved for surfaces the user reaches every day.
// Mobile drawer still has it for the same reason it has Offline:
// long-tail destinations the user does want eventually.
const NAV_ITEMS = [
  { label: 'Library',   icon: Disc3,     href: '/library'   },
  { label: 'Projects',  icon: Layers,    href: '/projects'  },
  { label: 'Playlists', icon: ListMusic, href: '/playlists' },
  { label: 'Studio',    icon: Sliders,   href: '/studio'    },
  { label: 'Contacts',  icon: Users,     href: '/contacts'  },
  { label: 'Calendar',  icon: Calendar,  href: '/calendar'  },
  { label: 'Links',     icon: Link2,     href: '/links'     },
  { label: 'Offline',   icon: CloudOff,  href: '/offline'   },
];

// Mobile drawer keeps Settings reachable since there's no gear icon
// in the cramped mobile header.
const MOBILE_EXTRA_ITEMS = [
  { label: 'Settings',  icon: Settings,  href: '/settings'  },
];

export function TopBar() {
  const pathname = usePathname();
  const openPalette = useCommandPalette((s) => s.setOpen);
  // Activity panel — was previously wired into the unmounted Sidebar,
  // moved here so the bell is actually visible. State stays local;
  // the panel itself portals to <body> at render time.
  const [activityOpen, setActivityOpen] = useState(false);
  // Mobile menu drawer. Closed by default; opens on hamburger tap and
  // closes on route change so navigating doesn't leave the drawer
  // stuck open over the new page.
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => { setMobileOpen(false); }, [pathname]);

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

        {/* Activity bell — opens the slide-in activity panel. Shown at
            every breakpoint; mobile users want this just as much. */}
        <button
          onClick={() => setActivityOpen(true)}
          className="w-8 h-8 rounded-full flex items-center justify-center text-[#a08a6a] hover:text-white hover:bg-white/[0.04] transition-colors shrink-0"
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

        {/* User badge */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-7 h-7 rounded-full bg-[#1a160f] border border-[#2d2620] flex items-center justify-center">
            <span className="text-[9px] font-bold text-[#a08a6a]">U</span>
          </div>
        </div>

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
