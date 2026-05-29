'use client';

/**
 * /library/[id] = TRACK DETAIL (Vault item).
 * A single track + its version history, stems, and metadata.
 * NOT a project (projects live under /projects/[id]).
 */

import React, { useEffect, useRef, useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Loader2, Camera, Check, X, Edit2, Play, Music, Download, Share2, Activity, Sliders } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Track, TrackStatus, TrackType } from '@/lib/types';
import { usePlayer } from '@/hooks/usePlayer';
import { fmtBpm, fmtKey, fmtDuration } from '@/lib/audio/format';
import { StarRating } from '@/components/tracks/StarRating';
import { TagPicker } from '@/components/tracks/TagPicker';
import { ContentShareModal } from '@/components/share/ContentShareModal';
import { audioSrc } from '@/lib/audio/url';
import { OfflineToggle } from '@/components/offline/OfflineToggle';
import { LyricsStudio } from '@/components/lyrics/LyricsStudio';
import { toast } from '@/hooks/useToast';
import { LibraryMetadataGrid } from '@/components/library/LibraryMetadataGrid';
import { LibraryVersionHistory, type TrackVersion } from '@/components/library/LibraryVersionHistory';
import { StemUploader } from '@/components/tracks/StemUploader';
import { SimilarTracks } from '@/components/tracks/SimilarTracks';
import { TrackHeatmap } from '@/components/tracks/TrackHeatmap';
import { ArrangementOverlay } from '@/components/tracks/ArrangementOverlay';
import { TrackListingEditor } from '@/components/tracks/TrackListingEditor';
// `analyzeAudio` is dynamically imported inside `handleReanalyze` so the
// audio-decode worker chain doesn't break client/SSR bundling.

const STATUS_OPTIONS: { value: TrackStatus; label: string; color: string }[] = [
  { value: 'maq',         label: 'MAQ',        color: 'bg-[#1a1033] text-[#b39ddb] border-[#534AB7]/40' },
  { value: 'needs_work',  label: 'WIP',        color: 'bg-[#1f1a0a] text-[#c8a84b] border-[#3a2f1f]' },
  { value: 'finished',    label: 'Finished',   color: 'bg-[#0a1f0a] text-[#8ecf9f] border-[#1f3a1f]' },
  { value: 'archived',    label: 'Archived',   color: 'bg-[#16130e] text-[#6a5d4a] border-[#1f1a13]' },
];

const TYPE_OPTIONS: { value: TrackType; label: string }[] = [
  { value: 'beat',         label: 'Beat' },
  { value: 'instrumental', label: 'Instrumental' },
  { value: 'song',         label: 'Song' },
  { value: 'remix',        label: 'Remix' },
];

// TrackVersion is re-exported from components/library/LibraryVersionHistory
// — single source of truth, prevents the shape from drifting between
// page state and the renderer.


