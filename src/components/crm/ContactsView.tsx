'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Users, Upload, Send, Mail } from 'lucide-react';
import { Contact, BeatSend } from '@/lib/types';
import { filterAndSortContacts, paginate, type ContactFilterState, type ContactSortMode, type SortDir } from '@/lib/contacts/filters';
import type { CrmStage } from '@/lib/contracts';
import { AddContactModal } from '@/components/crm/AddContactModal';
import { SendBeatModal } from '@/components/crm/SendBeatModal';
import { BeatLog } from '@/components/crm/BeatLog';
import { ImportContactsModal } from '@/components/crm/ImportContactsModal';
import { ContactHistoryDrawer } from '@/components/crm/ContactHistoryDrawer';
import { NudgeModal } from '@/components/crm/NudgeModal';
import { toast, confirmToast } from '@/hooks/useToast';
import { BatchActionBar, DeleteIcon } from '@/components/ui/BatchActionBar';
import { isTrackDrag, readTrackDragData, type TrackDragPayload } from '@/lib/dnd';
import { contactsToCsv, downloadCsv } from '@/lib/contacts/export';
import { ContactsStatsBar } from '@/components/crm/ContactsStatsBar';
import { FollowUpsPanel } from '@/components/crm/FollowUpsPanel';
import { ContactsToolbar, type Segment } from '@/components/crm/ContactsToolbar';
import { ContactsTable } from '@/components/crm/ContactsTable';
import { ContactsPagination } from '@/components/crm/ContactsPagination';
import { ContactsTableSkeleton, type ActivityTone } from '@/components/crm/contacts-shared';
import { BulkEditPanel } from '@/components/crm/BulkEditPanel';

