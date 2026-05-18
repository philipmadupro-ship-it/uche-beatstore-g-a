'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus, Loader2, Search, Mail, Globe, Tag, Users, Send, Upload, Clock, X } from 'lucide-react';
import { Contact, BeatSend } from '@/lib/types';
import { AddContactModal } from '@/components/crm/AddContactModal';
import { SendBeatModal } from '@/components/crm/SendBeatModal';
import { BeatLog } from '@/components/crm/BeatLog';
import { ImportContactsModal } from '@/components/crm/ImportContactsModal';
import { ContactHistoryDrawer } from '@/components/crm/ContactHistoryDrawer';
import { NudgeModal } from '@/components/crm/NudgeModal';
import { toast, confirmToast } from '@/hooks/useToast';
import { Dropdown } from '@/components/ui/Dropdown';
import Link from 'next/link';
import { BatchActionBar, DeleteIcon } from '@/components/ui/BatchActionBar';
import { isTrackDrag, readTrackDragData, type TrackDragPayload } from '@/lib/dnd';

/**
 * Client island that owns the interactive layer of /contacts.
 *
 * Initial data is fetched on the server (RSC) and handed in as props, so the
 * page renders with content on the very first paint. Subsequent mutations
 * (add, import, send) trigger a client-side refetch.
 */
