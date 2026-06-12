'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search, Music, Layers, Users, Disc3, ListMusic, Calendar,
  Link2, Settings, Sliders, CloudOff, ArrowRight, Loader2,
} from 'lucide-react';
import { useCommandPalette } from '@/hooks/useCommandPalette';
import { usePlayer } from '@/hooks/usePlayer';

interface SearchResults {
  tracks: { id: string; title: string; type?: string; cover_url?: string | null; audio_url?: string | null }[];
  projects: { id: string; name: string; cover_url?: string | null }[];
  contacts: { id: string; name: string; email?: string | null; role?: string | null; label?: string | null }[];
}

const ROUTE_COMMANDS = [
  { label: 'Library',   icon: Disc3,     href: '/library'   },
  { label: 'Projects',  icon: Layers,    href: '/projects'  },
  { label: 'Playlists', icon: ListMusic, href: '/playlists' },
  { label: 'Studio',    icon: Sliders,   href: '/studio'    },
  { label: 'Contacts',  icon: Users,     href: '/contacts'  },
  { label: 'Calendar',  icon: Calendar,  href: '/calendar'  },
  { label: 'Links',     icon: Link2,     href: '/links'     },
  { label: 'Offline',   icon: CloudOff,  href: '/offline'   },
  { label: 'Settings',  icon: Settings,  href: '/settings'  },
];

export function CommandPalette() {
  const open = useCommandPalette((s) => s.open);
  const setOpen = useCommandPalette((s) => s.setOpen);
  const router = useRouter();
  const { setTrack: setPlayerTrack } = usePlayer();

  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResults>({ tracks: [], projects: [], contacts: [] });
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Cmd-K / Ctrl-K toggle
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(!useCommandPalette.getState().open);
      } else if (e.key === 'Escape' && useCommandPalette.getState().open) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setOpen]);

  // Reset on open
  useEffect(() => {
    if (open) {
      setQ('');
      setActiveIdx(0);
      setResults({ tracks: [], projects: [], contacts: [] });
      // Defer focus until after the modal animates in
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  // Debounced fetch
  useEffect(() => {
    if (!open) return;
    if (q.trim().length < 1) {
      setResults({ tracks: [], projects: [], contacts: [] });
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`);
        const data = await res.json();
        if (!cancelled) setResults({
          tracks: data.tracks || [],
          projects: data.projects || [],
          contacts: data.contacts || [],
        });
      } catch {
        if (!cancelled) setResults({ tracks: [], projects: [], contacts: [] });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 150);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q, open]);

  // Flatten results into a single list for keyboard navigation
  const flat = useMemo(() => {
    const items: { kind: 'route' | 'track' | 'project' | 'contact'; id: string; label: string; sub?: string; action: () => void; icon: any }[] = [];

    const filtered = q.trim().length > 0
      ? ROUTE_COMMANDS.filter((r) => r.label.toLowerCase().includes(q.trim().toLowerCase()))
      : ROUTE_COMMANDS;

    for (const r of filtered) {
      items.push({
        kind: 'route',
        id: r.href,
        label: `Go to ${r.label}`,
        icon: r.icon,
        action: () => { router.push(r.href); setOpen(false); },
      });
    }

    for (const t of results.tracks) {
      items.push({
        kind: 'track',
        id: t.id,
        label: t.title,
        sub: t.type ? t.type.toUpperCase() : 'TRACK',
        icon: Music,
        action: () => {
          if (t.audio_url) setPlayerTrack(t as any);
          setOpen(false);
        },
      });
    }
    for (const p of results.projects) {
      items.push({
        kind: 'project',
        id: p.id,
        label: p.name,
        sub: 'PROJECT',
        icon: Layers,
        action: () => { router.push(`/projects/${p.id}`); setOpen(false); },
      });
    }
    for (const c of results.contacts) {
      items.push({
        kind: 'contact',
        id: c.id,
        label: c.name,
        sub: c.email || c.role || 'CONTACT',
        icon: Users,
        action: () => { router.push('/contacts'); setOpen(false); },
      });
    }

    return items;
  }, [q, results, router, setOpen, setPlayerTrack]);

  // Clamp active idx when list size changes
  useEffect(() => {
    if (activeIdx >= flat.length) setActiveIdx(Math.max(0, flat.length - 1));
  }, [flat.length, activeIdx]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(flat.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      flat[activeIdx]?.action();
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center pt-32 px-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-xl bg-[#090907] border border-[#2B2821] rounded-xl shadow-2xl overflow-hidden animate-in zoom-in-95 slide-in-from-top-4 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[#211F1A]">
          <Search size={14} className="text-[#837B6D] shrink-0" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setActiveIdx(0); }}
            onKeyDown={onKey}
            placeholder="Search tracks, projects, contacts, or jump to…"
            className="flex-1 bg-transparent text-[13px] text-[#F7EBDD] placeholder-[#837B6D] focus:outline-none"
          />
          {loading && <Loader2 size={12} className="animate-spin text-[#B4AA99]" />}
          <kbd className="text-[9px] font-mono text-[#837B6D] border border-[#2B2821] rounded px-1.5 py-0.5 hidden sm:block">ESC</kbd>
        </div>

        {/* Results */}
        <div className="max-h-[50vh] overflow-y-auto">
          {flat.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <p className="text-[11px] text-[#9B9282]">
                {q.trim() ? 'No matches' : 'Start typing to search'}
              </p>
            </div>
          ) : (
            <div className="py-1">
              {flat.map((item, i) => {
                const Icon = item.icon;
                const active = i === activeIdx;
                return (
                  <button
                    key={`${item.kind}-${item.id}`}
                    onClick={item.action}
                    onMouseEnter={() => setActiveIdx(i)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                      active ? 'bg-[#1A1813]' : 'hover:bg-[#101010]'
                    }`}
                  >
                    <Icon size={13} className={active ? 'text-[#E7D7BE]' : 'text-[#B4AA99]'} />
                    <span className="flex-1 text-[12px] text-[#F7EBDD] truncate">{item.label}</span>
                    {item.sub && (
                      <span className="text-[9px] font-mono text-[#9B9282] uppercase tracking-wider">{item.sub}</span>
                    )}
                    {active && <ArrowRight size={11} className="text-[#E7D7BE]" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-[#211F1A] flex items-center justify-between text-[9px] font-mono text-[#837B6D] uppercase tracking-wider">
          <span>↑↓ navigate · ↵ select</span>
          <span>⌘K to toggle</span>
        </div>
      </div>
    </div>
  );
}
