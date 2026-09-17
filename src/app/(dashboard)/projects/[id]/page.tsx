'use client';

/**
 * /projects/[id] = production workspace detail.
 * Holds a project's tracks, references, stems, and version history.
 */

import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { PageContainer } from '@/components/layout/PageHeader';
import { TrackDetailsDrawer } from '@/components/tracks/TrackDetailsDrawer';
import { DropZone } from '@/components/upload/DropZone';
import { ContentShareModal } from '@/components/share/ContentShareModal';
import { ProjectCommentsPanel } from '@/components/projects/ProjectCommentsPanel';
import { AddFromLibraryModal } from '@/components/projects/AddFromLibraryModal';
import { ProjectDetailHeader } from '@/components/projects/ProjectDetailHeader';
import { ProjectTrackList } from '@/components/projects/ProjectTrackList';
import { ProjectChecklist, type ChecklistItem } from '@/components/projects/ProjectChecklist';
import { ToplineRecorder } from '@/components/lyrics/ToplineRecorder';
import { ProjectAnalyticsPanel } from '@/components/projects/ProjectAnalyticsPanel';
import { Loader2, ListPlus } from 'lucide-react';
import { Track } from '@/lib/types';
import { usePlayer } from '@/hooks/usePlayer';
import { toast, confirmToast } from '@/hooks/useToast';
import { BatchActionBar, DeleteIcon } from '@/components/ui/BatchActionBar';
import { uploadImageFile } from '@/lib/upload/image-upload-client';
import { CoverEditor } from '@/components/ui/CoverEditor';

type ProjectStatus = 'in_progress' | 'final' | 'archived';

