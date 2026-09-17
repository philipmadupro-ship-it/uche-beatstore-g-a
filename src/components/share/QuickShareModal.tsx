'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  X, Search, Loader2, Music, Link2, Copy, Check, SlidersHorizontal, Disc3, ListMusic,
} from 'lucide-react';
import { toast } from '@/hooks/useToast';
import { copyToClipboard } from '@/lib/clipboard';
import { Dropdown } from '@/components/ui/Dropdown';
import { ArtworkFallback } from '@/components/ui/ArtworkFallback';
import { cn } from '@/lib/utils';
import {
  EMPTY_PICKER_FILTERS,
  filterPickerTracks,
  hasActiveFilters,
  pickerKeyOptions,
  pickerTagOptions,
  type PickerFilters,
  type PickerSort,
  type PickerTrack,
} from '@/lib/share/track-picker';

interface Props {
  onClose: () => void;
  /** Called with the new link info once the share endpoint returns. */
  onCreated?: (link: { token: string; url: string }) => void;
}

/** What a share can point at. */
type ShareTab = 'tracks' | 'projects' | 'playlists';

interface Collection {
  id: string;
  name: string;
  cover_url?: string | null;
  track_count?: number;
  preview_covers?: (string | null)[];
}

/**
 * How many rows are put in the DOM at once.
 *
 * A six-hundred-track library rendered in full makes the modal janky to open
 * and to scroll. The list is already sorted by whatever the producer asked
 * for, so the first slice is the relevant slice; "show more" covers the rest
 * without paying for it up front.
 */
const PAGE_SIZE = 120;

/**
 * Quick share — one link, pointing at whatever you actually want to send.
 *
 * Three tabs, because the thing a producer wants to share is not always a pile
 * of loose beats: a project and a playlist are already curated, and forcing
 * them to be re-picked track by track is asking the user to redo work the app
 * has stored. Tracks post to `/api/share` (ad-hoc, `track_ids[]`); projects
 * and playlists post to their own share endpoints, which produce the modern
 * variant-driven `/projects/share/<token>` page.
 *
 * The track tab is filterable along the axes a producer thinks in — type,
 * genre/mood tag, key, BPM, rating, recency — because at catalogue scale a
 * search box alone only finds what you already remember the name of. The
 * filter logic itself lives in `lib/share/track-picker` so it is testable.
 */