export default function TrackDetailPage({ params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = React.use(paramsPromise);
  const [track, setTrack] = useState<Track | null>(null);
  const [versions, setVersions] = useState<TrackVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadingArt, setUploadingArt] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [tempTitle, setTempTitle] = useState('');
  const [shareOpen, setShareOpen] = useState(false);
  const [savingMeta, setSavingMeta] = useState(false);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  // Distinguish "track exists but failed to load" from "Track not found"
  // so the error fallback page can show the real reason + a retry.
  const [fetchError, setFetchError] = useState<string | null>(null);
  // Stems URLs for the manual-upload UI. Fetched alongside the track
  // so the StemUploader shows already-loaded stems as "Loaded" instead
  // of empty dropzones on every reload. Null means "fetch hasn't
  // completed yet" so we can withhold rendering until we know.
  const [stems, setStems] = useState<{
    vocals_url: string | null;
    drums_url: string | null;
    bass_url: string | null;
    other_url: string | null;
  } | null>(null);

  const { setTrack: setGlobalTrack } = usePlayer();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchData = async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const [tRes, vRes, sRes] = await Promise.all([
        fetch(`/api/tracks/${params.id}`),
        fetch(`/api/tracks/${params.id}/versions`),
        fetch(`/api/stems?track_id=${params.id}`),
      ]);
      const tData = await tRes.json();
      if (!tRes.ok) throw new Error(tData?.error || `HTTP ${tRes.status}`);
      const vData = await vRes.json();
      if (tData?.id) {
        setTrack(tData);
        setTempTitle(tData.title || '');
      }
      setVersions(vData.versions || []);
      // Stems endpoint returns { stem: <row> | null }. Map the row's URL
      // columns into the shape StemUploader's `initial` prop expects.
      const stemRow = (await sRes.json().catch(() => null))?.stem ?? null;
      setStems({
        vocals_url: stemRow?.vocals_url ?? null,
        drums_url:  stemRow?.drums_url  ?? null,
        bass_url:   stemRow?.bass_url   ?? null,
        other_url:  stemRow?.other_url  ?? null,
      });
    } catch (err) {
      console.error('Fetch error:', err);
      setFetchError(err instanceof Error ? err.message : 'Failed to load track');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [params.id]);

  const handleArtChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingArt(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/upload/image', { method: 'POST', body: formData });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) {
        toast.error('Cover upload failed', data.error || `HTTP ${res.status}`);
        return;
      }
      const patch = await fetch(`/api/tracks/${params.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cover_url: data.url }),
      });
      if (!patch.ok) {
        const e = await patch.json().catch(() => ({}));
        toast.error('Could not save cover', e.error || `HTTP ${patch.status}`);
        return;
      }
      fetchData();
    } finally {
      setUploadingArt(false);
    }
  };

  const handleRename = async () => {
    if (!tempTitle.trim() || tempTitle === track?.title) {
      setIsEditingTitle(false);
      return;
    }
    // Check response before treating the rename as successful. Previously
    // a 400/401 still updated local state, so the user saw a "successful"
    // rename that vanished on next refresh.
    try {
      const res = await fetch(`/api/tracks/${params.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: tempTitle.trim() }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error('Rename failed', j?.error || `HTTP ${res.status}`);
        return;
      }
      setTrack(track ? { ...track, title: tempTitle.trim() } : track);
      setIsEditingTitle(false);
    } catch (err) {
      toast.error('Rename failed', err instanceof Error ? err.message : 'Network error');
    }
  };

  const handleReanalyze = async () => {
    if (!track?.audio_url || reanalyzing) return;
    setReanalyzing(true);
    setAnalysisError(null);
    try {
      // Try client-side Essentia first (more accurate, gets key+scale)
      let features: any = null;
      try {
        const res = await fetch(audioSrc(track.audio_url));
        if (!res.ok) throw new Error(`audio ${res.status}`);
        const blob = await res.blob();
        const file = new File([blob], 'analyze.wav', { type: blob.type || 'audio/wav' });
        const { analyzeAudio } = await import('@/lib/audio/analyze.client');
        features = await analyzeAudio(file);
      } catch (err) {
        console.warn('Client analysis failed, falling back to server:', err);
      }

      const body = features ? { features } : {};
      const r = await fetch(`/api/tracks/${params.id}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Analysis failed');
      if (data.track) setTrack(data.track);

      // Always surface a confirmation toast, regardless of whether the
      // response carried back a full track row (supabase path) or just
      // the raw update result (local-store path). Previously the local
      // path looked silent — user clicked Re-analyze, nothing visibly
      // changed.
      const patched = (data.track ?? data) as Partial<Track>;
      const bits = [
        patched.bpm != null ? `${patched.bpm} BPM` : null,
        patched.key ? `${patched.key}${patched.scale ? ' ' + patched.scale : ''}` : null,
      ].filter(Boolean);
      if (bits.length > 0) {
        const src = data?.source === 'client' ? 'via Essentia' : 'via server';
        toast.success('Track re-analyzed', `${bits.join(' · ')} (${src})`);
      } else {
        toast.warning(
          'Re-analyze finished',
          'Audio analyzed but BPM and key extractors couldn’t lock a confident signal.',
        );
      }
    } catch (err: any) {
      setAnalysisError(err.message || 'Analysis failed');
      toast.error('Re-analyze failed', err?.message || 'Unknown error');
    } finally {
      setReanalyzing(false);
    }
  };

  const patchTrack = async (patch: Partial<Track>) => {
    if (!track) return;
    setSavingMeta(true);
    // Optimistic
    setTrack({ ...track, ...patch });
    try {
      await fetch(`/api/tracks/${params.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
    } catch (err) {
      console.error('Patch failed:', err);
    } finally {
      setSavingMeta(false);
    }
  };

  if (loading && !track) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-full">
          <Loader2 size={18} className="animate-spin text-[#4a4338]" />
        </div>
      </DashboardLayout>
    );
  }

  if (!track) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center h-full gap-3">
          <p className="text-[#5a5142] text-sm">
            {fetchError ? 'Couldn’t load this track' : 'Track not found'}
          </p>
          {fetchError && (
            <>
              <p className="text-[10px] text-[#4a4338] font-mono max-w-md text-center">{fetchError}</p>
              <button
                onClick={fetchData}
                className="text-[11px] text-[#D4BFA0] hover:text-[#E8D8B8] font-medium"
              >
                Try again
              </button>
            </>
          )}
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="max-w-[1400px] mx-auto px-10 pt-10">
        {/* Side-by-side layout: big square cover LEFT (sticky on tall
            viewports), all meta + actions + metadata + history + tags +
            lyrics + notes stacked RIGHT. Same shape as the project
            detail page so library and project pages share one mental
            model. Stacks vertically below the lg breakpoint. */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(280px,360px)_1fr] gap-10">
          {/* Cover column. Click anywhere on the square to swap the
              cover image — same affordance as the project detail page. */}
          <div className="lg:sticky lg:top-10 lg:self-start">
            <div
              className="aspect-square w-full bg-[#14110d] rounded-2xl border border-white/[0.05] overflow-hidden group relative cursor-pointer shadow-[0_8px_32px_rgba(0,0,0,0.4)]"
              onClick={() => fileInputRef.current?.click()}
            >
              {track.cover_url ? (
                <img loading="lazy" src={track.cover_url} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-[#1a160f] bg-gradient-to-br from-[#161520] to-[#0a0907]">
                  <Music size={64} strokeWidth={1.2} />
                </div>
              )}
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-sm">
                {uploadingArt ? <Loader2 size={20} className="animate-spin text-white" /> : <Camera size={20} className="text-white" />}
              </div>
              <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleArtChange} />
            </div>
          </div>

          {/* Right column — meta + all sub-panels. */}
          <div className="min-w-0">
            <div className="flex flex-col gap-4 pb-8 mb-8 border-b border-white/[0.04]">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <select
                  value={track.type}
                  onChange={(e) => patchTrack({ type: e.target.value as TrackType })}
                  className="bg-transparent text-[10px] font-mono uppercase tracking-[0.2em] text-[#E8D8B8] border border-[#1f1a13] rounded px-2 py-1 hover:border-[#2d2620] focus:outline-none focus:border-[#D4BFA0] cursor-pointer"
                >
                  {TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value} className="bg-[#0a0907]">{opt.label}</option>
                  ))}
                </select>
                {STATUS_OPTIONS.map((opt) => {
                  const active = (track.status || 'needs_work') === opt.value;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => patchTrack({ status: opt.value })}
                      className={`px-2 py-1 rounded text-[9px] font-mono uppercase tracking-[0.2em] border transition-colors ${
                        active ? opt.color : 'bg-transparent text-[#4a4338] border-[#1f1a13] hover:border-[#2d2620] hover:text-[#6a5d4a]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
                {savingMeta && <Loader2 size={11} className="animate-spin text-[#4a4338]" />}
              </div>
              {isEditingTitle ? (
                <div className="flex items-center gap-2 mb-3">
                  <input
                    autoFocus
                    className="bg-transparent border-b border-[#2d2620] text-3xl font-medium tracking-tight outline-none text-white flex-1 focus:border-[#D4BFA0]"
                    value={tempTitle}
                    onChange={(e) => setTempTitle(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleRename()}
                  />
                  <button onClick={handleRename} className="p-1.5 rounded hover:bg-[#16130e] text-[#D4BFA0]"><Check size={14} /></button>
                  <button onClick={() => { setIsEditingTitle(false); setTempTitle(track?.title || ''); }} className="p-1.5 rounded hover:bg-[#16130e] text-[#5a5142]"><X size={14} /></button>
                </div>
              ) : (
                <div className="group flex items-center gap-2 mb-3">
                  <h1 className="text-3xl font-medium text-white leading-none tracking-tight truncate font-heading">{track.title}</h1>
                  <button onClick={() => setIsEditingTitle(true)} className="opacity-0 group-hover:opacity-100 p-1.5 text-[#5a5142] hover:text-white transition-all">
                    <Edit2 size={13} />
                  </button>
                </div>
              )}
              <div className="flex items-center gap-3 text-[11px] font-mono text-[#5a5142] uppercase tracking-wider">
                <span>{fmtDuration(track.duration_seconds)}</span>
                <span>·</span>
                <span>{fmtBpm(track.bpm)}</span>
                <span>·</span>
                <span>{fmtKey(track.key, track.scale)}</span>
                <span>·</span>
                <StarRating
                  trackId={track.id}
                  initialRating={track.rating || 0}
                  onChange={(newRating) => {
                    // Reflect the saved rating in our local copy so a
                    // drawer-close/reopen doesn't snap back to the old
                    // value. The API has already persisted by the time
                    // this fires, so we don't need to refetch.
                    setTrack((t) => (t ? { ...t, rating: newRating } : t));
                  }}
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setGlobalTrack(track)}
                className="flex items-center gap-2 bg-white text-black px-4 py-2 rounded-md text-[12px] font-medium hover:bg-[#E8DCC8] transition-colors"
              >
                <Play size={12} fill="currentColor" className="ml-0.5" />
                Play
              </button>
              <button
                onClick={() => setShareOpen(true)}
                className="flex items-center gap-2 bg-[#14110d] border border-[#1a160f] text-[#E8DCC8] px-4 py-2 rounded-md text-[12px] font-medium hover:border-[#2d2620] transition-colors"
              >
                <Share2 size={12} />
                Share
              </button>
              <button
                onClick={() => router.push(`/studio?track=${track.id}`)}
                title="Open this track in the studio (loop / pitch / stems / record)"
                className="flex items-center gap-2 bg-[#14110d] border border-[#1a160f] text-[#E8D8B8] px-4 py-2 rounded-md text-[12px] font-medium hover:border-[#8A7A5C]/40 hover:bg-[#2A2418] transition-colors"
              >
                <Sliders size={12} />
                Studio
              </button>
              <button
                onClick={handleReanalyze}
                disabled={reanalyzing}
                title="Re-extract BPM, key and loudness"
                className="flex items-center gap-2 bg-[#14110d] border border-[#1a160f] text-[#E8DCC8] px-4 py-2 rounded-md text-[12px] font-medium hover:border-[#2d2620] disabled:opacity-50 transition-colors"
              >
                {reanalyzing ? <Loader2 size={12} className="animate-spin" /> : <Activity size={12} />}
                {reanalyzing ? 'Analyzing…' : 'Re-analyze'}
              </button>
              {track.audio_url && (
                <a
                  href={audioSrc(track.audio_url)}
                  download={`${track.title || 'track'}.wav`}
                  className="flex items-center gap-2 bg-[#14110d] border border-[#1a160f] text-[#E8DCC8] px-4 py-2 rounded-md text-[12px] font-medium hover:border-[#2d2620] transition-colors"
                >
                  <Download size={12} />
                  Download
                </a>
              )}
              {track.audio_url && (
                <OfflineToggle trackId={track.id} audioUrl={track.audio_url} title={track.title} />
              )}
            </div>
            {analysisError && (
              <p className="text-[10px] font-mono text-red-400 mt-2">{analysisError}</p>
            )}
            </div>
            {/* end meta panel (title / status / actions row group) */}

            {/* Metadata — extracted to components/library/LibraryMetadataGrid. */}
            <LibraryMetadataGrid track={track} />

            {/* Arrangement strip — read-only map of song sections
                (Intro / Verse / Chorus / …). Owner sets them up in
                /studio's arrangement editor; here we render the
                lightweight overview. Hidden when no arrangement
                exists yet. */}
            <ArrangementOverlay
              trackId={track.id}
              durationSeconds={track.duration_seconds || 0}
            />

            {/* Audience Waveform retention analytics */}
            <div className="mb-10">
              <TrackHeatmap trackId={track.id} durationSeconds={track.duration_seconds || 0} />
            </div>

            {/* "Find Matches" — surface BPM/key/vibe-adjacent tracks from
                the producer's own library. Drives the playlist-building
                + send workflow. Lives near the metadata so the producer
                sees the suggestion right next to "this beat is 140 bpm
                in C minor — what else do I have like this?" */}
            <SimilarTracks trackId={track.id} />

            {/* Per-track listing: description + lease/exclusive price
                overrides. Empty fields inherit the producer's
                profile-level defaults from /settings. Shown on the
                Client variant share page. */}
            <TrackListingEditor track={track} onSaved={fetchData} />

            {/* Stems — manual upload UI. Producer / engineer flow:
                attach your already-exported stems (vocals / drums /
                bass / other) so a producer-variant share can expose
                per-stem downloads. Each slot is independent so a
                single-stem re-upload doesn't reset the others. */}
            <div className="mb-10">
              <StemUploader
                trackId={track.id}
                initial={stems ? {
                  vocals: stems.vocals_url,
                  drums:  stems.drums_url,
                  bass:   stems.bass_url,
                  other:  stems.other_url,
                } : undefined}
                onChange={fetchData}
              />
            </div>

        {/* Version history — extracted to components/library/LibraryVersionHistory. */}
        <LibraryVersionHistory track={track} versions={versions} />

        {/* Tags */}
        <div className="mb-10">
          <p className="text-[10px] font-mono uppercase tracking-wider text-[#5a5142] mb-3">Tags &amp; genre</p>
          <TagPicker
            trackId={track.id}
            features={{
              bpm: track.bpm,
              key: track.key,
              scale: track.scale,
              energy: track.energy,
              danceability: track.danceability,
              valence: track.valence,
              acousticness: track.acousticness,
              loudness: track.loudness,
            }}
          />
        </div>

        {/* Lyrics studio */}
        <div id="lyrics" className="mb-10 scroll-mt-10">
          <LyricsStudio trackId={track.id} />
        </div>

        {/* Notes */}
        <div className="mb-16">
          <p className="text-[10px] font-mono uppercase tracking-wider text-[#5a5142] mb-2">Notes</p>
          <textarea
            defaultValue={track.notes || ''}
            onBlur={(e) => {
              const v = e.target.value;
              if (v !== (track.notes || '')) patchTrack({ notes: v || null });
            }}
            placeholder="Session notes, references, mix decisions…"
            className="w-full min-h-[96px] bg-[#0e0c08] border border-[#1a160f] rounded-lg px-4 py-3 text-[13px] text-[#E8DCC8] placeholder:text-[#4a4338] focus:outline-none focus:border-[#2d2620] resize-y"
          />
        </div>
          </div>
          {/* end right column */}
        </div>
        {/* end side-by-side grid */}
      </div>

      {shareOpen && (
        <ContentShareModal
          contentType="track"
          contentId={track.id}
          contentTitle={track.title}
          coverUrl={track.cover_url}
          onClose={() => setShareOpen(false)}
        />
      )}
    </DashboardLayout>
  );
}