/**
 * Client island that owns the interactive layer of /contacts.
 * Initial data is fetched on the server (RSC) and handed in as props.
 *
 * This component is the stateful container; presentation lives in the
 * extracted Toolbar / Table / Pagination / StatsBar / BulkEditPanel children.
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
  const [sendQueue, setSendQueue] = useState<Contact[] | null>(null);
  const [historyContact, setHistoryContact] = useState<Contact | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'network' | 'activity'>('network');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'engaged' | 'cold'>('all');
  const [sortMode, setSortMode] = useState<ContactSortMode>('recent');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [tagFilter, setTagFilter] = useState<Set<string>>(new Set());
  // Pagination — replaces the old infinite-scroll window.
  const [pageSize, setPageSize] = useState(50);
  const [currentPage, setCurrentPage] = useState(1);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkNudging, setBulkNudging] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [dropHoverId, setDropHoverId] = useState<string | null>(null);
  const [prefilledTrackIds, setPrefilledTrackIds] = useState<string[] | null>(null);
  const [nudgeContact, setNudgeContact] = useState<{ contact: Contact; latestSend: any } | null>(null);
  // Bulk-edit panel: which batch operation is open.
  const [bulkPanel, setBulkPanel] = useState<'stage' | 'addTags' | 'removeTags' | null>(null);

  const [segments, setSegments] = useState<Segment[]>([]);
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/contacts/segments')
      .then((r) => (r.ok ? r.json() : { segments: [] }))
      .then((d) => setSegments(d.segments ?? []))
      .catch(() => {});
  }, []);

  const saveSegment = async () => {
    const name = window.prompt('Name this segment (e.g. "Active buyers"):')?.trim();
    if (!name) return;
    const filters = {
      ...(searchQuery.trim() ? { search: searchQuery.trim() } : {}),
      ...(categoryFilter !== 'all' ? { category: categoryFilter } : {}),
      ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
      sort: sortMode,
    };
    try {
      const res = await fetch('/api/contacts/segments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, filters }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setSegments((prev) => [...prev, data.segment]);
      setActiveSegmentId(data.segment.id);
      toast.success('Segment saved');
    } catch (err) { toast.error("Couldn't save segment", err instanceof Error ? err.message : ''); }
  };

  const applySegment = (seg: Segment) => {
    setActiveSegmentId(seg.id);
    setCategoryFilter(seg.filters.category ?? 'all');
    setStatusFilter((seg.filters.status as any) ?? 'all');
    setSortMode((seg.filters.sort as any) ?? 'recent');
    setSearchQuery(seg.filters.search ?? '');
  };

  const deleteSegment = async (seg: Segment) => {
    const ok = await confirmToast(`Delete segment "${seg.name}"?`, 'Your contacts are untouched.', { confirmLabel: 'Delete', cancelLabel: 'Keep', danger: true });
    if (!ok) return;
    setSegments((prev) => prev.filter((s) => s.id !== seg.id));
    if (activeSegmentId === seg.id) setActiveSegmentId(null);
    try { await fetch(`/api/contacts/segments/${seg.id}`, { method: 'DELETE' }); }
    catch { toast.error("Couldn't delete segment"); }
  };

  const handleDropOnContact = (contact: Contact, payload: TrackDragPayload) => {
    setPrefilledTrackIds([payload.id]);
    setSendQueue([contact]);
    setDropHoverId(null);
  };

  const refetch = async () => {
    setRefreshing(true);
    try {
      const [contactsRes, sendsRes] = await Promise.all([fetch('/api/contacts'), fetch('/api/beat_sends')]);
      if (!contactsRes.ok) throw new Error(`/api/contacts HTTP ${contactsRes.status}`);
      if (!sendsRes.ok) throw new Error(`/api/beat_sends HTTP ${sendsRes.status}`);
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

  useEffect(() => {
    if (fetchError && contacts.length === 0) refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Derived maps ──────────────────────────────────────────────────────
  // Lead scores — batched from /api/contacts/scores (sends/opens/clicks +
  // purchases). Drives the "Hottest" sort + the per-row tier dot.
  const [leadScoreByContact, setLeadScoreByContact] = useState<Map<string, number>>(new Map());
  const [leadTierByContact, setLeadTierByContact] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    let cancelled = false;
    fetch('/api/contacts/scores')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d?.scores) return;
        const sMap = new Map<string, number>();
        const tMap = new Map<string, string>();
        for (const [id, v] of Object.entries(d.scores as Record<string, { score: number; tier: string }>)) {
          sMap.set(id, v.score);
          tMap.set(id, v.tier);
        }
        setLeadScoreByContact(sMap);
        setLeadTierByContact(tMap);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const sendCountByContact = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of beatSends) map.set(s.contact_id, (map.get(s.contact_id) ?? 0) + 1);
    return map;
  }, [beatSends]);

  const lastSentByContact = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of beatSends) { const cur = map.get(s.contact_id); if (!cur || s.sent_at > cur) map.set(s.contact_id, s.sent_at); }
    return map;
  }, [beatSends]);

  const latestSendByContact = useMemo(() => {
    const map = new Map<string, BeatSend>();
    for (const s of beatSends) { const cur = map.get(s.contact_id); if (!cur || s.sent_at > cur.sent_at) map.set(s.contact_id, s); }
    return map;
  }, [beatSends]);

  const NUDGE_AFTER_DAYS = 5;
  const needsNudge = (contactId: string): boolean => {
    const latest = latestSendByContact.get(contactId);
    if (!latest || latest.status !== 'sent') return false;
    return (Date.now() - Date.parse(latest.sent_at)) / 86_400_000 > NUDGE_AFTER_DAYS;
  };

  const latestStatusByContact = useMemo(() => {
    const latest = new Map<string, { sent_at: string; status: string }>();
    for (const s of beatSends) { const cur = latest.get(s.contact_id); if (!cur || s.sent_at > cur.sent_at) latest.set(s.contact_id, { sent_at: s.sent_at, status: s.status }); }
    const map = new Map<string, string>();
    for (const [id, v] of latest) map.set(id, v.status);
    return map;
  }, [beatSends]);

  // Derived activity tone (read-only) — distinct from the editable crm_status stage.
  const toneFor = (contactId: string): ActivityTone => {
    const last = lastSentByContact.get(contactId);
    if (!last) return 'cold';
    return (Date.now() - Date.parse(last)) / 86_400_000 <= 30 ? 'active' : 'engaged';
  };

  const stats = useMemo(() => {
    const total = contacts.length;
    const sends = beatSends.length;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const active = new Set(beatSends.filter((s) => s.sent_at >= thirtyDaysAgo).map((s) => s.contact_id)).size;
    const responded = beatSends.filter((s) => !['sent'].includes(s.status ?? 'sent')).length;
    const responseRate = sends > 0 ? Math.round((responded / sends) * 100) : 0;
    const pipeline: Record<string, number> = { sent: 0, opened: 0, interested: 0, negotiating: 0, placed: 0, pass: 0 };
    for (const s of beatSends) { const st = (s.status as string) ?? 'sent'; if (st in pipeline) pipeline[st]++; }
    const openedCount = beatSends.filter((s) => (s as any).opened_at).length;
    const needNudge = contacts.reduce((n, c) => n + (needsNudge(c.id) ? 1 : 0), 0);
    return { total, sends, active, needNudge, responseRate, pipeline, openedCount };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contacts, beatSends, latestSendByContact]);

  const allTags = useMemo(() => {
    const seen = new Set<string>();
    for (const c of contacts) for (const t of c.tags ?? []) seen.add(t.tag);
    return [...seen].sort();
  }, [contacts]);

  const needsNudgeIds = useMemo(() => {
    const s = new Set<string>();
    for (const c of contacts) if (needsNudge(c.id)) s.add(c.id);
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contacts, latestSendByContact]);

  // Count for each category segment (toolbar dropdown).
  const categoryCount = (seg: string): number => {
    if (seg === 'all') return contacts.length;
    return contacts.filter((c) => {
      if (seg === 'nudge') return needsNudge(c.id);
      const cat = c.category?.toLowerCase() || '';
      const role = c.role?.toLowerCase() || '';
      if (seg === 'buyers') return cat === 'buyer';
      if (seg === 'producers') return cat === 'producer' || role.includes('producer');
      if (seg === 'rappers') return cat === 'rapper' || role.includes('rapper') || role.includes('artist') || role.includes('singer');
      if (seg === 'a&r') return cat === 'a&r' || cat === 'label' || role.includes('a&r') || role.includes('label');
      if (seg === 'friends') return cat === 'friend' || role.includes('friend');
      return false;
    }).length;
  };

  const filtered = useMemo(() => {
    const fState: ContactFilterState = { search: searchQuery, category: categoryFilter as any, status: statusFilter, sort: sortMode, sortDir, tags: tagFilter };
    return filterAndSortContacts(contacts, fState, { lastSentByContact, needsNudgeIds, sendCountByContact, leadScoreByContact });
  }, [contacts, searchQuery, categoryFilter, sortMode, sortDir, statusFilter, tagFilter, lastSentByContact, needsNudgeIds, sendCountByContact, leadScoreByContact]);

  // Reset to page 1 whenever the result set changes.
  useEffect(() => { setCurrentPage(1); }, [searchQuery, categoryFilter, statusFilter, sortMode, sortDir, tagFilter, pageSize]);

  const paginated = useMemo(() => paginate(filtered, currentPage, pageSize), [filtered, currentPage, pageSize]);

  const selectedContacts = useMemo(() => contacts.filter((c) => selectedIds.has(c.id)), [contacts, selectedIds]);

  const toggleSelect = (id: string) => setSelectedIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const pageIds = paginated.map((c) => c.id);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
  const toggleSelectPage = () => setSelectedIds((prev) => {
    const n = new Set(prev);
    if (allPageSelected) pageIds.forEach((id) => n.delete(id)); else pageIds.forEach((id) => n.add(id));
    return n;
  });
  const selectAllFiltered = () => setSelectedIds(new Set(filtered.map((c) => c.id)));

  // Sort: clicking a column toggles direction (or activates it descending first for recency/count).
  const onSort = (col: ContactSortMode) => {
    if (sortMode === col) { setSortDir((d) => (d === 'asc' ? 'desc' : 'asc')); return; }
    setSortMode(col);
    setSortDir(col === 'name' ? 'asc' : 'desc');
  };

  // Inline stage edit — update local state; the StageCell does the PATCH.
  const onStageChange = (id: string, next: CrmStage | null) =>
    setContacts((prev) => prev.map((c) => (c.id === id ? { ...c, crm_status: next } : c)));

  // DnD row handlers (track-on-contact).
  const onRowDragOver = (id: string, e: React.DragEvent) => { if (isTrackDrag(e)) { e.preventDefault(); setDropHoverId(id); } };
  const onRowDragLeave = (e: React.DragEvent) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setDropHoverId(null); };
  const onRowDrop = (contact: Contact, e: React.DragEvent) => {
    const payload = readTrackDragData(e);
    if (payload) { e.preventDefault(); handleDropOnContact(contact, payload); }
  };

  const exportFiltered = () => {
    downloadCsv(`contacts-${new Date().toISOString().slice(0, 10)}.csv`, contactsToCsv(filtered));
    toast.success(`Exported ${filtered.length} contact${filtered.length === 1 ? '' : 's'}`);
  };
  const exportSelected = () => {
    downloadCsv(`contacts-selection-${new Date().toISOString().slice(0, 10)}.csv`, contactsToCsv(selectedContacts));
    toast.success(`Exported ${selectedContacts.length}`);
  };

  const isFiltered = searchQuery.trim() !== '' || categoryFilter !== 'all' || statusFilter !== 'all' || tagFilter.size > 0;
  const staleSelected = selectedContacts.filter((c) => needsNudge(c.id) && c.email);

  return (
    <div className="max-w-[1400px] mx-auto px-4 md:px-10 pt-6 md:pt-10">
      {/* Header */}
      <div className="flex items-end justify-between gap-4 mb-5 flex-wrap">
        <div>
          <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#6a5d4a] mb-2">CRM</p>
          <h1 className="text-[32px] md:text-[40px] font-bold tracking-tight text-white leading-none font-heading">Contacts</h1>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-[var(--bg-card)] border border-[var(--border)] rounded-md p-0.5">
            {(['network', 'activity'] as const).map((t) => (
              <button key={t} onClick={() => setActiveTab(t)}
                className={`px-3 py-1.5 text-[11px] font-medium rounded capitalize transition-colors ${activeTab === t ? 'bg-[#2A2418] text-white' : 'text-[#6a5d4a] hover:text-[#E8DCC8]'}`}>
                {t}
              </button>
            ))}
          </div>
          <button onClick={() => setShowImportModal(true)}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-[var(--border)] bg-[var(--bg-card)] text-[#E8DCC8] hover:border-[var(--border-hover)] text-[11px] font-medium transition-colors">
            <Upload size={13} /> Import
          </button>
        </div>
      </div>

      {activeTab === 'network' ? (
        <>
          <FollowUpsPanel />

          <ContactsStatsBar stats={stats} />

          <ContactsToolbar
            searchQuery={searchQuery} setSearchQuery={setSearchQuery}
            categoryFilter={categoryFilter} setCategoryFilter={(v) => { setCategoryFilter(v); setActiveSegmentId(null); }}
            statusFilter={statusFilter} setStatusFilter={(v) => setStatusFilter(v as any)}
            allTags={allTags} tagFilter={tagFilter}
            toggleTag={(t) => setTagFilter((prev) => { const n = new Set(prev); n.has(t) ? n.delete(t) : n.add(t); return n; })}
            clearTags={() => setTagFilter(new Set())}
            categoryCount={categoryCount}
            segments={segments} activeSegmentId={activeSegmentId}
            onApplySegment={applySegment} onSaveSegment={saveSegment} onDeleteSegment={deleteSegment}
            onExport={exportFiltered} onAddContact={() => setShowAddModal(true)} onRefresh={refetch} refreshing={refreshing}
          />

          {refreshing && contacts.length === 0 ? (
            <div className="border border-[var(--border)] rounded-xl overflow-hidden bg-[var(--bg-card)]">
              <ContactsTableSkeleton rows={10} />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-24 border border-dashed border-[var(--border)] rounded-xl bg-[var(--bg-card)]">
              <Users size={26} className="text-[#3a3328] mx-auto mb-4" />
              {fetchError ? (
                <>
                  <p className="text-sm text-[#E8DCC8] mb-1">Couldn&apos;t load contacts</p>
                  <p className="text-[11px] text-[#5a5142] mb-5 font-mono">{fetchError}</p>
                  <button onClick={refetch} className="inline-flex items-center gap-2 h-9 px-4 rounded-md bg-white text-black text-[12px] font-medium hover:bg-[#E8DCC8] transition-colors">Try again</button>
                </>
              ) : isFiltered ? (
                <>
                  <p className="text-sm text-[#E8DCC8] mb-1">No matches</p>
                  <p className="text-[11px] text-[#5a5142] mb-5">{contacts.length} contact{contacts.length === 1 ? '' : 's'} total — try widening your filters.</p>
                  <button onClick={() => { setSearchQuery(''); setCategoryFilter('all'); setStatusFilter('all'); setTagFilter(new Set()); setActiveSegmentId(null); }}
                    className="text-[#a08a6a] hover:text-[#E8DCC8] text-[11px] underline underline-offset-2">Clear filters</button>
                </>
              ) : (
                <>
                  <p className="text-sm text-[#E8DCC8] mb-1">No contacts yet</p>
                  <p className="text-[11px] text-[#5a5142] mb-5">Add your first contact or import a CSV.</p>
                  <button onClick={() => setShowAddModal(true)} className="inline-flex items-center gap-2 h-9 px-4 rounded-md bg-white text-black text-[12px] font-medium hover:bg-[#E8DCC8] transition-colors">Add contact</button>
                </>
              )}
            </div>
          ) : (
            <>
              <ContactsTable
                contacts={paginated}
                selectedIds={selectedIds}
                onToggleSelect={toggleSelect}
                onToggleSelectPage={toggleSelectPage}
                allPageSelected={allPageSelected}
                sortMode={sortMode} sortDir={sortDir} onSort={onSort}
                sendCountByContact={sendCountByContact}
                lastSentByContact={lastSentByContact}
                latestStatusByContact={latestStatusByContact}
                leadScoreByContact={leadScoreByContact}
                leadTierByContact={leadTierByContact}
                toneFor={toneFor}
                statusFilter={statusFilter}
                onFilterTone={(t) => setStatusFilter((cur) => (cur === t ? 'all' : t))}
                needsNudge={needsNudge}
                onOpenHistory={(c) => setHistoryContact(c)}
                onSend={(c) => setSendQueue([c])}
                onNudge={(c) => { const latest = latestSendByContact.get(c.id); if (latest) setNudgeContact({ contact: c, latestSend: latest }); }}
                onStageChange={onStageChange}
                dropHoverId={dropHoverId}
                onRowDragOver={onRowDragOver}
                onRowDragLeave={onRowDragLeave}
                onRowDrop={onRowDrop}
              />
              <ContactsPagination total={filtered.length} page={currentPage} pageSize={pageSize} onPage={setCurrentPage} onPageSize={setPageSize} />
            </>
          )}
        </>
      ) : (
        <div className="border border-[var(--border)] rounded-xl overflow-hidden">
          <BeatLog sends={beatSends} contacts={contacts} />
        </div>
      )}

      {/* ── Modals (unchanged behaviour) ── */}
      {showAddModal && <AddContactModal onClose={() => setShowAddModal(false)} onSuccess={refetch} />}
      {showImportModal && <ImportContactsModal onClose={() => setShowImportModal(false)} onSuccess={refetch} />}
      {sendQueue && sendQueue.length > 0 && (() => {
        // Derive all track IDs ever sent to any of the queued recipients,
        // so the modal can badge them "Sent before".
        const recipientIdSet = new Set(sendQueue.map((c) => c.id));
        const prior = new Set<string>();
        for (const s of beatSends) {
          if (recipientIdSet.has(s.contact_id)) {
            for (const tid of s.track_ids ?? []) prior.add(tid);
          }
        }
        return (
          <SendBeatModal
            contacts={sendQueue}
            initialTrackIds={prefilledTrackIds ?? undefined}
            priorSentTrackIds={prior.size > 0 ? prior : undefined}
            onClose={() => { setSendQueue(null); setPrefilledTrackIds(null); }}
            onSuccess={() => { refetch(); setPrefilledTrackIds(null); setSelectedIds(new Set()); }}
          />
        );
      })()}
      {historyContact && (
        <ContactHistoryDrawer
          contact={historyContact}
          sends={beatSends.filter((s) => s.contact_id === historyContact.id)}
          onClose={() => setHistoryContact(null)}
          onSendAgain={() => { setSendQueue([historyContact]); setHistoryContact(null); }}
        />
      )}
      {nudgeContact && (
        <NudgeModal contact={nudgeContact.contact} latestSend={nudgeContact.latestSend} onClose={() => setNudgeContact(null)} onSuccess={refetch} />
      )}
      {bulkPanel && (
        <BulkEditPanel
          mode={bulkPanel}
          ids={Array.from(selectedIds)}
          onClose={() => setBulkPanel(null)}
          onDone={() => { setBulkPanel(null); setSelectedIds(new Set()); refetch(); }}
        />
      )}

      {/* Batch action bar */}
      <BatchActionBar
        count={selectedIds.size}
        noun={['contact', 'contacts']}
        onClear={() => setSelectedIds(new Set())}
        busy={bulkDeleting || bulkNudging}
        actions={[
          { label: `Send to ${selectedIds.size}`, icon: <Send size={11} />, intent: 'primary', onClick: () => setSendQueue(selectedContacts) },
          { label: 'Stage', onClick: () => setBulkPanel('stage') },
          { label: 'Add tags', onClick: () => setBulkPanel('addTags') },
          { label: 'Remove tags', onClick: () => setBulkPanel('removeTags') },
          { label: 'Export CSV', onClick: exportSelected },
          ...(staleSelected.length > 0 ? [{
            label: `Nudge ${staleSelected.length}`,
            icon: <Mail size={11} />,
            onClick: async () => {
              const ok = await confirmToast(
                `Nudge ${staleSelected.length} stale contact${staleSelected.length === 1 ? '' : 's'}?`,
                'Sends a polite follow-up email and bumps each one to "negotiating". Contacts without email are skipped.',
                { confirmLabel: 'Send nudges', cancelLabel: 'Cancel' },
              );
              if (!ok) return;
              setBulkNudging(true);
              const results = await Promise.allSettled(staleSelected.map(async (c) => {
                const latest = latestSendByContact.get(c.id);
                if (!latest) throw new Error('no send');
                const message = `Hi ${c.name},\n\nJust circling back on what I sent over recently — wanted to make sure it didn't get buried. Let me know if any of it caught your ear, or if you'd like to hear something in a different lane.\n\nBest,`;
                const emailRes = await fetch('/api/email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contactId: c.id, email: c.email, trackIds: latest.track_ids, shareToken: latest.share_token, message }) });
                if (!emailRes.ok) throw new Error(`email ${emailRes.status}`);
                await fetch(`/api/beat_sends/${latest.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'negotiating' }) });
              }));
              const failed = results.filter((r) => r.status === 'rejected').length;
              setBulkNudging(false);
              setSelectedIds(new Set());
              await refetch();
              if (failed === 0) toast.success(`Nudged ${staleSelected.length} contact${staleSelected.length === 1 ? '' : 's'}`);
              else toast.warning(`Nudged ${staleSelected.length - failed}, ${failed} failed`);
            },
          }] : []),
          {
            label: 'Delete',
            icon: <DeleteIcon size={11} />,
            intent: 'danger',
            onClick: async () => {
              const ok = await confirmToast(`Delete ${selectedIds.size} contact${selectedIds.size === 1 ? '' : 's'}?`, 'Their send history will be removed too. This is permanent.', { confirmLabel: 'Delete', cancelLabel: 'Keep', danger: true });
              if (!ok) return;
              setBulkDeleting(true);
              const ids = Array.from(selectedIds);
              const results = await Promise.allSettled(ids.map((id) => fetch(`/api/contacts/${id}`, { method: 'DELETE' }).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); })));
              const failed = results.filter((r) => r.status === 'rejected').length;
              setBulkDeleting(false);
              setSelectedIds(new Set());
              await refetch();
              if (failed === 0) toast.success(`Deleted ${ids.length} contact${ids.length === 1 ? '' : 's'}`);
              else toast.warning(`Deleted ${ids.length - failed}, ${failed} failed`);
            },
          },
        ]}
      />

      {/* "Select all N filtered" affordance — shown when a partial page selection exists. */}
      {selectedIds.size > 0 && selectedIds.size < filtered.length && (
        <div className="fixed bottom-44 left-1/2 -translate-x-1/2 z-40">
          <button onClick={selectAllFiltered}
            className="text-[10px] font-mono uppercase tracking-wider px-3 py-1.5 rounded-full bg-[#0e0c08] border border-[var(--border-hover)] text-[#a08a6a] hover:text-[#E8DCC8] shadow-lg transition-colors">
            Select all {filtered.length} filtered
          </button>
        </div>
      )}
    </div>
  );
}
