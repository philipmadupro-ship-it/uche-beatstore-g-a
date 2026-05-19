'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
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
  Megaphone,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRealtimeTable } from '@/hooks/useRealtimeTable';
import { ActivityPanel } from '@/components/activity/ActivityPanel';

// Each item carries a one-line `description` shown as a hover tooltip so
// the mental model — what each surface is FOR — is one mouseover away.
// The three core music surfaces line up as a workflow:
//
//   Studio  →  Sketch grooves loose, before they're full tracks.
//   Projects →  Active work. Tracks you're producing, with stems / versions.
//   Library  →  Every track you've finalized.
//   Playlists→  Curated sets to share with people.
//
// CRM (Contacts) and Calendar are the "send + schedule" half of the loop.
const NAV_ITEMS = [
  { label: 'Library',   icon: Disc3,     href: '/library',   description: 'Every track you\'ve finalized.' },
  { label: 'Projects',  icon: Layers,    href: '/projects',  description: 'Active production. Tracks in flight.' },
  { label: 'Playlists', icon: ListMusic, href: '/playlists', description: 'Curated sets to send and play.' },
  { label: 'Studio',    icon: Sliders,   href: '/studio',    description: 'Sketch grooves. Loop, jam, record.' },
  { label: 'Contacts',  icon: Users,     href: '/contacts',  description: 'CRM + beat sends.' },
  { label: 'Campaigns', icon: Megaphone, href: '/campaigns', description: 'Outreach batches and follow-ups.' },
  { label: 'Calendar',  icon: Calendar,  href: '/calendar',  description: 'Releases, sessions, deadlines.' },
  { label: 'Links',     icon: Link2,     href: '/links',     description: 'Share links you\'ve generated.' },
  { label: 'Offline',   icon: CloudOff,  href: '/offline',   description: 'Cached tracks for offline play.' },
  { label: 'Settings',  icon: Settings,  href: '/settings',  description: 'Account, team, integrations.' },
];

// Deterministic gradient from a project id — same id always lands on the
// same pair of hues so the sidebar feels stable across sessions. Six
// hue pairs picked to read well on the dark background; no clashing
// neon, no muddy browns. Hash → index keeps it portable.
const PROJECT_GRADIENTS: [string, string][] = [
  ['#D4BFA0', '#3a2a8a'], // signature purple
  ['#f8a4c8', '#7a3a7a'], // pink → magenta
  ['#6DC6A4', '#1f5a4a'], // mint
  ['#e8b76a', '#8a4a2a'], // amber
  ['#7aa8e8', '#2a3a7a'], // sky
  ['#e8a4a4', '#7a2a3a'], // coral
];
function gradientFor(id: string): [string, string] {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return PROJECT_GRADIENTS[hash % PROJECT_GRADIENTS.length];
}

interface SidebarProject {
  id: string;
  name: string;
  cover_url?: string | null;
}