export function ContactsView({
  initialContacts,
  initialBeatSends,
  fetchError,
}: {
  initialContacts: Contact[];
  initialBeatSends: BeatSend[];
  fetchError?: string | null;
}) {
  const [contacts, setContacts] = useState<Contact[]>(initialContacts);
  const [beatSends, setBeatSends] = useState<BeatSend[]>(initialBeatSends);
  const [refreshing, setRefreshing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  // sendQueue can hold one contact (single send) or many (bulk send). The
  // SendBeatModal accepts both shapes through its `contacts` prop.
  const [sendQueue, setSendQueue] = useState<Contact[] | null>(null);
  const [historyContact, setHistoryContact] = useState<Contact | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'network' | 'activity'>('network');
  // CRM filters that operate on top of free-text search. Category narrows
  // the list to a specific contact role (artist / producer / a&r etc).
  // Sort gives the user control over alphabetical vs recency views.
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  // Engagement filter — `all` shows everyone, the others narrow to one
  // pill tone. Toggled by clicking any row's status pill (it sets the
  // filter to that tone, or clears it if already the active filter).
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'engaged' | 'cold'>('all');
  const [sortMode, setSortMode] = useState<'recent' | 'name' | 'category'>('recent');
  const [bulkDeleting, setBulkDeleting] = useState(false);
  // Multi-select state for bulk operations. We keep a Set in state so
  // toggling stays O(1) regardless of contact-count.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // DnD: when the user drags a track over a contact row, this holds the
  // contact id being hovered so we can highlight it. Resets on
  // dragleave / drop.
  const [dropHoverId, setDropHoverId] = useState<string | null>(null);
  // When a track gets dropped on a contact row, we pre-load the
  // SendBeatModal with both the recipient and the track already
  // selected. The modal supports `prefilledTrackIds` for this.
  const [prefilledTrackIds, setPrefilledTrackIds] = useState<string[] | null>(null);
  const [nudgeContact, setNudgeContact] = useState<{ contact: Contact; latestSend: any } | null>(null);

  const handleDropOnContact = (contact: Contact, payload: TrackDragPayload) => {
    setPrefilledTrackIds([payload.id]);
    setSendQueue([contact]);
    setDropHoverId(null);
  };

  const handleChangeCategory = async (contactId: string, newCategory: string | null) => {
    // Optimistic UI update
    setContacts((prev) =>
      prev.map((c) => (c.id === contactId ? { ...c, category: newCategory || null } : c))
    );
    try {
      const res = await fetch(`/api/contacts/${contactId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: newCategory || null }),
      });
      if (!res.ok) {
        toast.error('Failed to change category');
        refetch();
      } else {
        toast.success('Category updated successfully');
      }
    } catch (err) {
      console.error(err);
      toast.error('Failed to change category');
      refetch();
    }
  };

  const refetch = async () => {
    setRefreshing(true);
    try {
      // Contracts:
      //   GET /api/contacts    → Contact[] (raw array)
      //   GET /api/beat_sends  → { sends: BeatSend[] }
      // If either ever drifts, prefer a loud TypeError to a silent empty
      // page. The previous "either shape works" code masked the day the
      // contract changed.
      const [contactsRes, sendsRes] = await Promise.all([
        fetch('/api/contacts'),
        fetch('/api/beat_sends'),
      ]);
      if (!contactsRes.ok) throw new Error(`/api/contacts HTTP ${contactsRes.status}`);
      if (!sendsRes.ok)    throw new Error(`/api/beat_sends HTTP ${sendsRes.status}`);
      const contactsList = (await contactsRes.json()) as Contact[];
      const sends = (await sendsRes.json()) as { sends: BeatSend[] };
      setContacts(contactsList);
      setBeatSends(sends.sends ?? []);
    } catch (err) {
      console.error('Refetch error:', err);
      toast.error('Refresh failed', err instanceof Error ? err.message : 'Network error');
    } finally {
      setRefreshing(false);
    }
  };

  // If the server-side fetch errored, retry on the client once on mount so
  // transient hiccups (e.g. cold-start) don't leave the page empty.
  useEffect(() => {
    if (fetchError && contacts.length === 0) refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Distinct categories present in the loaded contact set, used to
  // populate the dropdown. We don't hardcode the canonical list because
  // imported CSVs can introduce one-off labels — the dropdown should
  // reflect the user's actual data, not a fixed enum.
  const availableCategories = useMemo(() => {
    const seen = new Set<string>();
    for (const c of contacts) if (c.category) seen.add(c.category);
    return Array.from(seen).sort();
  }, [contacts]);

  // Count how many sends each contact has — keys the inline history badge
  // so users can spot "I've already sent Phil 4 things" without opening.
  const sendCountByContact = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of beatSends) {
      map.set(s.contact_id, (map.get(s.contact_id) ?? 0) + 1);
    }
    return map;
  }, [beatSends]);

  // Most recent send per contact — drives the engagement status pill
  // (active / engaged / cold) and the "last sent N days ago" hover
  // hint on the history badge. ISO strings sort lexicographically so
  // a direct `>` compare gives us the most recent without parsing.
  const lastSentByContact = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of beatSends) {
      const cur = map.get(s.contact_id);
      if (!cur || s.sent_at > cur) map.set(s.contact_id, s.sent_at);
    }
    return map;
  }, [beatSends]);

  // Most recent beat_send object per contact — used by the Needs-Nudge
  // filter and the bulk-nudge action. We keep the whole row (not just
  // the timestamp) so the NudgeModal can pre-fill its `latestSend`
  // prop without a second lookup.
  const latestSendByContact = useMemo(() => {
    const map = new Map<string, BeatSend>();
    for (const s of beatSends) {
      const cur = map.get(s.contact_id);
      if (!cur || s.sent_at > cur.sent_at) map.set(s.contact_id, s);
    }
    return map;
  }, [beatSends]);

  // Predicate shared by the row-level "Nudge" badge and the new
  // "Needs nudge" filter chip. A contact needs a nudge when their
  // most recent send is still in the `sent` stage (not opened /
  // interested / placed / pass) and has aged past the 5-day default
  // cadence. Five days = "they had time to listen, didn't reply".
  const NUDGE_AFTER_DAYS = 5;
  const needsNudge = (contactId: string): boolean => {
    const latest = latestSendByContact.get(contactId);
    if (!latest || latest.status !== 'sent') return false;
    const days = (Date.now() - Date.parse(latest.sent_at)) / 86_400_000;
    return days > NUDGE_AFTER_DAYS;
  };

  // Latest send STATUS per contact — drives the new pipeline-stage
  // column. Status updates happen in ContactHistoryDrawer (already
  // wired); this view just reflects whatever the latest send's status
  // is. We index off `sent_at` not `created_at` because the status is
  // tied to send activity, not contact creation.
  const latestStatusByContact = useMemo(() => {
    const latest = new Map<string, { sent_at: string; status: string }>();
    for (const s of beatSends) {
      const cur = latest.get(s.contact_id);
      if (!cur || s.sent_at > cur.sent_at) {
        latest.set(s.contact_id, { sent_at: s.sent_at, status: s.status });
      }
    }
    const map = new Map<string, string>();
    for (const [id, v] of latest) map.set(id, v.status);
    return map;
  }, [beatSends]);

  // Header stats — total contacts, total sends, contacts the user has
  // sent something to ("engaged"), and contacts with activity in the
  // last 30 days ("active"). Same data, three different lenses.
  const stats = useMemo(() => {
    const total = contacts.length;
    const sends = beatSends.length;
    const engaged = new Set(beatSends.map((s) => s.contact_id)).size;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const activeIds = new Set(
      beatSends.filter((s) => s.sent_at >= thirtyDaysAgo).map((s) => s.contact_id),
    );
    return { total, sends, engaged, active: activeIds.size };
  }, [contacts, beatSends]);

  // Per-contact engagement status, derived from last-send recency.
  // Three tiers cover the 80% case without forcing the user to think
  // about exact dates. Also drives the click-to-filter behavior on
  // the row pill — clicking an Active pill narrows the list to
  // Active contacts.
  function statusFor(contactId: string): { label: string; tone: 'active' | 'engaged' | 'cold' } {
    const last = lastSentByContact.get(contactId);
    if (!last) return { label: 'Cold', tone: 'cold' };
    const days = (Date.now() - Date.parse(last)) / 86_400_000;
    if (days <= 30) return { label: 'Active', tone: 'active' };
    return { label: 'Engaged', tone: 'engaged' };
  }

  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase();
    // Snapshot the "active" set inside the memo so we don't reach
    // outside React's tracking. lastSentByContact is already a
    // dependency-stable Map (memoized above), so referencing it
    // inside the closure is safe.
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const isActive = (id: string) => {
      const last = lastSentByContact.get(id);
      return last != null && last >= thirtyDaysAgo;
    };
    const matched = contacts.filter((c) => {
      if (categoryFilter !== 'all') {
        const cat = c.category?.toLowerCase() || '';
        const role = c.role?.toLowerCase() || '';
        if (categoryFilter === 'producers') {
          if (cat !== 'producer' && !role.includes('producer')) return false;
        } else if (categoryFilter === 'rappers') {
          if (cat !== 'rapper' && !role.includes('rapper') && !role.includes('artist') && !role.includes('singer')) return false;
        } else if (categoryFilter === 'a&r') {
          if (cat !== 'a&r' && cat !== 'label' && !role.includes('a&r') && !role.includes('label')) return false;
        } else if (categoryFilter === 'friends') {
          if (cat !== 'friend' && !role.includes('friend')) return false;
        } else if (categoryFilter === 'nudge') {
          // Virtual segment — orthogonal to category. Surfaces only
          // contacts whose most recent send has gone cold and needs a
          // follow-up.
          if (!needsNudge(c.id)) return false;
        }
      }
      // Engagement filter — checks against the same statusFor() tiers.
      if (statusFilter !== 'all') {
        const last = lastSentByContact.get(c.id);
        const tone = !last ? 'cold' : isActive(c.id) ? 'active' : 'engaged';
        if (tone !== statusFilter) return false;
      }
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.role?.toLowerCase().includes(q) ||
        c.label?.toLowerCase().includes(q) ||
        c.category?.toLowerCase().includes(q) ||
        c.email?.toLowerCase().includes(q)
      );
    });
    const sorted = [...matched];
    switch (sortMode) {
      case 'name':
        sorted.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'category':
        // Group-by-category — empty categories collated at end.
        sorted.sort((a, b) => (a.category || '￿').localeCompare(b.category || '￿') ||
                              a.name.localeCompare(b.name));
        break;
      case 'recent':
      default:
        sorted.sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));
    }
    return sorted;
  }, [contacts, searchQuery, categoryFilter, sortMode, statusFilter, lastSentByContact]);

  const selectedContacts = useMemo(
    () => contacts.filter((c) => selectedIds.has(c.id)),
    [contacts, selectedIds],
  );

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => {
    setSelectedIds((prev) =>
      prev.size === filtered.length && filtered.length > 0
        ? new Set()
        : new Set(filtered.map((c) => c.id)),
    );
  };

  // Status helpers moved up to here in this turn so the `filtered`
  // useMemo can call `statusFor()` when narrowing by engagement tone.
  // See the new statusFilter chip strip near the toolbar.

  return (
    <div className="max-w-[1400px] mx-auto px-4 md:px-10 pt-6 md:pt-10">
      {/* Header — title + action row, then stats strip underneath. */}
      <div className="mb-6 pb-6 border-b border-[#16130e]">
        <div className="relative mb-6 rounded-2xl overflow-hidden border border-white/[0.05] bg-gradient-to-br from-[#14110d]/50 via-[#0a0907]/30 to-[#0a0907] p-8">
          {/* Abstract Image Background */}
          <div className="absolute inset-0 z-0 bg-[url('/images/hero-abstract-3.jpg')] bg-cover bg-center opacity-20 mix-blend-overlay" />
          
          <div className="relative z-10 flex flex-col md:flex-row md:items-end md:justify-between gap-4">
            <div>
              <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#6a5d4a] mb-2">CRM</p>
              <h1 className="text-[40px] font-bold tracking-tight text-white leading-none font-heading mb-3">Contacts</h1>
              <p className="text-[11px] text-[#a08a6a] max-w-md">Your network. Sends, statuses, history — all in one place.</p>
            </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center bg-[#14110d] border border-[#1f1a13] rounded-full p-0.5">
              {(['network', 'activity'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setActiveTab(t)}
                  className={`px-3 py-1.5 text-[11px] font-medium rounded-full capitalize transition-colors ${
                    activeTab === t ? 'bg-[#2A2418] text-white' : 'text-[#6a5d4a] hover:text-[#E8DCC8]'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowImportModal(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-full border border-[#1f1a13] bg-[#14110d] text-[#E8DCC8] hover:bg-[#1a160f] hover:border-[#2d2620] text-[11px] font-medium transition-colors"
            >
              <Upload size={13} />
              Import
            </button>
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-full bg-white text-black hover:bg-[#E8DCC8] text-[11px] font-medium transition-colors active:scale-[0.98]"
            >
              <Plus size={13} />
              Add contact
            </button>
          </div>
        </div>
        </div>

        {/* Stats strip — four KPIs as quiet cards. Numbers are big and
            cream; labels are tiny and warm-muted. Stacks 2×2 on mobile,
            4-across on md+. Tone-color on Active matches the engagement
            pill so the page reads as one system. */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Total contacts" value={stats.total.toString()} />
          <StatCard label="Engaged" value={stats.engaged.toString()} hint={stats.total ? `${Math.round((stats.engaged / stats.total) * 100)}%` : undefined} />
          <StatCard label="Active · 30d" value={stats.active.toString()} tone="active" />
          <StatCard label="Total sends" value={stats.sends.toString()} />
        </div>
      </div>

      {activeTab === 'network' ? (
        <>
          {/* Five legendary CRM segment chips */}
          <div className="flex items-center gap-2 mb-4 overflow-x-auto pb-1 scrollbar-hide">
            {(['all', 'rappers', 'producers', 'a&r', 'friends', 'nudge'] as const).map((segment) => {
              const count = contacts.filter((c) => {
                if (segment === 'all') return true;
                if (segment === 'nudge') return needsNudge(c.id);
                const cat = c.category?.toLowerCase() || '';
                const role = c.role?.toLowerCase() || '';
                if (segment === 'producers') return cat === 'producer' || role.includes('producer');
                if (segment === 'rappers') return cat === 'rapper' || role.includes('rapper') || role.includes('artist') || role.includes('singer');
                if (segment === 'a&r') return cat === 'a&r' || cat === 'label' || role.includes('a&r') || role.includes('label');
                if (segment === 'friends') return cat === 'friend' || role.includes('friend');
                return false;
              }).length;
              
              // The "nudge" chip gets an amber tone so it reads as a
              // to-do rather than a taxonomy filter. When count is 0
              // we dim it — nothing actionable, no visual noise.
              const isNudge = segment === 'nudge';
              const nudgeHot = isNudge && count > 0;
              const label = isNudge ? `needs nudge` : segment;
              return (
                <button
                  key={segment}
                  onClick={() => setCategoryFilter(segment)}
                  className={`shrink-0 px-4 py-2 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all flex items-center gap-2 ${
                    categoryFilter === segment
                      ? isNudge
                        ? 'bg-amber-500/90 text-black shadow-lg shadow-amber-500/20'
                        : 'bg-[#D4BFA0] text-black shadow-lg shadow-[#D4BFA0]/15'
                      : nudgeHot
                        ? 'bg-amber-500/10 border border-amber-500/40 text-amber-300 hover:bg-amber-500/20'
                        : 'bg-[#14110d] border border-[#1f1a13] text-[#6a5d4a] hover:text-[#E8DCC8] hover:bg-[#1a160f]'
                  }`}
                >
                  {label}
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-mono font-bold ${
                    categoryFilter === segment ? 'bg-black/10 text-black' : 'bg-white/5 text-[#5a5142]'
                  }`}>{count}</span>
                </button>
              );
            })}
          </div>

          {/* Toolbar — search on the left, sort on the right. Refresh
              spinner overlays the search input when a refetch is in
              flight. */}
          <div className="flex items-center gap-3 mb-6 flex-wrap">
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#3a3328]" size={12} />
              <input
                type="text"
                placeholder="Search by name, role, label, category, email…"
                className="w-full bg-white/[0.03] border border-white/[0.06] rounded-full py-2 pl-8 pr-3 text-[11px] text-[#E8DCC8] placeholder:text-[#3a3328] focus:outline-none focus:border-white/[0.12] transition-colors"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {refreshing && (
                <Loader2 size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6a5d4a] animate-spin" />
              )}
            </div>

            <div className="ml-auto">
              <Dropdown
                value={sortMode}
                onChange={(v) => setSortMode(v as typeof sortMode)}
                options={[
                  { value: 'recent',   label: 'Recent' },
                  { value: 'name',     label: 'Name A→Z' },
                  { value: 'category', label: 'Category' },
                ]}
                label="Sort"
                aria-label="Sort contacts"
              />
            </div>

            {/* Selection CTAs (Send / Delete / Clear) render in the
                floating BatchActionBar at the bottom — consistent with
                library + playlists. */}
          </div>

          {filtered.length === 0 ? (
            // Three empty-state flavours:
            //   1. fetch errored       → show the error
            //   2. filter hides all    → offer "Clear filters"
            //   3. genuinely empty     → offer "Add contact"
            // The previous single-button branch always offered "Add",
            // which is wrong when the user just typed a narrow search
            // and is staring at a misleading CTA.
            <div className="text-center py-32 border border-dashed border-[#1a160f] rounded-lg">
              <Users size={24} className="text-[#3a3328] mx-auto mb-4" />
              {(() => {
                const isFiltered = searchQuery.trim() !== '' || categoryFilter !== 'all';
                if (fetchError) {
                  return (
                    <>
                      <p className="text-sm text-[#E8DCC8] mb-1">Couldn’t load contacts</p>
                      <p className="text-[11px] text-[#5a5142] mb-6 font-mono">{fetchError}</p>
                      <button
                        onClick={refetch}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-[#14110d] border border-[#1a160f] text-[#E8DCC8] hover:border-[#2d2620] text-[11px] font-medium"
                      >
                        Try again
                      </button>
                    </>
                  );
                }
                if (isFiltered && contacts.length > 0) {
                  return (
                    <>
                      <p className="text-sm text-[#E8DCC8] mb-1">No matches</p>
                      <p className="text-[11px] text-[#5a5142] mb-6">
                        {contacts.length} contact{contacts.length !== 1 ? 's' : ''} hidden by current filters.
                      </p>
                      <button
                        onClick={() => { setSearchQuery(''); setCategoryFilter('all'); }}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-[#14110d] border border-[#1a160f] text-[#E8DCC8] hover:border-[#2d2620] text-[11px] font-medium"
                      >
                        Clear filters
                      </button>
                    </>
                  );
                }
                return (
                  <>
                    <p className="text-sm text-[#E8DCC8] mb-1">No contacts</p>
                    <p className="text-[11px] text-[#5a5142] mb-6">Build your network by adding contacts</p>
                    <button
                      onClick={() => setShowAddModal(true)}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-white text-black hover:bg-[#E8DCC8] text-[11px] font-medium"
                    >
                      <Plus size={13} />
                      Add contact
                    </button>
                  </>
                );
              })()}
            </div>
          ) : (
            <div className="border border-[#16130e] rounded-lg overflow-hidden overflow-x-auto w-full custom-scrollbar">
              <div className="min-w-[1200px]">
                {/* Dynamic Grid Headers based on active segment */}
                {categoryFilter === 'producers' ? (
                  <div className="grid grid-cols-[28px_40px_1.5fr_1fr_100px_110px_90px_1.2fr_1.2fr_130px] items-center gap-4 px-4 h-9 border-b border-[#1f1a13] text-[10px] font-mono uppercase tracking-wider text-[#3a3328] bg-[#0a0907]">
                  <input
                    type="checkbox"
                    checked={filtered.length > 0 && selectedIds.size === filtered.length}
                    onChange={toggleSelectAll}
                    className="accent-[#D4BFA0] cursor-pointer"
                    aria-label="Select all visible contacts"
                  />
                  <span />
                  <span>Name</span>
                  <span>Role / Label</span>
                  <span>Status</span>
                  <span>Pipeline</span>
                  <span>Stems</span>
                  <span>Email</span>
                  <span>Instagram</span>
                  <span className="text-right">Actions</span>
                </div>
              ) : categoryFilter === 'a&r' ? (
                <div className="grid grid-cols-[28px_40px_1.5fr_1fr_1fr_100px_110px_1.2fr_1.2fr_130px] items-center gap-4 px-4 h-9 border-b border-[#1f1a13] text-[10px] font-mono uppercase tracking-wider text-[#3a3328] bg-[#0a0907]">
                  <input
                    type="checkbox"
                    checked={filtered.length > 0 && selectedIds.size === filtered.length}
                    onChange={toggleSelectAll}
                    className="accent-[#D4BFA0] cursor-pointer"
                    aria-label="Select all visible contacts"
                  />
                  <span />
                  <span>Name</span>
                  <span>Role</span>
                  <span>Company / Label</span>
                  <span>Status</span>
                  <span>Pipeline</span>
                  <span>Email</span>
                  <span>Instagram</span>
                  <span className="text-right">Actions</span>
                </div>
              ) : (
                <div className="grid grid-cols-[28px_40px_1.5fr_1fr_110px_120px_160px_160px_150px] items-center gap-4 px-4 h-9 border-b border-[#1f1a13] text-[10px] font-mono uppercase tracking-wider text-[#3a3328] bg-[#0a0907]">
                  <input
                    type="checkbox"
                    checked={filtered.length > 0 && selectedIds.size === filtered.length}
                    onChange={toggleSelectAll}
                    className="accent-[#D4BFA0] cursor-pointer"
                    aria-label="Select all visible contacts"
                  />
                  <span />
                  <span>Name</span>
                  <span>Role / Label</span>
                  <span>Status</span>
                  <span>Pipeline</span>
                  <span>Email</span>
                  <span>Instagram</span>
                  <span className="text-right">Actions</span>
                </div>
              )}
              {filtered.map((contact) => {
                const isSelected = selectedIds.has(contact.id);
                const isDropTarget = dropHoverId === contact.id;
                const sendCount = sendCountByContact.get(contact.id) ?? 0;
                
                // Smart Follow-up nudge calculation
                const latestSend = beatSends.find(s => s.contact_id === contact.id);
                const daysDiff = latestSend ? (Date.now() - Date.parse(latestSend.sent_at)) / 86_400_000 : 0;
                const contactNeedsNudge = latestSend?.status === 'sent' && daysDiff > 5;

                // Mock stems check for Producer view
                const isProducer = contact.category?.toLowerCase() === 'producer' || contact.role?.toLowerCase().includes('producer');
                const hasStems = isProducer && sendCount > 0;

                const gridRowClass = 
                  categoryFilter === 'producers'
                    ? 'grid grid-cols-[28px_40px_1.5fr_1fr_100px_110px_90px_1.2fr_1.2fr_130px]'
                    : categoryFilter === 'a&r'
                      ? 'grid grid-cols-[28px_40px_1.5fr_1fr_1fr_100px_110px_1.2fr_1.2fr_130px]'
                      : 'grid grid-cols-[28px_40px_1.5fr_1fr_110px_120px_160px_160px_150px]';

                return (
                  <div
                    key={contact.id}
                    onDragOver={(e) => {
                      if (!isTrackDrag(e)) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'copy';
                      if (dropHoverId !== contact.id) setDropHoverId(contact.id);
                    }}
                    onDragLeave={(e) => {
                      const next = e.relatedTarget as Node | null;
                      if (!next || !(e.currentTarget as Node).contains(next)) {
                        setDropHoverId((cur) => (cur === contact.id ? null : cur));
                      }
                    }}
                    onDrop={(e) => {
                      const payload = readTrackDragData(e);
                      if (!payload) {
                        setDropHoverId(null);
                        return;
                      }
                      e.preventDefault();
                      handleDropOnContact(contact, payload);
                    }}
                    className={`${gridRowClass} items-center gap-4 px-4 h-14 border-b border-[#1f1a13] transition-colors last:border-b-0 ${
                      isDropTarget
                        ? 'bg-[#2A2418] ring-2 ring-[#D4BFA0]/60 ring-inset'
                        : isSelected
                          ? 'bg-[#2A2418]/30'
                          : 'hover:bg-[#1a160f]'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelect(contact.id)}
                      className="accent-[#D4BFA0] cursor-pointer"
                      aria-label={`Select ${contact.name}`}
                    />
                    <div className="w-8 h-8 rounded-full bg-[#16130e] border border-[#1a160f] flex items-center justify-center text-[11px] font-medium text-[#E8D8B8]">
                      {contact.name[0]?.toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <Link
                          href={`/contacts/${contact.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="text-[13px] font-medium text-[#E8DCC8] truncate hover:text-[#E8D8B8] transition-colors block"
                        >
                          {contact.name}
                        </Link>
                        {contactNeedsNudge && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (latestSend) {
                                setNudgeContact({ contact, latestSend });
                              }
                            }}
                            className="bg-amber-500/15 border border-amber-500/40 text-[#D4BFA0] hover:bg-amber-500/35 hover:border-amber-500/80 text-[7px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded animate-pulse shrink-0 cursor-pointer transition-all"
                            title="Click to trigger a polite follow-up email nudge"
                          >
                            Nudge
                          </button>
                        )}
                      </div>
                      <p className="text-[10px] font-mono text-[#5a5142] uppercase tracking-wider mt-0.5">
                        {new Date(contact.created_at).toLocaleDateString()}
                      </p>
                    </div>

                    {categoryFilter === 'a&r' ? (
                      <>
                        <div className="min-w-0">
                          <p className="text-[12px] text-[#a08a6a] truncate">{contact.role || '—'}</p>
                          <div className="mt-1" onClick={(e) => e.stopPropagation()}>
                            <Dropdown
                              value={contact.category || 'none'}
                              onChange={(val) => {
                                const finalVal = val === 'none' ? null : val;
                                handleChangeCategory(contact.id, finalVal);
                              }}
                              options={[
                                { value: 'none', label: 'Move...' },
                                { value: 'rapper', label: 'Rapper' },
                                { value: 'producer', label: 'Producer' },
                                { value: 'a&r', label: 'A&R / Label' },
                                { value: 'friend', label: 'Friend' }
                              ]}
                              className="bg-[#0c0a08] border border-[#1f1a13] hover:border-[#D4BFA0]/50 text-[#6a5d4a] hover:text-[#E8DCC8] rounded py-1 px-2.5 text-[9px] font-mono uppercase tracking-wider focus:outline-none cursor-pointer transition-all h-7 w-28"
                            />
                          </div>
                        </div>
                        <div className="min-w-0">
                          <p className="text-[12px] text-[#E8DCC8] truncate font-medium">{contact.label || '—'}</p>
                        </div>
                      </>
                    ) : (
                      <div className="min-w-0">
                        <p className="text-[12px] text-[#a08a6a] truncate">{contact.role || '—'}</p>
                        <div className="flex items-center gap-1.5 mt-1 flex-wrap" onClick={(e) => e.stopPropagation()}>
                          <Dropdown
                            value={contact.category || 'none'}
                            onChange={(val) => {
                              const finalVal = val === 'none' ? null : val;
                              handleChangeCategory(contact.id, finalVal);
                            }}
                            options={[
                              { value: 'none', label: 'Move...' },
                              { value: 'rapper', label: 'Rapper' },
                              { value: 'producer', label: 'Producer' },
                              { value: 'a&r', label: 'A&R / Label' },
                              { value: 'friend', label: 'Friend' }
                            ]}
                            className="bg-[#0c0a08] border border-[#1f1a13] hover:border-[#D4BFA0]/50 text-[#6a5d4a] hover:text-[#E8DCC8] rounded py-1 px-2.5 text-[9px] font-mono uppercase tracking-wider focus:outline-none cursor-pointer transition-all h-7 w-28"
                          />
                          {contact.label && (
                            <p className="text-[10px] text-[#6a5d4a] truncate flex items-center gap-1">
                              <Tag size={9} />
                              {contact.label}
                            </p>
                          )}
                        </div>
                      </div>
                    )}

                    {(() => {
                      const s = statusFor(contact.id);
                      return (
                        <StatusPill
                          tone={s.tone}
                          label={s.label}
                          active={statusFilter === s.tone}
                          onClick={(tone) => setStatusFilter((cur) => (cur === tone ? 'all' : tone))}
                        />
                      );
                    })()}
                    
                    <PipelinePill status={latestStatusByContact.get(contact.id) ?? null} />
                    
                    {/* Producers View Stems Indicator column */}
                    {categoryFilter === 'producers' && (
                      <div>
                        {hasStems ? (
                          <span className="bg-green-500/10 border border-green-500/30 text-green-400 text-[8px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded">
                            Attached
                          </span>
                        ) : (
                          <span className="text-[#3a3328] font-mono text-[10px]">None</span>
                        )}
                      </div>
                    )}

                    <div className="flex items-center gap-1.5 text-[11px] text-[#a08a6a] truncate">
                      {contact.email ? (
                        <>
                          <Mail size={11} className="text-[#3a3328] shrink-0" />
                          <span className="truncate">{contact.email}</span>
                        </>
                      ) : (
                        <span className="text-[#3a3328]">—</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px] text-[#a08a6a] truncate">
                      {contact.instagram ? (
                        <>
                          <Globe size={11} className="text-[#3a3328] shrink-0" />
                          <span className="truncate">@{contact.instagram}</span>
                        </>
                      ) : (
                        <span className="text-[#3a3328]">—</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 justify-end">
                      <button
                        onClick={() => setHistoryContact(contact)}
                        className={`relative flex items-center gap-2 px-2.5 py-1.5 rounded-full border text-[10px] font-medium transition-colors ${
                          sendCount > 0
                            ? 'border-[#2d2620] text-[#E8D8B8] hover:bg-[#2A2418] hover:border-[#8A7A5C]/60'
                            : 'border-[#1f1a13] text-[#6a5d4a] hover:text-[#a08a6a] hover:border-[#2d2620]'
                        }`}
                        title={sendCount > 0
                          ? `${sendCount} send${sendCount === 1 ? '' : 's'} · last ${relativeDays(lastSentByContact.get(contact.id))}`
                          : 'No sends yet — click to open history'}
                      >
                        <Clock size={10} />
                        {sendCount > 0 ? (
                          <>
                            <span className="font-mono tabular-nums">{sendCount}</span>
                            <span className="text-[#6a5d4a] hidden md:inline">·</span>
                            <span className="text-[#6a5d4a] font-mono hidden md:inline">{relativeDays(lastSentByContact.get(contact.id))}</span>
                          </>
                        ) : (
                          <span className="font-mono">0</span>
                        )}
                      </button>
                      <button
                        onClick={() => setSendQueue([contact])}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border border-[#2d2620] text-[10px] font-medium text-[#E8D8B8] hover:bg-[#2A2418] hover:border-[#8A7A5C]/60 transition-colors"
                      >
                        <Send size={10} />
                        Send
                      </button>
                    </div>
                  </div>
                );
              })}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="border border-[#16130e] rounded-lg overflow-hidden">
          <BeatLog sends={beatSends} contacts={contacts} />
        </div>
      )}

      {showAddModal && <AddContactModal onClose={() => setShowAddModal(false)} onSuccess={refetch} />}
      {showImportModal && (
        <ImportContactsModal onClose={() => setShowImportModal(false)} onSuccess={refetch} />
      )}
      {sendQueue && sendQueue.length > 0 && (
        <SendBeatModal
          contacts={sendQueue}
          // Pre-populated track set when the modal was opened via a
          // track-on-contact drop. `null` means "let the user choose".
          initialTrackIds={prefilledTrackIds ?? undefined}
          onClose={() => {
            setSendQueue(null);
            setPrefilledTrackIds(null);
          }}
          onSuccess={() => {
            refetch();
            setPrefilledTrackIds(null);
            // Clear multi-select after a successful bulk send so the
            // user isn't left with stale checked boxes.
            setSelectedIds(new Set());
          }}
        />
      )}
      {historyContact && (
        <ContactHistoryDrawer
          contact={historyContact}
          sends={beatSends.filter((s) => s.contact_id === historyContact.id)}
          onClose={() => setHistoryContact(null)}
          onSendAgain={() => {
            // "Send again" pre-loads the modal with this contact and
            // closes the history drawer in one motion.
            setSendQueue([historyContact]);
            setHistoryContact(null);
          }}
        />
      )}

      {/* Floating batch-action bar — appears when ≥1 contact is checked.
          Send + Delete share the same UI surface for consistency with the
          library and playlists pages. Parallel DELETE keeps wall time
          ~constant in selection size; failures get tallied in the toast. */}
      <BatchActionBar
        count={selectedIds.size}
        noun={['contact', 'contacts']}
        onClear={() => setSelectedIds(new Set())}
        busy={bulkDeleting}
        actions={[
          {
            label: `Send to ${selectedIds.size}`,
            icon: <Send size={11} />,
            intent: 'primary',
            onClick: () => setSendQueue(selectedContacts),
          },
          {
            label: 'Delete',
            icon: <DeleteIcon size={11} />,
            intent: 'danger',
            onClick: async () => {
              const ok = await confirmToast(
                `Delete ${selectedIds.size} contact${selectedIds.size === 1 ? '' : 's'}?`,
                'Their send history will be removed too. This is permanent.',
                { confirmLabel: 'Delete', cancelLabel: 'Keep', danger: true },
              );
              if (!ok) return;
              setBulkDeleting(true);
              const ids = Array.from(selectedIds);
              const results = await Promise.allSettled(
                ids.map((id) =>
                  fetch(`/api/contacts/${id}`, { method: 'DELETE' }).then((r) => {
                    if (!r.ok) throw new Error(`HTTP ${r.status}`);
                  }),
                ),
              );
              const failed = results.filter((r) => r.status === 'rejected').length;
              setBulkDeleting(false);
              setSelectedIds(new Set());
              await refetch();
              if (failed === 0) {
                toast.success(`Deleted ${ids.length} contact${ids.length === 1 ? '' : 's'}`);
              } else {
                toast.warning(
                  `Deleted ${ids.length - failed}, ${failed} failed`,
                  'Failed contacts kept in the list — try again or check the network tab.',
                );
              }
            },
          },
        ]}
      />

      {nudgeContact && (
        <NudgeModal
          contact={nudgeContact.contact}
          latestSend={nudgeContact.latestSend}
          onClose={() => setNudgeContact(null)}
          onSuccess={refetch}
        />
      )}
    </div>
  );
}

/**
 * Quiet stat tile used in the contacts header. Numbers in cream-bone,
 * label in warm muted. The `tone` prop tints the value when the metric
 * is "engagement-positive" — keeps the page reading as one system
 * with the row-level status pills.
 */
function StatCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'active';
}) {
  return (
    <div className="rounded-xl border border-[#1f1a13] bg-[#14110d] px-4 py-3 flex items-baseline justify-between gap-2">
      <div className="min-w-0">
        <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#6a5d4a]">{label}</p>
        <p className={`text-[24px] font-medium tabular-nums leading-tight mt-1 ${
          tone === 'active' ? 'text-[#E8D8B8]' : 'text-[#E8DCC8]'
        }`}>
          {value}
        </p>
      </div>
      {hint && (
        <span className="text-[10px] font-mono text-[#6a5d4a] tabular-nums shrink-0">{hint}</span>
      )}
    </div>
  );
}

/**
 * Per-contact engagement status pill. Dot + label. Three tones:
 *   - active  — sent within 30 days (amber dot)
 *   - engaged — has at least one send, but stale  (warm gray dot)
 *   - cold    — never been sent (faint outline)
 * Visual hierarchy: active pops, engaged reads, cold recedes.
 */
/**
 * Compact "Xd ago" formatter for the history badge. Keeps the cell
 * narrow — full timestamps live in the drawer that opens on click.
 * Returns "—" for missing input so the badge gracefully covers
 * contacts with no sends.
 */
function relativeDays(iso: string | undefined | null): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  const days = Math.floor((Date.now() - t) / 86_400_000);
  if (days < 1) return 'today';
  if (days === 1) return '1d';
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  return `${Math.floor(months / 12)}y`;
}

/**
 * Pipeline-stage pill — reflects the most recent beat_send's status
 * for a contact. Each stage gets its own tone so the page reads at a
 * glance: amber/orange = momentum, green = won, red = lost, neutral
 * gray = early. Stage transitions happen elsewhere (in the
 * ContactHistoryDrawer); this is purely a presentational view.
 */
const PIPELINE_TONES: Record<string, { dot: string; text: string; ring: string; label: string }> = {
  sent:         { dot: 'bg-[#6a5d4a]', text: 'text-[#a08a6a]', ring: 'ring-[#2d2620]',       label: 'Sent' },
  opened:       { dot: 'bg-[#7aa8e8]', text: 'text-[#7aa8e8]', ring: 'ring-[#3a4a6a]',       label: 'Opened' },
  interested:   { dot: 'bg-[#E8D8B8]', text: 'text-[#E8D8B8]', ring: 'ring-[#8A7A5C]/40',    label: 'Interested' },
  negotiating:  { dot: 'bg-[#e8a86a]', text: 'text-[#e8a86a]', ring: 'ring-[#8A7A5C]/40',    label: 'Negotiating' },
  placed:       { dot: 'bg-[#6DC6A4]', text: 'text-[#6DC6A4]', ring: 'ring-[#1f5a4a]',       label: 'Placed' },
  pass:         { dot: 'bg-[#e88a8a]', text: 'text-[#e88a8a]', ring: 'ring-[#6a2a2a]',       label: 'Pass' },
};

function PipelinePill({ status }: { status: string | null }) {
  if (!status) {
    return <span className="text-[10px] text-[#3a3328]">—</span>;
  }
  const tone = PIPELINE_TONES[status] ?? PIPELINE_TONES.sent;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium ring-1 ring-inset ${tone.ring} ${tone.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${tone.dot}`} />
      {tone.label}
    </span>
  );
}

function StatusPill({
  tone,
  label,
  onClick,
  active,
}: {
  tone: 'active' | 'engaged' | 'cold';
  label: string;
  /** When set the pill becomes a button — clicking calls onClick(tone). */
  onClick?: (tone: 'active' | 'engaged' | 'cold') => void;
  /** Visual "this filter is currently on" state — bumps the pill into a
   *  solid fill so the click feedback is unmistakable. */
  active?: boolean;
}) {
  const dot = tone === 'active' ? 'bg-[#E8D8B8]' : tone === 'engaged' ? 'bg-[#8A7A5C]' : 'bg-[#3a3328]';
  const text = tone === 'active' ? 'text-[#E8D8B8]' : tone === 'engaged' ? 'text-[#a08a6a]' : 'text-[#6a5d4a]';
  const ring = tone === 'active' ? 'ring-[#8A7A5C]/40' : 'ring-[#2d2620]';
  // When active (selected as the filter) we flip to a solid amber wash
  // so the user sees "this filter is on" at a glance, regardless of
  // which row's pill they originally clicked.
  const activeClasses = active ? 'bg-[#2A2418] ring-[#D4BFA0]/60' : 'hover:bg-white/[0.03]';
  const Comp: 'button' | 'span' = onClick ? 'button' : 'span';
  return (
    <Comp
      onClick={onClick ? (e) => { e.stopPropagation(); onClick(tone); } : undefined}
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium ring-1 ring-inset ${ring} ${text} ${onClick ? `cursor-pointer transition-colors ${activeClasses}` : ''}`}
      title={onClick ? `Filter to ${label.toLowerCase()} contacts` : undefined}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dot} ${tone === 'active' ? 'animate-pulse' : ''}`} />
      {label}
    </Comp>
  );
}
