'use client';

import { useState } from 'react';
import { Search, ChevronDown, Plus, Download, RefreshCw, Bookmark, BookmarkPlus, X, Check, Loader2 } from 'lucide-react';
import { Popover } from '@/components/ui/Popover';

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
  onExport: () => void; onAddContact: () => void; onRefresh: () => void; refreshing: boolean;
}

function FilterButton({ label, badge, children, align = 'left' }: { label: string; badge?: number; children: (close: () => void) => React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <Popover
      align={align}
      width={220}
      trigger={({ open, toggle, ref }) => (
        <button
          ref={ref as any}
          onClick={toggle}
          className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[11px] font-medium border transition-colors ${
            open || badge ? 'bg-[var(--accent-tint)] border-[var(--accent-dim)]/40 text-[#F3E6D1]' : 'border-[var(--border)] text-[#D0C3AF] hover:text-[#F7EBDD] hover:border-[var(--border-hover)]'
          }`}
        >
          {label}
          {badge ? <span className="text-[9px] font-mono bg-[var(--accent)] text-black rounded-full px-1.5 py-0.5 leading-none">{badge}</span> : null}
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
    <div className="flex items-center gap-2 mb-4 flex-wrap">
      {/* Search */}
      <div className="relative flex-1 min-w-[180px] max-w-sm">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6E685B] pointer-events-none" />
        <input
          value={p.searchQuery}
          onChange={(e) => p.setSearchQuery(e.target.value)}
          placeholder="Search name, role, email, tag…"
          className="w-full h-8 bg-[var(--bg-card)] border border-[var(--border)] rounded-md pl-8 pr-3 text-[12px] text-[var(--text-primary)] placeholder:text-[#6E685B] focus:outline-none focus:border-[var(--border-hover)] transition-colors"
        />
      </div>

      {/* Category */}
      <FilterButton label="Category" badge={p.categoryFilter !== 'all' ? 1 : 0}>
        {(close) => (
          <div className="py-1">
            {CATEGORY_OPTS.map((seg) => (
              <button key={seg} onClick={() => { p.setCategoryFilter(seg); close(); }}
                className={`w-full flex items-center justify-between px-3 py-1.5 text-[12px] capitalize transition-colors ${p.categoryFilter === seg ? 'text-[#F3E6D1] bg-[#1A1813]' : 'text-[#D0C3AF] hover:bg-[#1A1813]'}`}>
                <span>{seg === 'nudge' ? 'Needs nudge' : seg}</span>
                <span className="text-[10px] font-mono text-[#9B9282]">{p.categoryCount(seg)}</span>
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
                className={`w-full text-left px-3 py-1.5 text-[12px] transition-colors ${p.statusFilter === o.value ? 'text-[#F3E6D1] bg-[#1A1813]' : 'text-[#D0C3AF] hover:bg-[#1A1813]'}`}>
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
                <button onClick={p.clearTags} className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider text-[#9B9282] hover:text-[#F7EBDD]">
                  <X size={10} /> Clear tags
                </button>
              )}
              {p.allTags.map((tag) => {
                const on = p.tagFilter.has(tag);
                return (
                  <button key={tag} onClick={() => p.toggleTag(tag)}
                    className={`w-full flex items-center justify-between px-3 py-1.5 text-[12px] transition-colors ${on ? 'text-[#F3E6D1] bg-[#1A1813]' : 'text-[#D0C3AF] hover:bg-[#1A1813]'}`}>
                    <span>{tag}</span>
                    {on && <Check size={12} className="text-[var(--accent)]" />}
                  </button>
                );
              })}
            </div>
          )}
        </FilterButton>
      )}

      {/* Right cluster */}
      <div className="flex items-center gap-2 ml-auto">
        {/* Segments */}
        <Popover
          align="right" width={240}
          open={segMenuOpen} onOpenChange={setSegMenuOpen}
          trigger={({ open, toggle, ref }) => (
            <button ref={ref as any} onClick={toggle}
              className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[11px] font-medium border transition-colors ${open || p.activeSegmentId ? 'bg-[var(--accent-tint)] border-[var(--accent-dim)]/40 text-[#F3E6D1]' : 'border-[var(--border)] text-[#D0C3AF] hover:text-[#F7EBDD] hover:border-[var(--border-hover)]'}`}>
              <Bookmark size={12} /> Segments <ChevronDown size={11} className={open ? 'rotate-180' : ''} />
            </button>
          )}
        >
          {(close) => (
            <div className="py-1">
              {p.segments.length === 0 && <p className="px-3 py-2 text-[11px] text-[#6E685B]">No saved segments yet</p>}
              {p.segments.map((seg) => (
                <div key={seg.id} className="group flex items-center">
                  <button onClick={() => { p.onApplySegment(seg); close(); }}
                    className={`flex-1 text-left px-3 py-1.5 text-[12px] transition-colors ${p.activeSegmentId === seg.id ? 'text-[#F3E6D1] bg-[#1A1813]' : 'text-[#D0C3AF] hover:bg-[#1A1813]'}`}>
                    {seg.name}
                  </button>
                  <button onClick={() => p.onDeleteSegment(seg)} className="px-2 text-[#6E685B] hover:text-red-400 opacity-0 group-hover:opacity-100"><X size={11} /></button>
                </div>
              ))}
              <div className="border-t border-[var(--border)] mt-1 pt-1">
                <button onClick={() => { p.onSaveSegment(); close(); }} className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[11px] text-[var(--accent)] hover:bg-[#1A1813]">
                  <BookmarkPlus size={12} /> Save current filter
                </button>
              </div>
            </div>
          )}
        </Popover>

        {/* Deferred (follow-up): More Filters ▾, Columns ▾ */}

        <button onClick={p.onExport} title="Export filtered to CSV"
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[11px] font-medium border border-[var(--border)] text-[#D0C3AF] hover:text-[#F7EBDD] hover:border-[var(--border-hover)] transition-colors">
          <Download size={12} /> Export
        </button>
        <button onClick={p.onRefresh} title="Refresh" disabled={p.refreshing}
          className="inline-flex items-center justify-center h-8 w-8 rounded-md border border-[var(--border)] text-[#D0C3AF] hover:text-[#F7EBDD] hover:border-[var(--border-hover)] transition-colors disabled:opacity-50">
          <RefreshCw size={12} className={p.refreshing ? 'animate-spin' : ''} />
        </button>
        <button onClick={p.onAddContact}
          className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md text-[12px] font-medium bg-white text-black hover:bg-[#F7EBDD] transition-colors active:scale-[0.98]">
          <Plus size={14} /> Add Contact
        </button>
      </div>
    </div>
  );
}
