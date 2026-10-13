'use client';

/**
 * The command palette inside the org shell (LABEL-36, 08 §A3). The producer
 * dashboard keeps its own palette (`components/nav/CommandPalette`), which
 * steps aside under `/o/*`; this one searches the ORG — artists, songs,
 * releases, people, projects and files — through
 * `GET /api/org/[orgId]/search`, grouped by entity, and jumps straight to
 * the object when the query is an ISRC / ISWC / UPC / IPI.
 *
 * It shows what the server returned and nothing about what it left out: no
 * totals, no "N hidden". Rows with no org page (a contact who is not an
 * artist, a rights party) are listed but not selectable.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight, CalendarDays, FileText, Inbox, Layers, Loader2, Music, Search, Users, User, Disc3, Home,
  type LucideIcon,
} from 'lucide-react';
import { useCommandPalette } from '@/hooks/useCommandPalette';
import { useDialogBehavior } from '@/hooks/useDialogBehavior';
import { useOrgShell } from '@/components/labelos/OrgShellContext';
import { fetchOrgSearch } from '@/lib/labelos/org-search-client';
import {
  EMPTY_SEARCH,
  SEARCH_GROUP_LABEL,
  searchHitHref,
  type OrgSearchResult,
  type SearchGroup,
  type SearchHit,
} from '@/lib/labelos/org-search';

const GROUP_ICON: Record<SearchGroup, LucideIcon> = {
  artists: Users,
  songs: Music,
  releases: Disc3,
  people: User,
  projects: Layers,
  files: FileText,
};

type Row = { key: string; label: string; sub: string | null; icon: LucideIcon; href: string | null; group: string | null };

export function OrgCommandPalette() {
  const shell = useOrgShell();
  const open = useCommandPalette((s) => s.open);
  const setOpen = useCommandPalette((s) => s.setOpen);
  const router = useRouter();
  const [q, setQ] = useState('');
  const [result, setResult] = useState<OrgSearchResult>(EMPTY_SEARCH);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useDialogBehavior({ open, onClose: () => setOpen(false) });
  const orgId = shell?.org.id;
  const slug = shell?.org.slug;

  // ⌘K / Ctrl-K toggles; Escape is useDialogBehavior's.
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

  useEffect(() => {
    if (!open) return;
    setQ('');
    setActiveIdx(0);
    setResult(EMPTY_SEARCH);
    setFailed(false);
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open]);

  // Debounced search; a newer keystroke aborts the older request.
  useEffect(() => {
    if (!open || !orgId) return;
    const text = q.trim();
    if (!text) {
      setResult(EMPTY_SEARCH);
      setLoading(false);
      setFailed(false);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const next = await fetchOrgSearch(orgId, text, ctrl.signal);
        if (ctrl.signal.aborted) return;
        setResult(next);
        setFailed(false);
      } catch {
        if (ctrl.signal.aborted) return;
        setResult(EMPTY_SEARCH);
        setFailed(true);
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 150);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, open, orgId]);

  const rows = useMemo<Row[]>(() => {
    if (!slug) return [];
    const out: Row[] = [];
    const text = q.trim().toLowerCase();
    const go = (label: string, path: string, icon: LucideIcon) => {
      if (!text || label.toLowerCase().includes(text)) out.push({ key: `go-${path}`, label: `Go to ${label}`, sub: null, icon, href: `/o/${slug}${path}`, group: null });
    };
    if (!result.jump) {
      go('Overview', '', Home);
      go('Artists', '/artists', Users);
      go('A&R', '/ar', Inbox);
      go('Releases', '/releases', CalendarDays);
    }
    const push = (h: SearchHit, group: string | null) => {
      out.push({ key: `${h.group}-${h.id}`, label: h.title, sub: h.sub, icon: GROUP_ICON[h.group], href: searchHitHref(slug, h), group });
    };
    if (result.jump) push(result.jump, 'Jump to');
    for (const g of result.groups) for (const h of g.hits) push(h, SEARCH_GROUP_LABEL[g.group]);
    return out;
  }, [q, result, slug]);

  // Keyboard order = the rows that go somewhere.
  const navigable = useMemo(() => rows.map((r, i) => (r.href ? i : -1)).filter((i) => i >= 0), [rows]);

  useEffect(() => {
    if (activeIdx >= navigable.length) setActiveIdx(Math.max(0, navigable.length - 1));
  }, [navigable.length, activeIdx]);

  if (!open || !shell || !slug) return null;

  const run = (row: Row | undefined) => {
    if (!row?.href) return;
    router.push(row.href);
    setOpen(false);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(navigable.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(rows[navigable[activeIdx]]);
    }
  };
  const activeRow = rows[navigable[activeIdx]];

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center pt-32 px-4 bg-black/70 backdrop-blur-sm ui-fade-in duration-150"
      onClick={() => setOpen(false)}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Search ${shell.org.name}`}
        tabIndex={-1}
        className="w-full max-w-xl bg-[#090907] border border-white/10 rounded-xl shadow-[0_24px_60px_-12px_rgba(0,0,0,0.7)] overflow-hidden ui-pop duration-200 focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10">
          <Search size={14} className="text-white/40 shrink-0" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setActiveIdx(0); }}
            onKeyDown={onKey}
            role="combobox"
            aria-expanded="true"
            aria-controls="org-palette-list"
            aria-activedescendant={activeRow ? `org-palette-${activeRow.key}` : undefined}
            aria-label="Search the organization"
            placeholder="Search artists, songs, releases, projects, or paste an ISRC / UPC…"
            className="flex-1 bg-transparent text-[13px] text-white placeholder-white/30 focus:outline-none"
          />
          {loading && <Loader2 size={12} className="animate-spin text-white/60" aria-hidden="true" />}
          <kbd className="text-[9px] font-mono text-white/40 border border-white/10 rounded px-1.5 py-0.5 hidden sm:block">ESC</kbd>
        </div>

        <div id="org-palette-list" role="listbox" aria-label="Results" className="max-h-[50vh] overflow-y-auto">
          {rows.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <p className="text-[11px] text-white/40">
                {failed ? 'Search is unavailable right now' : q.trim() ? (loading ? 'Searching…' : 'No matches') : 'Start typing to search'}
              </p>
            </div>
          ) : (
            <div className="py-1">
              {rows.map((row, i) => {
                const Icon = row.icon;
                const showHeading = row.group !== null && rows[i - 1]?.group !== row.group;
                const active = !!row.href && navigable[activeIdx] === i;
                return (
                  <div key={row.key}>
                    {showHeading && (
                      <div className="px-4 pt-2.5 pb-1 text-[9px] font-mono uppercase tracking-[0.2em] text-white/40">{row.group}</div>
                    )}
                    {row.href ? (
                      <button
                        id={`org-palette-${row.key}`}
                        role="option"
                        aria-selected={active}
                        onClick={() => run(row)}
                        onMouseEnter={() => setActiveIdx(navigable.indexOf(i))}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${active ? 'bg-white/[0.08]' : 'hover:bg-white/[0.04]'}`}
                      >
                        <Icon size={13} className={active ? 'text-white' : 'text-white/60'} />
                        <span className="flex-1 text-[11px] text-white truncate">{row.label}</span>
                        {row.sub && <span className="text-[9px] font-mono text-white/40 uppercase tracking-wider">{row.sub}</span>}
                        {active && <ArrowRight size={11} className="text-white" />}
                      </button>
                    ) : (
                      <div id={`org-palette-${row.key}`} role="option" aria-selected="false" aria-disabled="true" className="w-full flex items-center gap-3 px-4 py-2.5 opacity-60">
                        <Icon size={13} className="text-white/60" />
                        <span className="flex-1 text-[11px] text-white truncate">{row.label}</span>
                        {row.sub && <span className="text-[9px] font-mono text-white/40 uppercase tracking-wider">{row.sub}</span>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="px-4 py-2 border-t border-white/10 flex items-center justify-between text-[9px] font-mono text-white/40 uppercase tracking-wider">
          <span>↑↓ navigate · ↵ open</span>
          <span>⌘K to toggle</span>
        </div>
      </div>
    </div>
  );
}