export function QuickShareModal({ onClose, onCreated }: Props) {
  const [tab, setTab] = useState<ShareTab>('tracks');

  const [tracks, setTracks] = useState<PickerTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Collections load lazily — most shares are track shares, and fetching
  // three endpoints to open a modal is two too many.
  const [projects, setProjects] = useState<Collection[]>([]);
  const [playlists, setPlaylists] = useState<Collection[]>([]);
  const [collectionsLoading, setCollectionsLoading] = useState(false);
  const loadedTabs = useRef<Set<ShareTab>>(new Set(['tracks']));
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);

  const [filters, setFilters] = useState<PickerFilters>(EMPTY_PICKER_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const [title, setTitle] = useState('');
  const [allowDownloads, setAllowDownloads] = useState(true);
  const [expiresDays, setExpiresDays] = useState('0');
  const [creating, setCreating] = useState(false);

  // After creation we show the URL + copy button. Mirrors the
  // ProjectShareModal flow so the visual outcome of "I made a link"
  // is consistent.
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/tracks');
        const data = await res.json();
        const list: PickerTrack[] = Array.isArray(data) ? data : data.tracks ?? [];
        setTracks(list);
      } catch (err) {
        console.error('Track fetch failed:', err);
        toast.error('Couldn’t load tracks');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (tab === 'tracks' || loadedTabs.current.has(tab)) return;
    loadedTabs.current.add(tab);
    const endpoint = tab === 'projects' ? '/api/projects' : '/api/playlists';
    setCollectionsLoading(true);
    (async () => {
      try {
        const res = await fetch(endpoint);
        const data = await res.json();
        const list: Collection[] = Array.isArray(data)
          ? data
          : data.projects ?? data.playlists ?? [];
        if (tab === 'projects') setProjects(list);
        else setPlaylists(list);
      } catch (err) {
        console.error('Collection fetch failed:', err);
        toast.error(`Couldn’t load ${tab}`);
      } finally {
        setCollectionsLoading(false);
      }
    })();
  }, [tab]);

  const tagOptions = useMemo(() => pickerTagOptions(tracks), [tracks]);
  const keyOptions = useMemo(() => pickerKeyOptions(tracks), [tracks]);

  const filtered = useMemo(() => filterPickerTracks(tracks, filters), [tracks, filters]);

  // Narrowing the list should show the top of the new list, not page 5 of it.
  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [filters]);

  const visible = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);

  const patchFilters = (patch: Partial<PickerFilters>) =>
    setFilters((prev) => ({ ...prev, ...patch }));

  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  /** Select every track the current filters match — including ones past the
   *  render cap, which is the only reason a "select all" is worth having. */
  const selectAllFiltered = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      filtered.forEach((t) => next.add(t.id));
      return next;
    });
  };

  const collections = tab === 'projects' ? projects : playlists;
  const [collectionSearch, setCollectionSearch] = useState('');
  const visibleCollections = useMemo(() => {
    const q = collectionSearch.trim().toLowerCase();
    if (!q) return collections;
    return collections.filter((c) => c.name.toLowerCase().includes(q));
  }, [collections, collectionSearch]);

  const canSubmit = tab === 'tracks' ? selectedIds.size > 0 : selectedCollectionId !== null;

  const generateLink = async () => {
    if (!canSubmit) {
      toast.error(tab === 'tracks' ? 'Pick at least one track' : `Pick a ${tab.slice(0, -1)}`);
      return;
    }
    setCreating(true);
    try {
      const expires = Number(expiresDays) || 0;
      // Track shares are ad-hoc (no parent row) and go to the legacy endpoint;
      // collections have their own share routes, which stamp content_type so
      // the recipient gets the variant-driven page.
      const endpoint =
        tab === 'tracks'
          ? '/api/share'
          : tab === 'projects'
            ? `/api/projects/${selectedCollectionId}/shares`
            : `/api/playlists/${selectedCollectionId}/shares`;
      const body =
        tab === 'tracks'
          ? {
              track_ids: Array.from(selectedIds),
              title: title.trim() || null,
              // 0 / null clears expiry. The /api/share POST already
              // handles the empty-string case.
              expires_days: expires,
              allow_downloads: allowDownloads,
            }
          : {
              // The collection routes call the display name `label`.
              label: title.trim() || null,
              expires_days: expires,
              allow_downloads: allowDownloads,
            };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      const token: string = data.token ?? data.share?.token;
      setCreatedUrl(data.url);
      onCreated?.({ token, url: data.url });
      toast.success('Share link created');
    } catch (err) {
      toast.error('Couldn’t create link', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setCreating(false);
    }
  };

  const doCopy = async () => {
    if (!createdUrl) return;
    const ok = await copyToClipboard(createdUrl);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const TABS: Array<{ id: ShareTab; label: string; icon: React.ReactNode }> = [
    { id: 'tracks', label: 'Tracks', icon: <Music size={11} /> },
    { id: 'projects', label: 'Projects', icon: <Disc3 size={11} /> },
    { id: 'playlists', label: 'Playlists', icon: <ListMusic size={11} /> },
  ];

  return (
    <div
 className="fixed inset-0 z-[100] flex items-end md:items-center justify-center p-0 md:p-4 bg-black/70 backdrop-blur-md ui-fade-in duration-200"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
 className="w-full md:max-w-[560px] max-h-[90vh] rounded-t-3xl md:rounded-2xl overflow-hidden flex flex-col bg-gradient-to-b from-[#121214]/95 via-[#0e0e10]/95 to-[#090907]/98 backdrop-blur-2xl border border-white/[0.06] shadow-[0_30px_80px_rgba(0,0,0,0.6),0_0_0_1px_rgba(255,255,255,0.03)_inset] ui-pop-up duration-300"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.04]">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-white mb-1">Quick share</p>
            <h2 className="text-[15px] font-medium text-white">
              {tab === 'tracks' ? 'Pick tracks · send a link' : `Pick a ${tab.slice(0, -1)} · send a link`}
            </h2>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/[0.06]">
            <X size={14} />
          </button>
        </div>

        {createdUrl ? (
          // Done-state — same glass card + copy/dismiss as ProjectShareModal.
          <div className="p-6 space-y-4">
            <div className="flex items-center gap-2 bg-white/[0.02] border border-white/20 rounded-xl px-3 py-2.5">
              <Link2 size={12} className="text-white shrink-0" />
              <input
                readOnly
                value={createdUrl}
                onClick={(e) => (e.currentTarget as HTMLInputElement).select()}
                className="flex-1 bg-transparent text-[11px] text-white font-mono focus:outline-none truncate"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={doCopy}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-full bg-white text-black text-[12px] font-medium hover:bg-white transition-all active:scale-[0.98]"
              >
                {copied ? <Check size={13} /> : <Copy size={13} />}
                {copied ? 'Copied' : 'Copy link'}
              </button>
              <button
                onClick={onClose}
                className="px-4 py-3 rounded-full bg-white/[0.04] border border-white/[0.06] text-white text-[12px] hover:bg-white/[0.08] transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* One scroll region for tabs, controls and list.
                
                Previously the filter panel and the list were siblings competing
                for a fixed height, so opening the filters on a short viewport
                pushed the list to zero rows — the control worked and showed you
                nothing. Scrolling them together means the filters simply move
                out of the way as you browse; the footer stays pinned either
                way. */}
            <div className="flex-1 min-h-0 overflow-y-auto">
            {/* What am I sharing? Sits above the search because it changes
                what the search even means. */}
            <div className="px-6 pt-4">
              <div className="flex rounded-full border border-white/10 bg-[#090907] p-1" role="tablist">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={tab === t.id}
                    onClick={() => setTab(t.id)}
                    className={cn(
                      'flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider transition-colors',
                      tab === t.id ? 'bg-white/10 text-white' : 'text-white/60 hover:text-white',
                    )}
                  >
                    {t.icon}
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {tab === 'tracks' ? (
              <>
                <div className="px-6 pt-4 pb-3 space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" size={12} />
                      <input
                        value={filters.search}
                        onChange={(e) => patchFilters({ search: e.target.value })}
                        placeholder="Search title, tag, key, BPM…"
                        className="w-full bg-[#090907] border border-white/10 rounded-md py-2 pl-8 pr-3 text-[11px] text-white placeholder:text-white/30 focus:outline-none focus:border-white/20"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowFilters((v) => !v)}
                      aria-expanded={showFilters}
                      className={cn(
                        'flex items-center gap-1.5 rounded-md border px-3 py-2 text-[10px] font-mono uppercase tracking-wider transition-colors',
                        showFilters || hasActiveFilters(filters)
                          ? 'bg-white/10 border-white/20 text-white'
                          : 'bg-[#090907] border-white/10 text-white/60 hover:text-white',
                      )}
                    >
                      <SlidersHorizontal size={11} />
                      Filter
                    </button>
                  </div>

                  {showFilters && (
                    <div className="space-y-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                      <div className="grid grid-cols-2 gap-2">
                        <Dropdown
                          value={filters.type}
                          onChange={(v) => patchFilters({ type: v })}
                          aria-label="Type"
                          options={[
                            { value: '', label: 'Any type' },
                            { value: 'beat', label: 'Beat' },
                            { value: 'instrumental', label: 'Instrumental' },
                            { value: 'song', label: 'Song' },
                            { value: 'remix', label: 'Remix' },
                          ]}
                          className="bg-[#090907] border border-white/10 rounded-md text-[11px] text-white"
                        />
                        <Dropdown
                          value={filters.tag}
                          onChange={(v) => patchFilters({ tag: v })}
                          aria-label="Tag"
                          options={[
                            { value: '', label: 'Any tag' },
                            ...tagOptions.map((t) => ({ value: t, label: t })),
                          ]}
                          className="bg-[#090907] border border-white/10 rounded-md text-[11px] text-white"
                        />
                        <Dropdown
                          value={filters.key}
                          onChange={(v) => patchFilters({ key: v })}
                          aria-label="Key"
                          options={[
                            { value: '', label: 'Any key' },
                            ...keyOptions.map((k) => ({ value: k, label: k })),
                          ]}
                          className="bg-[#090907] border border-white/10 rounded-md text-[11px] text-white"
                        />
                        <Dropdown
                          value={String(filters.minRating)}
                          onChange={(v) => patchFilters({ minRating: Number(v) })}
                          aria-label="Minimum rating"
                          options={[
                            { value: '0', label: 'Any rating' },
                            { value: '3', label: '3★ and up' },
                            { value: '4', label: '4★ and up' },
                            { value: '5', label: '5★ only' },
                          ]}
                          className="bg-[#090907] border border-white/10 rounded-md text-[11px] text-white"
                        />
                      </div>

                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          inputMode="numeric"
                          value={filters.bpmMin ?? ''}
                          onChange={(e) => patchFilters({ bpmMin: e.target.value === '' ? null : Number(e.target.value) })}
                          placeholder="BPM min"
                          aria-label="Minimum BPM"
                          className="w-full bg-[#090907] border border-white/10 rounded-md px-2.5 py-2 text-[11px] text-white placeholder:text-white/30 focus:outline-none focus:border-white/20"
                        />
                        <span className="text-white/30 text-[11px]">–</span>
                        <input
                          type="number"
                          inputMode="numeric"
                          value={filters.bpmMax ?? ''}
                          onChange={(e) => patchFilters({ bpmMax: e.target.value === '' ? null : Number(e.target.value) })}
                          placeholder="BPM max"
                          aria-label="Maximum BPM"
                          className="w-full bg-[#090907] border border-white/10 rounded-md px-2.5 py-2 text-[11px] text-white placeholder:text-white/30 focus:outline-none focus:border-white/20"
                        />
                      </div>

                      <div className="flex items-center gap-2">
                        <Dropdown
                          value={String(filters.withinDays)}
                          onChange={(v) => patchFilters({ withinDays: Number(v) })}
                          aria-label="Uploaded within"
                          options={[
                            { value: '0', label: 'Any time' },
                            { value: '7', label: 'Last 7 days' },
                            { value: '30', label: 'Last 30 days' },
                            { value: '90', label: 'Last 90 days' },
                          ]}
                          className="flex-1 bg-[#090907] border border-white/10 rounded-md text-[11px] text-white"
                        />
                        <Dropdown
                          value={filters.sort}
                          onChange={(v) => patchFilters({ sort: v as PickerSort })}
                          label="Sort"
                          aria-label="Sort"
                          options={[
                            { value: 'recent', label: 'Newest' },
                            { value: 'title', label: 'Title A→Z' },
                            { value: 'bpm', label: 'BPM ↑' },
                            { value: 'rating', label: 'Rating' },
                          ]}
                          className="flex-1 bg-[#090907] border border-white/10 rounded-md text-[11px] text-white"
                        />
                      </div>

                      {hasActiveFilters(filters) && (
                        <button
                          type="button"
                          onClick={() => setFilters({ ...EMPTY_PICKER_FILTERS, sort: filters.sort })}
                          className="text-[10px] font-mono uppercase tracking-wider text-white/60 hover:text-white"
                        >
                          Clear filters
                        </button>
                      )}
                    </div>
                  )}

                  <div className="sticky top-0 z-10 -mx-6 flex items-center justify-between border-y border-white/[0.04] bg-[#0e0e10]/95 px-6 py-2 text-[10px] font-mono uppercase tracking-wider backdrop-blur-sm">
                    <span className="text-white/40">
                      {selectedIds.size} selected · {filtered.length} shown
                      {filtered.length !== tracks.length && ` of ${tracks.length}`}
                    </span>
                    <span className="flex items-center gap-3">
                      {filtered.length > 0 && (
                        <button onClick={selectAllFiltered} className="text-white/60 hover:text-white">
                          Select {filtered.length}
                        </button>
                      )}
                      {selectedIds.size > 0 && (
                        <button onClick={() => setSelectedIds(new Set())} className="text-white/60 hover:text-white">Clear</button>
                      )}
                    </span>
                  </div>
                </div>

                <div className="px-3 py-2">
                  {loading ? (
                    <div className="flex items-center justify-center py-10 text-white/40">
                      <Loader2 size={14} className="animate-spin" />
                    </div>
                  ) : filtered.length === 0 ? (
                    <p className="text-center py-10 text-[11px] text-white/40">No tracks match.</p>
                  ) : (
                    <>
                      <ul className="space-y-0.5">
                        {visible.map((t) => {
                          const selected = selectedIds.has(t.id);
                          const tags = (t.track_tags ?? [])
                            .filter((tt) => tt.category === 'genre' || tt.category === 'mood')
                            .map((tt) => tt.tag);
                          return (
                            <li key={t.id}>
                              <button
                                onClick={() => toggleOne(t.id)}
                                aria-pressed={selected}
                                className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-left transition-colors ${
                                  selected ? 'bg-white/10 border border-white/20' : 'border border-transparent hover:bg-white/[0.02]'
                                }`}
                              >
                                <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                                  selected ? 'bg-white border-white/30' : 'border-white/20'
                                }`}>
                                  {selected && <Check size={9} className="text-black" strokeWidth={3} />}
                                </div>
                                <div className="relative w-9 h-9 rounded bg-white/[0.04] border border-white/10 overflow-hidden shrink-0">
                                  <ArtworkFallback src={t.cover_url} seed={t.id} kind="track" tags={tags} sizes="36px" className="object-cover">
                                    <Music size={11} aria-hidden="true" />
                                  </ArtworkFallback>
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="text-[12px] text-white truncate">{t.title}</p>
                                  <p className="text-[9px] font-mono uppercase tracking-wider text-white/40 mt-0.5 truncate">
                                    {t.type}{t.bpm ? ` · ${t.bpm} bpm` : ''}{t.key ? ` · ${t.key}${t.scale ? ' ' + t.scale : ''}` : ''}{tags.length > 0 ? ` · ${tags[0]}` : ''}
                                  </p>
                                </div>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                      {filtered.length > visible.length && (
                        <button
                          type="button"
                          onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
                          className="mt-2 w-full rounded-md border border-white/10 py-2 text-[10px] font-mono uppercase tracking-wider text-white/60 transition-colors hover:border-white/20 hover:text-white"
                        >
                          Show {Math.min(PAGE_SIZE, filtered.length - visible.length)} more
                        </button>
                      )}
                    </>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="px-6 pt-4 pb-3 space-y-3">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" size={12} />
                    <input
                      value={collectionSearch}
                      onChange={(e) => setCollectionSearch(e.target.value)}
                      placeholder={`Search ${tab}…`}
                      className="w-full bg-[#090907] border border-white/10 rounded-md py-2 pl-8 pr-3 text-[11px] text-white placeholder:text-white/30 focus:outline-none focus:border-white/20"
                    />
                  </div>
                  <p className="sticky top-0 z-10 -mx-6 border-y border-white/[0.04] bg-[#0e0e10]/95 px-6 py-2 text-[10px] font-mono uppercase tracking-wider text-white/40 backdrop-blur-sm">
                    {visibleCollections.length} {tab}
                    {selectedCollectionId ? ' · 1 selected' : ''}
                  </p>
                </div>

                <div className="px-3 py-2">
                  {collectionsLoading ? (
                    <div className="flex items-center justify-center py-10 text-white/40">
                      <Loader2 size={14} className="animate-spin" />
                    </div>
                  ) : visibleCollections.length === 0 ? (
                    <p className="text-center py-10 text-[11px] text-white/40">
                      No {tab} yet.
                    </p>
                  ) : (
                    <ul className="space-y-0.5">
                      {visibleCollections.map((c) => {
                        const selected = selectedCollectionId === c.id;
                        // One link points at one collection, so this is a
                        // radio, not a checkbox — clicking a second one moves
                        // the choice rather than adding to it.
                        return (
                          <li key={c.id}>
                            <button
                              onClick={() => setSelectedCollectionId(selected ? null : c.id)}
                              role="radio"
                              aria-checked={selected}
                              className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-left transition-colors ${
                                selected ? 'bg-white/10 border border-white/20' : 'border border-transparent hover:bg-white/[0.02]'
                              }`}
                            >
                              <div className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                                selected ? 'bg-white border-white/30' : 'border-white/20'
                              }`}>
                                {selected && <Check size={9} className="text-black" strokeWidth={3} />}
                              </div>
                              <div className="relative w-9 h-9 rounded bg-white/[0.04] border border-white/10 overflow-hidden shrink-0">
                                <ArtworkFallback
                                  src={c.cover_url ?? c.preview_covers?.find(Boolean) ?? null}
                                  seed={c.id}
                                  kind={tab === 'projects' ? 'project' : 'playlist'}
                                  sizes="36px"
                                  className="object-cover"
                                >
                                  {tab === 'projects' ? <Disc3 size={11} aria-hidden="true" /> : <ListMusic size={11} aria-hidden="true" />}
                                </ArtworkFallback>
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-[12px] text-white truncate">{c.name}</p>
                                <p className="text-[9px] font-mono uppercase tracking-wider text-white/40 mt-0.5">
                                  {c.track_count ?? 0} track{(c.track_count ?? 0) === 1 ? '' : 's'}
                                </p>
                              </div>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </>
            )}

            </div>

            <div className="shrink-0 px-6 py-4 border-t border-white/[0.04] space-y-3 bg-[#090907]/40">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Title (optional) — e.g. 'For Phil — March pack'"
                className="w-full bg-[#090907] border border-white/10 rounded-md px-3 py-2 text-[11px] text-white placeholder:text-white/30 focus:outline-none focus:border-white/20"
              />
              <div className="flex items-center gap-2">
                <Dropdown
                  value={expiresDays}
                  onChange={(v) => setExpiresDays(v)}
                  options={[
                    { value: '0',  label: 'Never expires' },
                    { value: '1',  label: '1 day' },
                    { value: '7',  label: '7 days' },
                    { value: '14', label: '14 days' },
                    { value: '30', label: '30 days' },
                  ]}
                  className="flex-1 bg-[#090907] border border-white/10 rounded-md text-[11px] text-white"
                />
                <button
                  onClick={() => setAllowDownloads((v) => !v)}
                  className={`px-3 py-2 rounded-md border text-[10px] font-mono uppercase tracking-wider transition-colors ${
                    allowDownloads ? 'bg-white/10 border-white/20 text-white' : 'bg-[#090907] border-white/10 text-white/40'
                  }`}
                  title="Allow downloads"
                >
                  {allowDownloads ? 'DL on' : 'DL off'}
                </button>
              </div>
              <button
                onClick={generateLink}
                disabled={creating || !canSubmit}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-full bg-white text-black hover:bg-white disabled:opacity-40 text-[12px] font-medium transition-all active:scale-[0.98]"
              >
                {creating ? <Loader2 size={13} className="animate-spin" /> : <Link2 size={13} />}
                {tab === 'tracks'
                  ? `Generate link${selectedIds.size > 0 ? ` · ${selectedIds.size} track${selectedIds.size === 1 ? '' : 's'}` : ''}`
                  : `Generate ${tab.slice(0, -1)} link`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
