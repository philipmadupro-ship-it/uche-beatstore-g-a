'use client';

import { useState } from 'react';
import { Search, ChevronDown, Plus, Download, RefreshCw, Bookmark, BookmarkPlus, X, Check, Pencil, Save } from 'lucide-react';
import { Popover } from '@/components/ui/Popover';
import { LiquidGlassButton } from '@/components/ui/LiquidGlassButton';
import { Dropdown } from '@/components/ui/Dropdown';
import type { ContactSortMode, SortDir } from '@/lib/contacts/filters';

const SORT_OPTIONS: Array<{ value: ContactSortMode; label: string }> = [
  { value: 'recent', label: 'Recently added' },
  { value: 'lastSent', label: 'Last sent' },
  { value: 'lead', label: 'Hottest lead' },
  { value: 'stage', label: 'Pipeline stage' },
  { value: 'revenue', label: 'Revenue' },
  { value: 'sends', label: 'Most sends' },
  { value: 'tags', label: 'Most tagged' },
  { value: 'name', label: 'Name' },
  { value: 'category', label: 'Category' },
];

export interface Segment { id: string; name: string; filters: { search?: string; category?: string; status?: string; sort?: string } }

const CATEGORY_OPTS = ['all', 'buyers', 'rappers', 'producers', 'a&r', 'friends', 'nudge'] as const;
const STATUS_OPTS: { value: string; label: string }[] = [
  { value: 'all', label: 'All activity' },
  { value: 'active', label: 'Active' },
  { value: 'engaged', label: 'Engaged' },
  { value: 'cold', label: 'Cold' },
];

interface Props {
  searchQuery: string; setSearchQuery: (v: string) => void;
  categoryFilter: string; setCategoryFilter: (v: string) => void;
  statusFilter: string; setStatusFilter: (v: string) => void;
  allTags: string[]; tagFilter: Set<string>; toggleTag: (t: string) => void; clearTags: () => void;
  categoryCount: (seg: string) => number;
  segments: Segment[]; activeSegmentId: string | null;
  onApplySegment: (s: Segment) => void; onSaveSegment: () => void; onDeleteSegment: (s: Segment) => void;
  onRenameSegment: (s: Segment) => void; onUpdateSegmentFilters: (s: Segment) => void;
  onExport: () => void; onAddContact: () => void; onRefresh: () => void; refreshing: boolean;
  /** Sort lives here too: the table's sortable headers are hidden on phones. */
  sortMode: ContactSortMode; sortDir: SortDir;
  setSort: (mode: ContactSortMode) => void; toggleSortDir: () => void;
}

function FilterButton({ label, badge, children, align = 'left' }: { label: string; badge?: number; children: (close: () => void) => React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <Popover
      align={align}
      width={220}
      trigger={({ open, toggle, ref }) => (
        <button
          ref={(el) => ref(el)}
          onClick={toggle}
          className={`inline-flex shrink-0 items-center gap-1.5 h-8 px-3 rounded-lg text-[11px] font-medium border transition-colors ${
            open || badge ? 'bg-white/10 border-white/30 text-white' : 'border-[var(--border)] text-white/80 hover:text-white hover:border-[var(--border-hover)]'
          }`}
        >
          {label}
          {badge ? <span className="text-[9px] font-mono border border-white/20 text-white/70 rounded-full px-1.5 py-0.5 leading-none">{badge}</span> : null}
          <ChevronDown size={11} className={open ? 'rotate-180' : ''} />
        </button>
      )}
    >
      {children}
    </Popover>
  );
}