export function Sidebar() {
  const pathname = usePathname();
  // ActivityPanel open state lives here so the Bell button in the brand
  // row controls it directly. The panel itself portals to <body>, so
  // its render position doesn't matter for layout.
  const [activityOpen, setActivityOpen] = useState(false);
  // Recent projects shown as colored-square bullets in the Library
  // section of the sidebar. Cheap fetch on mount; realtime keeps it
  // fresh when projects are created/renamed elsewhere.
  const [projects, setProjects] = useState<SidebarProject[]>([]);
  const fetchProjects = async () => {
    try {
      const res = await fetch('/api/projects', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      const list = Array.isArray(data) ? data : data.projects || [];
      // Cap to keep the sidebar from growing unbounded — power users
      // navigate via the full /projects index, not the sidebar bullet
      // list, when they have dozens of projects.
      setProjects(list.slice(0, 8));
    } catch {
      // Swallow — the page still works without the sidebar bullets.
    }
  };
  useEffect(() => { fetchProjects(); }, []);
  useRealtimeTable({ table: 'projects', onChange: fetchProjects });

  return (
    <aside className="w-60 h-screen bg-[#0a0907] border-r border-[#1a160f] flex flex-col fixed left-0 top-0 z-30">
      {/* Brand + Activity bell. The bell opens a slide-in panel listing
          the last 7 days of uploads / comments / sends / ratings — same
          stream the calendar page uses, surfaced here for everyday
          glance-ability. */}
      <div className="px-6 pt-7 pb-8 flex items-center justify-between">
        <Link href="/library" className="flex items-center gap-2.5 group min-w-0">
          <div className="w-6 h-6 rounded-[6px] bg-[#E8DCC8] flex items-center justify-center shrink-0">
            <span className="text-[10px] font-black text-black tracking-tighter">AG</span>
          </div>
          <span className="text-[11px] font-semibold tracking-[0.22em] uppercase text-[#E8DCC8] group-hover:text-white truncate font-heading">
            antigravity
          </span>
        </Link>
        <button
          onClick={() => setActivityOpen(true)}
          className="w-7 h-7 rounded-full flex items-center justify-center text-[#6a5d4a] hover:text-white hover:bg-white/[0.04] transition-colors shrink-0"
          aria-label="Open activity panel"
          title="Activity"
        >
          <Bell size={13} />
        </button>
      </div>

      {/* Search */}
      <div className="px-4 mb-6">
        <div className="relative">
          <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#3a3328]" />
          <input
            type="text"
            placeholder="Search"
            className="w-full bg-[#14110d] border border-[#1a160f] rounded-md py-2 pl-8 pr-3 text-[11px] text-[#E8DCC8] placeholder:text-[#3a3328] focus:outline-none focus:border-[#2d2620] transition-colors"
          />
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + '/');
          const Icon = item.icon;
          return (
            <Link
              key={item.label}
              href={item.href}
              title={item.description}
              className={`flex items-center gap-3 px-3 py-2 rounded-md text-[12px] transition-colors ${
                active
                  ? 'bg-[#16130e] text-white'
                  : 'text-[#6a5d4a] hover:text-[#E8DCC8] hover:bg-[#101010]'
              }`}
            >
              <Icon size={14} strokeWidth={1.75} className={active ? 'text-white' : ''} />
              <span className="font-medium tracking-tight font-heading">{item.label}</span>
            </Link>
          );
        })}

        {/* Recent projects — colored-square bullets that double as quick
            nav. Each square is either the project's cover art (if set)
            or a deterministic gradient seeded by the project id, so the
            same project always carries the same visual identity. */}
        {projects.length > 0 && (
          <div className="pt-6">
            <p className="px-3 mb-2 text-[9px] font-mono uppercase tracking-[0.2em] text-[#3a3328]">
              Library
            </p>
            <div className="space-y-0.5">
              {projects.map((p) => {
                const active = pathname === `/projects/${p.id}`;
                const [a, b] = gradientFor(p.id);
                return (
                  <Link
                    key={p.id}
                    href={`/projects/${p.id}`}
                    title={p.name}
                    className={cn(
                      'flex items-center gap-3 px-3 py-1.5 rounded-md text-[12px] transition-colors',
                      active
                        ? 'bg-[#16130e] text-white'
                        : 'text-[#6a5d4a] hover:text-[#E8DCC8] hover:bg-[#101010]',
                    )}
                  >
                    <div
                      className="w-5 h-5 rounded-[5px] shrink-0 overflow-hidden border border-white/[0.05]"
                      style={p.cover_url ? undefined : { background: `linear-gradient(135deg, ${a} 0%, ${b} 100%)` }}
                    >
                      {p.cover_url && (
                        <img loading="lazy" src={p.cover_url} alt="" className="w-full h-full object-cover" />
                      )}
                    </div>
                    <span className="font-medium tracking-tight truncate">{p.name}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </nav>

      {/* Footer */}
      <div className="px-5 py-5 border-t border-[#1a160f]">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-full bg-[#1a160f] border border-[#2d2620] flex items-center justify-center">
            <span className="text-[9px] font-bold text-[#a08a6a]">AG</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium text-[#E8DCC8] truncate">Creator</p>
            <p className="text-[9px] text-[#5a5142] font-mono uppercase tracking-wider">local</p>
          </div>
        </div>
      </div>
      {/* Activity slide-in. Lives inside the sidebar wrapper so the
          trigger and state are co-located; the panel itself portals to
          <body> at render time. */}
      <ActivityPanel open={activityOpen} onClose={() => setActivityOpen(false)} />
    </aside>
  );
}
