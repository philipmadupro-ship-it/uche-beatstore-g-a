'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search, Music, Layers, Users, Disc3, ListMusic, Calendar,
  Link2, Settings, Sliders, CloudOff, ArrowRight, Loader2,
  type LucideIcon,
} from 'lucide-react';
import { useCommandPalette } from '@/hooks/useCommandPalette';
import { usePlayer } from '@/hooks/usePlayer';
import { useDialogBehavior } from '@/hooks/useDialogBehavior';
import type { Track } from '@/lib/types';

interface SearchTrackResult extends Pick<Track, 'id' | 'title' | 'type' | 'cover_url' | 'audio_url'> {
  duration_seconds?: number | null;
}

interface SearchResults {
  tracks: SearchTrackResult[];
  projects: { id: string; name: string; cover_url?: string | null }[];
  contacts: { id: string; name: string; email?: string | null; role?: string | null; label?: string | null }[];
}

interface CommandItem {
  kind: 'route' | 'track' | 'project' | 'contact';
  id: string;
  label: string;
  sub?: string;
  action: () => void;
  icon: LucideIcon;
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
  const panelRef = useDialogBehavior({ open, onClose: () => setOpen(false) });

  // Cmd-K / Ctrl-K toggle. Escape-to-close is handled by useDialogBehavior above.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(!useCommandPalette.getState().open);
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
    const items: CommandItem[] = [];

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
          if (t.audio_url) setPlayerTrack(t as Track);
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
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        tabIndex={-1}
        className="w-full max-w-xl bg-[#090907] border border-white/10 rounded-xl shadow-[0_24px_60px_-12px_rgba(0,0,0,0.7)] overflow-hidden animate-in zoom-in-95 slide-in-from-top-4 duration-200 focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10">
          <Search size={14} className="text-white/40 shrink-0" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setActiveIdx(0); }}
            onKeyDown={onKey}
            placeholder="Search tracks, projects, contacts, or jump to…"
            className="flex-1 bg-transparent text-[13px] text-white placeholder-white/30 focus:outline-none"
          />
          {loading && <Loader2 size={12} className="animate-spin text-white/60" />}
          <kbd className="text-[9px] font-mono text-white/40 border border-white/10 rounded px-1.5 py-0.5 hidden sm:block">ESC</kbd>
        </div>

        {/* Results */}
        <div className="max-h-[50vh] overflow-y-auto">
          {flat.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <p className="text-[11px] text-white/40">
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
                      active ? 'bg-[#0D0D0A]' : 'hover:bg-[#101010]'
                    }`}
                  >
                    <Icon size={13} className={active ? 'text-white' : 'text-white/60'} />
                    <span className="flex-1 text-[12px] text-white truncate">{item.label}</span>
                    {item.sub && (
                      <span className="text-[9px] font-mono text-white/40 uppercase tracking-wider">{item.sub}</span>
                    )}
                    {active && <ArrowRight size={11} className="text-white" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-white/10 flex items-center justify-between text-[9px] font-mono text-white/40 uppercase tracking-wider">
          <span>↑↓ navigate · ↵ select</span>
          <span>⌘K to toggle</span>
        </div>
      </div>
    </div>
  );
}