export function ContactsToolbar(p: Props) {
  const [segMenuOpen, setSegMenuOpen] = useState(false);

  return (
    <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      {/* Search — its own full-width row on a phone, with Add next to it so
          the one action you reach for is never scrolled off. */}
      <div className="flex items-center gap-2 sm:min-w-[180px] sm:max-w-sm sm:flex-1">
        <div className="relative min-w-0 flex-1">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
          <input
            value={p.searchQuery}
            onChange={(e) => p.setSearchQuery(e.target.value)}
            placeholder="Search contacts"
            aria-label="Search contacts by name, role, email or tag"
            className="h-9 w-full rounded-lg border border-white/10 bg-[#0D0D0A] pl-8 pr-3 text-[11px] text-white/80 transition-colors placeholder:text-white/40 focus:border-white/30 focus:outline-none sm:h-8"
          />
        </div>
        <button
          type="button"
          onClick={p.onAddContact}
          aria-label="Add contact"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/20 bg-white/[0.10] text-white transition-colors hover:bg-white/[0.14] sm:hidden"
        >
          <Plus size={14} aria-hidden />
        </button>
      </div>

      {/* Filters, sort and utilities: one scrolling row on a phone, wrapping inline on desktop. */}
      <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-0.5 no-scrollbar sm:mx-0 sm:contents sm:overflow-visible sm:px-0">

      {/* Category */}
      <FilterButton label="Category" badge={p.categoryFilter !== 'all' ? 1 : 0}>
        {(close) => (
          <div className="py-1">
            {CATEGORY_OPTS.map((seg) => (
              <button key={seg} onClick={() => { p.setCategoryFilter(seg); close(); }}
                className={`w-full flex items-center justify-between px-3 py-1.5 text-[11px] capitalize transition-colors ${p.categoryFilter === seg ? 'text-black bg-white font-semibold shadow-md hover:bg-white/90' : 'text-white/80 hover:bg-white/5'}`}>
                <span>{seg === 'nudge' ? 'Needs nudge' : seg}</span>
                <span className="text-[10px] font-mono text-white/50">{p.categoryCount(seg)}</span>
              </button>
            ))}
          </div>
        )}
      </FilterButton>

      {/* Status (activity) */}
      <FilterButton label="Status" badge={p.statusFilter !== 'all' ? 1 : 0}>
        {(close) => (
          <div className="py-1">
            {STATUS_OPTS.map((o) => (
              <button key={o.value} onClick={() => { p.setStatusFilter(o.value); close(); }}
                className={`w-full text-left px-3 py-1.5 text-[11px] transition-colors ${p.statusFilter === o.value ? 'text-black bg-white font-semibold shadow-md hover:bg-white/90' : 'text-white/80 hover:bg-white/5'}`}>
                {o.label}
              </button>
            ))}
          </div>
        )}
      </FilterButton>

      {/* Tags (multi) */}
      {p.allTags.length > 0 && (
        <FilterButton label="Tags" badge={p.tagFilter.size}>
          {() => (
            <div className="py-1 max-h-72 overflow-y-auto">
              {p.tagFilter.size > 0 && (
                <button onClick={p.clearTags} className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider text-white/60 hover:text-white">
                  <X size={10} /> Clear tags
                </button>
              )}
              {p.allTags.map((tag) => {
                const on = p.tagFilter.has(tag);
                return (
                  <button key={tag} onClick={() => p.toggleTag(tag)}
                    className={`w-full flex items-center justify-between px-3 py-1.5 text-[11px] transition-colors ${on ? 'text-black bg-white font-semibold shadow-md hover:bg-white/90' : 'text-white/80 hover:bg-white/5'}`}>
                    <span>{tag}</span>
                    {on && <Check size={12} className="text-white" />}
                  </button>
                );
              })}
            </div>
          )}
        </FilterButton>
      )}

      {/* Right cluster */}
      {/* Wraps on narrow screens. Without flex-wrap this group measured 419px
          inside a 343px parent at 375px wide, pushing "Add Contact" (right
          edge 435px) and "Import" (484px) outside the viewport — and because
          nothing scrolls horizontally they were clipped, not merely off-screen,
          making both actions unreachable on a phone. ml-auto only applies once
          there is room to right-align. */}
      <div className="flex shrink-0 items-center gap-2 sm:ml-auto sm:flex-wrap">
        {/* Segments */}
        <Popover
          align="right" width={240}
          open={segMenuOpen} onOpenChange={setSegMenuOpen}
          trigger={({ open, toggle, ref }) => (
            <button ref={(el) => ref(el)} onClick={toggle}
              className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[11px] font-medium border transition-colors ${open || p.activeSegmentId ? 'bg-white/10 border-white/30 text-white' : 'border-[var(--border)] text-white/80 hover:text-white hover:border-[var(--border-hover)]'}`}>
              <Bookmark size={12} /> Segments <ChevronDown size={11} className={open ? 'rotate-180' : ''} />
            </button>
          )}
        >
          {(close) => (
            <div className="py-1">
              {p.segments.length === 0 && <p className="px-3 py-2 text-[11px] text-white/40">No saved segments yet</p>}
              {p.segments.map((seg) => (
                <div key={seg.id} className="group flex items-center">
                  <button onClick={() => { p.onApplySegment(seg); close(); }}
                    className={`flex-1 text-left px-3 py-1.5 text-[11px] transition-colors ${p.activeSegmentId === seg.id ? 'text-black bg-white font-semibold shadow-md hover:bg-white/90' : 'text-white/80 hover:bg-white/5'}`}>
                    {seg.name}
                  </button>
                  <button onClick={() => p.onRenameSegment(seg)} title="Rename segment"
                    className="px-1.5 text-white/40 hover:text-white opacity-0 group-hover:opacity-100"><Pencil size={11} /></button>
                  <button onClick={() => { p.onUpdateSegmentFilters(seg); close(); }} title="Update to current filters"
                    className="px-1.5 text-white/40 hover:text-white opacity-0 group-hover:opacity-100"><Save size={11} /></button>
                  <button onClick={() => p.onDeleteSegment(seg)} title="Delete segment"
                    className="px-1.5 text-white/40 hover:text-red-400 opacity-0 group-hover:opacity-100"><X size={11} /></button>
                </div>
              ))}
              <div className="border-t border-[var(--border)] mt-1 pt-1">
                <button onClick={() => { p.onSaveSegment(); close(); }} className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[11px] text-white hover:bg-white/5">
                  <BookmarkPlus size={12} /> Save current filter
                </button>
              </div>
            </div>
          )}
        </Popover>

        {/* Deferred (follow-up): More Filters ▾, Columns ▾ */}

        <div className="flex items-center gap-1">
          <Dropdown
            value={p.sortMode}
            onChange={(v) => p.setSort(v as ContactSortMode)}
            options={SORT_OPTIONS}
            aria-label="Sort contacts"
          />
          <button
            type="button"
            onClick={p.toggleSortDir}
            aria-label={p.sortDir === 'asc' ? 'Ascending — switch to descending' : 'Descending — switch to ascending'}
            title={p.sortDir === 'asc' ? 'Ascending' : 'Descending'}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.06] font-mono text-[11px] text-white/70 transition-colors hover:border-white/20 hover:bg-white/[0.10] hover:text-white"
          >{p.sortDir === 'asc' ? '↑' : '↓'}</button>
        </div>
        <button onClick={p.onExport} title="Export filtered to CSV"
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[11px] font-medium border border-[var(--border)] text-white/80 hover:text-white hover:border-[var(--border-hover)] transition-colors">
          <Download size={12} /> Export
        </button>
        <button onClick={p.onRefresh} title="Refresh" disabled={p.refreshing}
          className="inline-flex items-center justify-center h-8 w-8 rounded-lg border border-[var(--border)] text-white/80 hover:text-white hover:border-[var(--border-hover)] transition-colors disabled:opacity-50">
          <RefreshCw size={12} className={p.refreshing ? 'animate-spin' : ''} />
        </button>
        <span className="hidden sm:inline-flex">
          <LiquidGlassButton onClick={p.onAddContact} active>
            <Plus size={13} /> Add contact
          </LiquidGlassButton>
        </span>
      </div>
      </div>
    </div>
  );
}
