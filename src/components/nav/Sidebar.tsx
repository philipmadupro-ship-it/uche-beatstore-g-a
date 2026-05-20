'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
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
  Music,
  Play,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRealtimeTable } from '@/hooks/useRealtimeTable';
import { ActivityPanel } from '@/components/activity/ActivityPanel';
import { usePlayer } from '@/hooks/usePlayer';

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
  const router = useRouter();
  const { currentTrack } = usePlayer();

  const [activityOpen, setActivityOpen] = useState(false);
  const [projects, setProjects] = useState<SidebarProject[]>([]);

  // Search — fetch tracks matching the query; show a floating dropdown.
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ id: string; title: string; type: string; cover_url?: string | null; bpm?: number | null; key?: string | null; scale?: string | null }>>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!searchQuery.trim()) { setSearchResults([]); return; }
    const timer = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const res = await fetch(`/api/tracks?q=${encodeURIComponent(searchQuery.trim())}&limit=8`);
        const data = await res.json();
        setSearchResults(Array.isArray(data) ? data : []);
      } catch { setSearchResults([]); }
      finally { setSearchLoading(false); }
    }, 250);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchQuery('');
        setSearchResults([]);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);
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

      {/* Search — live track lookup with floating results dropdown */}
      <div className="px-4 mb-6" ref={searchRef}>
        <div className="relative">
          <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#3a3328] pointer-events-none" />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search tracks…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { setSearchQuery(''); setSearchResults([]); }
              if (e.key === 'Enter' && searchResults.length > 0) {
                router.push(`/library/${searchResults[0].id}`);
                setSearchQuery(''); setSearchResults([]);
              }
            }}
            className="w-full bg-[#14110d] border border-[#1a160f] rounded-md py-2 pl-8 pr-7 text-[11px] text-[#E8DCC8] placeholder:text-[#3a3328] focus:outline-none focus:border-[#2d2620] transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => { setSearchQuery(''); setSearchResults([]); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[#3a3328] hover:text-[#a08a6a] transition-colors"
            >
              <X size={11} />
            </button>
          )}
          {/* Results dropdown */}
          {searchQuery && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-[#0e0c09] border border-[#1f1a13] rounded-lg overflow-hidden z-50 shadow-xl">
              {searchLoading ? (
                <div className="px-3 py-3 text-[10px] font-mono text-[#4a4338] text-center">Searching…</div>
              ) : searchResults.length === 0 ? (
                <div className="px-3 py-3 text-[10px] font-mono text-[#4a4338] text-center">No tracks found</div>
              ) : (
                <ul>
                  {searchResults.map((t) => (
                    <li key={t.id}>
                      <Link
                        href={`/library/${t.id}`}
                        onClick={() => { setSearchQuery(''); setSearchResults([]); }}
                        className="flex items-center gap-2.5 px-3 py-2 hover:bg-white/[0.03] transition-colors"
                      >
                        <div className="w-7 h-7 rounded bg-[#14110d] border border-[#1f1a13] overflow-hidden shrink-0 flex items-center justify-center text-[#3a3328]">
                          {t.cover_url
                            ? <img src={t.cover_url} alt="" className="w-full h-full object-cover" />
                            : <Music size={10} />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] text-[#E8DCC8] truncate font-medium">{t.title}</p>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[9px] font-mono text-[#4a4338] uppercase">{t.type}</span>
                            {t.key && (
                              <span className={`text-[8px] font-mono font-bold px-1 rounded ${
                                t.scale === 'minor' ? 'text-[#9d95e8]' : 'text-[#c8a47a]'
                              }`}>
                                {t.key}{t.scale === 'minor' ? 'm' : ''}
                              </span>
                            )}
                          </div>
                        </div>
                        {currentTrack?.id === t.id && (
                          <Play size={9} className="text-[#D4BFA0] shrink-0" fill="currentColor" />
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + '/');
          const Icon = item.icon;
          // Show an animated equalizer dot when a track is playing and this
          // is the Library nav item — the user can always see "music is on."
          const isPlayingHere = currentTrack && item.href === '/library';
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
              <span className="font-medium tracking-tight font-heading flex-1">{item.label}</span>
              {isPlayingHere && (
                <span className="flex gap-0.5 items-end h-3 shrink-0">
                  <span className="w-0.5 bg-[#D4BFA0] animate-bounce rounded-full" style={{ height: '6px', animationDelay: '0ms' }} />
                  <span className="w-0.5 bg-[#D4BFA0] animate-bounce rounded-full" style={{ height: '10px', animationDelay: '120ms' }} />
                  <span className="w-0.5 bg-[#D4BFA0] animate-bounce rounded-full" style={{ height: '7px', animationDelay: '240ms' }} />
                </span>
              )}
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

      {/* Footer — now-playing mini strip when a track is active */}
      <div className="border-t border-[#1a160f]">
        {currentTrack && (
          <div className="px-4 py-2.5 border-b border-[#1a160f] flex items-center gap-2.5">
            <div className="w-6 h-6 rounded bg-[#14110d] border border-[#1f1a13] overflow-hidden shrink-0">
              {currentTrack.cover_url
                ? <img src={currentTrack.cover_url} alt="" className="w-full h-full object-cover" />
                : <div className="w-full h-full flex items-center justify-center text-[#3a3328]"><Music size={9} /></div>}
            </div>
            <p className="text-[10px] text-[#a08a6a] truncate flex-1 font-medium">{currentTrack.title}</p>
            <span className="flex gap-0.5 items-end h-2.5 shrink-0">
              <span className="w-0.5 bg-[#D4BFA0] animate-bounce rounded-full" style={{ height: '5px', animationDelay: '0ms' }} />
              <span className="w-0.5 bg-[#D4BFA0] animate-bounce rounded-full" style={{ height: '9px', animationDelay: '120ms' }} />
              <span className="w-0.5 bg-[#D4BFA0] animate-bounce rounded-full" style={{ height: '6px', animationDelay: '240ms' }} />
            </span>
          </div>
        )}
        <div className="px-5 py-4 flex items-center gap-3">
          <div className="w-7 h-7 rounded-full bg-[#1a160f] border border-[#2d2620] flex items-center justify-center">
            <span className="text-[9px] font-bold text-[#a08a6a]">AG</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium text-[#E8DCC8] truncate">Creator</p>
            <Link href="/settings" className="text-[9px] text-[#5a5142] font-mono uppercase tracking-wider hover:text-[#a08a6a] transition-colors">Settings</Link>
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