type ProjectDetail = {
  id: string;
  name: string;
  cover_url: string | null;
  description?: string | null;
  price_usd?: number | null;
  store_featured?: boolean;
  bpm_target?: number | null;
  key_target?: string | null;
  checklist?: ChecklistItem[];
  status?: ProjectStatus;
};

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export default function ProjectWorkspacePage({ params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = React.use(paramsPromise);
  const searchParams = useSearchParams();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadingArt, setUploadingArt] = useState(false);
  const [removingArt, setRemovingArt] = useState(false);
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null);
  const [activeTab, setActiveTab] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [showUpload, setShowUpload] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showAddFromLibrary, setShowAddFromLibrary] = useState(false);
  const [priceUsd, setPriceUsd] = useState<string>('');
  const [savingStorefront, setSavingStorefront] = useState(false);
  // Multi-select state — Set for O(1) toggle. Mirrors playlists +
  // contacts patterns so the floating BatchActionBar feels the same
  // across the app.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [togglingStoreFeatured, setTogglingStoreFeatured] = useState(false);

  const { setTrack: setGlobalTrack, setQueue } = usePlayer();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const startHandledRef = useRef(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const prRes = await fetch(`/api/projects/${params.id}`);
      const prData = await prRes.json();
      if (prData.project) {
        setProject(prData.project);
        setPriceUsd(
          prData.project.price_usd != null ? String(prData.project.price_usd) : '',
        );
      }
      // `no-store` is load-bearing. /api/tracks answers with
      // `stale-while-revalidate=60`, so a plain fetch after a write resolves
      // with the PRE-write body while the fresh copy arrives only as a
      // background revalidation this promise never sees. That is why a rating
      // set on this page reappeared as empty stars after a reload — the write
      // had persisted, the screen was reading a cached response.
      const tracksRes = await fetch(`/api/tracks?project_id=${params.id}`, { cache: 'no-store' });
      const tracksData = await tracksRes.json();
      setTracks(Array.isArray(tracksData) ? tracksData : tracksData.tracks || []);
    } catch (err) {
      console.error('Fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [params.id]);

  useEffect(() => {
    if (startHandledRef.current || loading || !project) return;
    const start = searchParams.get('start');
    if (start === 'library') {
      setShowAddFromLibrary(true);
      startHandledRef.current = true;
    } else if (start === 'upload') {
      setShowUpload(true);
      startHandledRef.current = true;
    }
  }, [loading, project, searchParams]);

  const filtered = tracks.filter((t) => {
    if (activeTab !== 'All') {
      const typeMap: Record<string, string> = { Beats: 'beat', Songs: 'song', Instrumentals: 'instrumental', Remixes: 'remix' };
      if (t.type !== typeMap[activeTab]) return false;
    }
    if (searchQuery && !t.title.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const handleArtChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingArt(true);
    try {
      const coverUrl = await uploadImageFile(file);
      const patch = await fetch(`/api/projects/${params.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cover_url: coverUrl }),
      });
      if (!patch.ok) {
        const e = await patch.json().catch(() => ({}));
        toast.error('Could not save cover', e.error || `HTTP ${patch.status}`);
        return;
      }
      fetchData();
    } catch (err) {
      toast.error('Cover upload failed', err instanceof Error ? err.message : 'Try again');
    } finally {
      setUploadingArt(false);
    }
  };

  /** Clear the cover — the project falls back to the default project artwork. */
  const handleArtRemove = async () => {
    setRemovingArt(true);
    try {
      const patch = await fetch(`/api/projects/${params.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cover_url: null }),
      });
      if (!patch.ok) {
        const e = await patch.json().catch(() => ({}));
        toast.error('Could not remove cover', e.error || `HTTP ${patch.status}`);
        return;
      }
      toast.success('Cover removed');
      fetchData();
    } catch (err) {
      toast.error('Could not remove cover', err instanceof Error ? err.message : 'Try again');
    } finally {
      setRemovingArt(false);
    }
  };

  // patchProject — single source of truth for the three "edit a project
  // field" handlers below. The previous implementations all PATCHed and
  // then locally mutated `project` regardless of HTTP status, so a 400
  // (e.g. unknown column, value too long) or 401 would surface as a
  // *successful* save in the UI that vanished on next refresh.
  const patchProject = async (
    patch: Record<string, unknown>,
    successLabel?: string,
  ): Promise<boolean> => {
    try {
      const res = await fetch(`/api/projects/${params.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error('Save failed', j?.error || `HTTP ${res.status}`);
        return false;
      }
      setProject((p) => p ? ({ ...p, ...patch }) : p);
      if (successLabel) toast.success(successLabel);
      return true;
    } catch (err) {
      toast.error('Save failed', err instanceof Error ? err.message : 'Network error');
      return false;
    }
  };

  // The three header editors below all funnel into patchProject and report
  // back whether the save landed, so an inline field can stay open on a
  // rejected save instead of closing over a value the server never took.
  const handleRename = async (next: string) => {
    if (!next) return false;
    return patchProject({ name: next });
  };

  const saveTargets = (patch: { bpm_target?: number | null; key_target?: string | null }) =>
    patchProject(patch);

  const saveDescription = (next: string) =>
    patchProject({ description: next === '' ? null : next });

  const setStatus = async (status: ProjectStatus) => {
    await patchProject({ status });
  };

  const toggleStoreFeatured = async () => {
    if (togglingStoreFeatured) return;
    const next = !project?.store_featured;
    setTogglingStoreFeatured(true);
    await patchProject(
      { store_featured: next },
      next ? 'Featured in store' : 'Removed from featured',
    );
    setTogglingStoreFeatured(false);
  };

  /**
   * Price is the only field left on the storefront card — the description
   * moved up into the header, where it is autosaved next to the project it
   * describes rather than behind a Save button at the bottom of the page.
   */
  const savePrice = async () => {
    setSavingStorefront(true);
    const priceParsed = priceUsd.trim() === '' ? null : Number.parseFloat(priceUsd);
    if (priceParsed != null && (Number.isNaN(priceParsed) || priceParsed < 0)) {
      toast.error('Invalid price', 'Enter a non-negative number');
      setSavingStorefront(false);
      return;
    }
    await patchProject({ price_usd: priceParsed }, 'Price saved');
    setSavingStorefront(false);
  };

  const handlePlayTrack = (track: Track) => {
    setQueue(filtered);
    setGlobalTrack(track);
  };

  const handlePlayProject = () => {
    if (filtered.length > 0) handlePlayTrack(filtered[0]);
  };

  const handleRemoveFromProject = async (trackId: string) => {
    const ok = await confirmToast(
      'Remove track from project?',
      'The track stays in your library — only the project link is removed.',
      { confirmLabel: 'Remove', cancelLabel: 'Keep' },
    );
    if (!ok) return;
    try {
      const res = await fetch(`/api/projects/${params.id}/tracks`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ track_id: trackId }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error('Remove failed', j.error);
        return;
      }
      fetchData();
      toast.success('Removed from project');
    } catch (err: unknown) {
      toast.error('Remove failed', errorMessage(err, 'Network error'));
    }
  };

  const handleDeleteTrack = async (trackId: string) => {
    const ok = await confirmToast(
      'Delete track from library?',
      'This permanently removes the track. This cannot be undone.',
      { confirmLabel: 'Delete', cancelLabel: 'Keep', danger: true },
    );
    if (!ok) return;
    try {
      const res = await fetch(`/api/tracks/${trackId}`, { method: 'DELETE' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error('Delete failed', j.error);
        return;
      }
      fetchData();
      toast.success('Track deleted');
    } catch (err: unknown) {
      toast.error('Delete failed', errorMessage(err, 'Network error'));
    }
  };

  const totalDuration = filtered.reduce((acc, t) => acc + (t.duration_seconds || 0), 0);

  // ── multi-select helpers ────────────────────────────────────────────
  const toggleSelectOne = (id: string) => {
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
        : new Set(filtered.map((t) => t.id)),
    );
  };
  const handleBulkRemove = async () => {
    const ok = await confirmToast(
      `Remove ${selectedIds.size} track${selectedIds.size === 1 ? '' : 's'} from project?`,
      'Tracks stay in your library — only the project links are removed.',
      { confirmLabel: 'Remove', cancelLabel: 'Keep' },
    );
    if (!ok) return;
    setBulkBusy(true);
    const ids = Array.from(selectedIds);
    const results = await Promise.allSettled(
      ids.map((tid) =>
        fetch(`/api/projects/${params.id}/tracks`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ track_id: tid }),
        }).then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
        }),
      ),
    );
    const failed = results.filter((r) => r.status === 'rejected').length;
    setBulkBusy(false);
    setSelectedIds(new Set());
    setSelectMode(false);
    await fetchData();
    if (failed === 0) {
      toast.success(`Removed ${ids.length} from project`);
    } else {
      toast.warning(`Removed ${ids.length - failed}, ${failed} failed`);
    }
  };
  const handleBulkPlay = () => {
    const sel = filtered.filter((t) => selectedIds.has(t.id));
    if (!sel.length) return;
    setQueue(sel);
    handlePlayTrack(sel[0]);
  };

  if (loading && !project) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-full">
          <Loader2 size={18} className="animate-spin text-white/40" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <PageContainer>
        {/* Side-by-side layout: cover LEFT (sticky on tall viewports),
            everything else RIGHT (header meta, upload zone, tabs, track
            list). Below the lg breakpoint we stack so phones / narrow
            laptop screens still read well. */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(280px,360px)_1fr] gap-5 sm:gap-8 lg:gap-10 mb-8 sm:mb-10">
          {/* Cover column — large square, click-to-replace. Renders here
              instead of inside the header so it can be the dominant
              visual anchor on the project page. */}
          <div className="lg:sticky lg:top-10 lg:self-start">
            <CoverEditor
              src={project?.cover_url}
              seed={project?.id ?? 'p'}
              kind="project"
              inputRef={fileInputRef}
              uploading={uploadingArt}
              removing={removingArt}
              onFile={handleArtChange}
              onRemove={handleArtRemove}
              removeLabel={project?.name}
              priority
              className="mx-auto max-w-[270px] rounded-[20px] sm:max-w-[360px] lg:max-w-none"
            >
              <span className="text-[88px] font-light sm:text-[112px] lg:text-[120px]">{project?.name?.[0] || 'P'}</span>
            </CoverEditor>
          </div>

          <div className="min-w-0">
            {/* Header — extracted to components/projects/ProjectDetailHeader.
                hideCover=true because the page renders its own bigger
                cover in the column to the left. */}
            <ProjectDetailHeader
              project={project}
              trackCount={filtered.length}
              totalDuration={totalDuration}
              onSetStatus={setStatus}
              onRename={handleRename}
              onSaveTargets={saveTargets}
              onSaveDescription={saveDescription}
              onPlay={handlePlayProject}
              onShare={() => setShowShareModal(true)}
              onAddFromLibrary={() => setShowAddFromLibrary(true)}
              onToggleUpload={() => setShowUpload(!showUpload)}
              /* The cover lives in the column to the left and shares this
                 file input, so "Edit cover" in the ⋯ menu opens the same
                 picker clicking the artwork does. */
              onEditCover={() => fileInputRef.current?.click()}
              playDisabled={!filtered.length}
              shareDisabled={!tracks.length}
              onChanged={fetchData}
              onDeleted={() => { window.location.href = '/projects'; }}
            />

        {/* Upload Zone */}
        {showUpload && (
          <div className="mb-8">
            <DropZone
              playlistId={params.id}
              onUploadSuccess={() => {
                fetchData();
                setShowUpload(false);
              }}
            />
          </div>
        )}

        {/* Topline recorder — quick voice-memo session for melody ideas
            over a project's reference beat. Reuses track_stem_files (mig 080)
            with a shared project-level topline track id (first track). */}
        {project && tracks.length > 0 && (
          <div className="mb-6">
            <ToplineRecorder trackId={tracks[0].id} />
          </div>
        )}

        {/* Tabs + search + track list — extracted to components/projects/ProjectTrackList. */}
        <ProjectTrackList
          tabs={['All', 'Beats', 'Instrumentals', 'Songs', 'Remixes']}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          filtered={filtered}
          onSelectTrack={(t) => setSelectedTrack(t)}
          onPlayTrack={(t) => handlePlayTrack(t)}
          onRemoveTrack={(id) => handleRemoveFromProject(id)}
          onDeleteTrack={(id) => handleDeleteTrack(id)}
          onAddFromLibrary={() => setShowAddFromLibrary(true)}
          onShowUpload={() => setShowUpload(true)}
          onTrackChanged={fetchData}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelectOne}
          onSelectAll={toggleSelectAll}
          selectMode={selectMode}
          onToggleSelectMode={() => {
            setSelectMode((v) => {
              if (v) setSelectedIds(new Set());
              return !v;
            });
          }}
          onReorder={async (orderedIds) => {
            // Optimistic reorder — reflect new order immediately.
            const idxMap = new Map(orderedIds.map((id, i) => [id, i]));
            setTracks((prev) => [...prev].sort((a, b) => (idxMap.get(a.id) ?? 999) - (idxMap.get(b.id) ?? 999)));
            try {
              await fetch(`/api/projects/${params.id}/tracks`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ positions: orderedIds.map((id, i) => ({ track_id: id, position: i })) }),
              });
            } catch {
              // Non-fatal; reorder is cosmetic — page reloads will restore DB order.
            }
          }}
        />
            {/* Analytics strip */}
            {project && <ProjectAnalyticsPanel projectId={params.id} />}

            {/* Production checklist (mig 084) — secondary, collapsed and
                underneath the active track work so it reads like admin,
                not the main project surface. */}
            {project && (
              <details className="mt-6 rounded-2xl border border-white/10 bg-white/[0.02] p-3">
                <summary className="cursor-pointer list-none text-[10px] font-mono uppercase tracking-[0.2em] text-white/60">
                  Checklist {project.checklist?.length ? `· ${project.checklist.filter((item) => item.done).length}/${project.checklist.length}` : ''}
                </summary>
                <div className="mt-3">
                  <ProjectChecklist
                    projectId={params.id}
                    items={project.checklist ?? []}
                    onChanged={(items) => setProject((p) => p ? { ...p, checklist: items } : p)}
                  />
                </div>
              </details>
            )}

            {/* Storefront — moved below creation controls so commerce does
                not compete with the primary project workspace on mobile. */}
            <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.04] p-4 sm:p-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/60">
                  Storefront
                </p>
                <button
                  type="button"
                  onClick={toggleStoreFeatured}
                  disabled={togglingStoreFeatured}
                  className={`rounded-full border px-3 py-1.5 text-[10px] font-medium transition-all disabled:opacity-40 ${
                    project?.store_featured
                      ? 'border-white/40 bg-white/15 text-white'
                      : 'border-white/10 text-white/60 hover:border-white/20 hover:text-white'
                  }`}
                >
                  {togglingStoreFeatured ? 'Saving...' : project?.store_featured ? 'In store' : 'List in store'}
                </button>
              </div>
              {/* Price only. The storefront description is the project
                  description, and it is now edited in the header rather than
                  in a second textarea five sections further down the page. */}
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-[180px]">
                  <label htmlFor="project-price" className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/60 block mb-1.5">
                    Price (USD)
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[12px] text-white/50">$</span>
                    <input
                      id="project-price"
                      type="number"
                      min="0"
                      step="0.01"
                      value={priceUsd}
                      onChange={(e) => setPriceUsd(e.target.value)}
                      onBlur={savePrice}
                      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                      placeholder="0.00"
                      className="w-full bg-white/[0.02] border border-white/10 rounded-lg pl-7 pr-3 py-2 text-[12px] text-white placeholder:text-white/40 focus:outline-none focus:border-white/40 transition-colors"
                    />
                  </div>
                  <p className="text-[9px] font-mono text-white/40 mt-1.5">
                    {savingStorefront ? 'Saving…' : 'Saves on blur. Blank hides it from the store.'}
                  </p>
                </div>
              </div>
            </div>

            {/* end right column (min-w-0) */}
          </div>
          {/* end side-by-side grid */}
        </div>
      </PageContainer>

      {/* Project-level feedback. Lives below the tracklist so owners scrolling
          the project see new comments without changing context. Pings every
          15s; that's good enough until we wire Supabase Realtime. */}
      {project && (
        <PageContainer className="pt-0 pb-12">
          <div className="rounded-2xl border border-white/20 bg-white/[0.02] p-3 sm:p-4">
            <ProjectCommentsPanel
              projectId={params.id as string}
              tracks={tracks.map((t) => ({ id: t.id, title: t.title }))}
              compact
            />
          </div>
        </PageContainer>
      )}

      {selectedTrack && (
        // projectId hooks the drawer's Track Feedback section to this project,
        // so commenter feedback pinned to this track appears in context.
        <TrackDetailsDrawer
          track={selectedTrack}
          projectId={params.id as string}
          onClose={() => setSelectedTrack(null)}
          onUpdate={fetchData}
        />
      )}

      {showAddFromLibrary && (
        <AddFromLibraryModal
          endpoint={`/api/projects/${params.id}/tracks`}
          excludeIds={tracks.map((t) => t.id)}
          onClose={() => setShowAddFromLibrary(false)}
          onAdded={() => fetchData()}
          title={`Add to ${project?.name || 'project'}`}
        />
      )}

      {showShareModal && project && (
        <ContentShareModal
          contentType="project"
          contentId={params.id as string}
          contentTitle={project.name}
          coverUrl={project.cover_url}
          onClose={() => setShowShareModal(false)}
        />
      )}

      {/* Floating bulk-action bar. Appears when ≥1 track is checked.
          Play queues the selection; Remove unlinks (track stays in
          library). Matches the playlist + contacts UX so the
          floating-action vocabulary is consistent across the app. */}
      <BatchActionBar
        count={selectedIds.size}
        noun={['track', 'tracks']}
        onClear={() => { setSelectedIds(new Set()); setSelectMode(false); }}
        busy={bulkBusy}
        actions={[
          {
            label: `Play ${selectedIds.size}`,
            icon: <ListPlus size={11} />,
            intent: 'primary',
            onClick: handleBulkPlay,
          },
          {
            label: 'Remove',
            icon: <DeleteIcon size={11} />,
            intent: 'danger',
            onClick: handleBulkRemove,
          },
        ]}
      />
    </DashboardLayout>
  );
}
