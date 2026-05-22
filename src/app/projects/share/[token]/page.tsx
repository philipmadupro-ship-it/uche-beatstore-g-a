'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import React from 'react';
import { createPortal } from 'react-dom';
import {
  Play, Pause, SkipBack, SkipForward, Download, Volume2, VolumeX,
  Music, Lock, Loader2, Shield, MessageSquare, Send, Eye, Edit3,
  ChevronUp, ChevronDown, Check, X as XIcon, Pencil,
} from 'lucide-react';
import { audioSrc } from '@/lib/audio/url';
import { useWaveSurfer } from '@/hooks/useWaveSurfer';
import { PlayerCanvas } from '@/components/player/PlayerCanvas';
import { toast } from '@/hooks/useToast';
import { ClientShareVariant } from '@/components/share/variants/ClientShareVariant';
import type { LicenseTier } from '@/components/store/LicenseSelector';
import { ArrangementOverlay } from '@/components/tracks/ArrangementOverlay';
import { ProducerShareVariant } from '@/components/share/variants/ProducerShareVariant';
import { RapperShareVariant } from '@/components/share/variants/RapperShareVariant';
import { FriendShareVariant } from '@/components/share/variants/FriendShareVariant';

interface ShareInfo {
  token: string;
  role: 'viewer' | 'commenter' | 'editor';
  allow_downloads: boolean;
  expires_at: string | null;
  label: string | null;
  // Audience tag — drives which variant the share page renders.
  // Defaults to 'client' for any pre-existing share that hasn't been
  // re-saved since the migration landed.
  recipient_kind: 'client' | 'producer' | 'rapper' | 'friend';
  // True when the producer flipped "For sale" on this share —
  // surfaces Buy Lease / Buy Exclusive on the client variant.
  sales_enabled?: boolean;
}

// Owner's creator profile — bio / hero / license / social fields shown
// in the client variant. Optional; the API returns null when the user
// hasn't filled out the settings form yet.
interface CreatorProfile {
  display_name: string | null;
  bio: string | null;
  hero_image_url: string | null;
  credits: string | null;
  license_lease_price_usd: number | null;
  license_exclusive_price_usd: number | null;
  license_notes: string | null;
  instagram_handle: string | null;
  twitter_handle: string | null;
  spotify_url: string | null;
  soundcloud_url: string | null;
  website_url: string | null;
  contact_email: string | null;
}

interface ShareTrack {
  id: string;
  title: string;
  type: string;
  audio_url: string;
  peaks_url: string | null;
  cover_url: string | null;
  duration_seconds: number | null;
  bpm: number | null;
  key: string | null;
  scale: string | null;
}

interface ShareProject {
  id: string;
  name: string;
  cover_url: string | null;
  description: string | null;
  bpm_target: number | null;
  key_target: string | null;
  status: string;
}

interface SharePlaylist {
  id: string;
  name: string;
  cover_url: string | null;
}

interface ShareTrackMeta {
  id: string;
  title: string;
  cover_url: string | null;
}

interface Comment {
  id: string;
  track_id: string | null;
  author_name: string;
  body: string;
  parent_id: string | null;
  // When both are set, the comment is anchored to a region of the audio
  // (drag-selection on the waveform). Rendered as a timecode pill that
  // seeks the player to `region_start` on click. Both-or-neither is a
  // DB-level invariant via a CHECK constraint.
  region_start: number | null;
  region_end: number | null;
  created_at: string;
}

/**
 * Public listener page for project shares.
 *
 * Differences from /share/[token]:
 *   - hydrates from /api/projects/share/[token] (project + ordered tracks + role)
 *   - shows a comments panel; the form's visibility is gated on role
 *   - download button is gated on `allow_downloads` (shows "Downloads disabled" otherwise)
 *   - downloads route through /api/audio?download=1 so Content-Disposition forces save
 */
export default function ProjectSharePage({ params: paramsPromise }: { params: Promise<{ token: string }> }) {
  const params = React.use(paramsPromise);
  const token = params.token;

  // ── purchase state ──────────────────────────────────────────────────
  // On return from Stripe checkout the URL carries
  // ?purchase=success&session_id=cs_xxx. We snapshot the session_id into
  // localStorage keyed by share token so it survives reloads, then strip
  // the params from the URL. Downloads pass session_id back to
  // /api/share/[token]/download to unlock paid tracks.
  const [purchaseSessionId, setPurchaseSessionId] = useState<string | null>(null);
  const [purchaseBanner, setPurchaseBanner] = useState<'success' | 'cancelled' | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const purchase = url.searchParams.get('purchase');
    const sid = url.searchParams.get('session_id');
    if (purchase === 'success' && sid) {
      try { localStorage.setItem(`u2c-purchase-${token}`, sid); } catch {}
      setPurchaseSessionId(sid);
      setPurchaseBanner('success');
    } else if (purchase === 'cancelled') {
      setPurchaseBanner('cancelled');
    } else {
      try {
        const stored = localStorage.getItem(`u2c-purchase-${token}`);
        if (stored) setPurchaseSessionId(stored);
      } catch {}
    }
    if (purchase) {
      url.searchParams.delete('purchase');
      url.searchParams.delete('session_id');
      window.history.replaceState({}, '', url.toString());
    }
  }, [token]);

  // ── share data ──────────────────────────────────────────────────────
  const [project, setProject] = useState<ShareProject | null>(null);
  const [playlist, setPlaylist] = useState<SharePlaylist | null>(null);
  const [shareTrackMeta, setShareTrackMeta] = useState<ShareTrackMeta | null>(null);
  const [share, setShare] = useState<ShareInfo | null>(null);
  const [tracks, setTracks] = useState<ShareTrack[]>([]);
  // Owner's creator profile (bio / hero / license / social). Powers
  // the client variant; null in two cases: profile not filled out yet
  // OR recipient_kind isn't 'client' so we don't need it.
  const [creator, setCreator] = useState<CreatorProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requiresPassword, setRequiresPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [stems, setStems] = useState<any[]>([]);
  const [licenses, setLicenses] = useState<LicenseTier[]>([]);

  // We keep the unlocked password in memory so subsequent fetches
  // (comments etc.) don't re-prompt.
  const passwordRef = useRef<string | null>(null);

  // ── player ──────────────────────────────────────────────────────────
  // currentTime / duration / ready come from useWaveSurfer below.
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [muted, setMuted] = useState(false);

  const waveRef = useRef<HTMLDivElement>(null);

  const activeTrack = tracks[activeIndex] ?? null;

  // ── editor mode flag — declared HERE (before useWaveSurfer) so the
  //    DAW conditional can starve the inline hook of a URL when active.
  //    Only meaningful when share?.role === 'editor'.
  const [editing, setEditing] = useState(false);

  // DAW chrome activates when an editor switches into edit mode. In that
  // case PlayerCanvas owns the WaveSurfer instance — we starve the inline
  // hook of a url so it doesn't create a second player competing for the
  // same audio.
  const useDawCanvas = editing && share?.role === 'editor';

  // Single source of truth for the inline player's WaveSurfer lifecycle.
  // Lives in hooks/useWaveSurfer — handles dynamic import, peaks sidecar,
  // cancel on track switch, and exposes imperative play/pause/seek.
  const {
    ready,
    currentTime,
    duration,
    play: wsPlay,
    pause: wsPause,
    setVolume: wsSetVolume,
    seek,
  } = useWaveSurfer({
    container: waveRef,
    url: (activeTrack && !useDawCanvas) ? audioSrc(activeTrack.audio_url) : null,
    peaksUrl: activeTrack?.peaks_url ?? null,
    height: 56,
    initialVolume: 0.8,
    onFinish: () => {
      // Auto-advance to next track when the current one ends.
      setActiveIndex((i) => (i < tracks.length - 1 ? (setIsPlaying(true), i + 1) : (setIsPlaying(false), i)));
    },
  });

  // ── comments ────────────────────────────────────────────────────────
  const [comments, setComments] = useState<Comment[]>([]);
  const [authorName, setAuthorName] = useState('');
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);

  // Region anchoring: the latest region drawn on the waveform becomes
  // the "pinned to" context for the next comment. We snapshot it in
  // local state because PlayerCanvas owns the live regions array;
  // when the user submits we forward the pinned range with the body
  // and clear it on success.
  const [pinnedRegion, setPinnedRegion] = useState<{ start: number; end: number } | null>(null);

  // Imperative seek bus for PlayerCanvas. Bumping the nonce triggers a
  // jump-and-play. Used by the comment timecode pills below.
  const [seekRequest, setSeekRequest] = useState<{ time: number; nonce: number } | null>(null);

  // ── editor mode (state lives below the useWaveSurfer call now lives in
  //    its own section higher up so DAW chrome can swap in at render time.
  const [descDraft, setDescDraft] = useState('');
  const [savingDesc, setSavingDesc] = useState(false);
  const [reordering, setReordering] = useState<string | null>(null); // track id being moved

  // ── data fetch ──────────────────────────────────────────────────────
  const fetchShare = useCallback(async (pw?: string) => {
    setLoading(true);
    setPasswordError('');
    try {
      const res = await fetch(`/api/projects/share/${token}`, {
        headers: pw ? { 'x-share-password': pw } : {},
      });
      const data = await res.json();
      if (res.status === 401) {
        setRequiresPassword(true);
        if (pw) setPasswordError(data.error || 'Incorrect password');
        setLoading(false);
        return;
      }
      if (res.status === 410) {
        setError(data.error || 'This link is no longer active.');
        setLoading(false);
        return;
      }
      if (!res.ok) {
        setError(data.error || 'Link not found.');
        setLoading(false);
        return;
      }
      setProject(data.project ?? null);
      setPlaylist(data.playlist ?? null);
      setShareTrackMeta(data.track ?? null);
      setShare(data.share);
      setTracks(data.tracks ?? []);
      setStems(data.stems ?? []);
      // Creator profile is optional — the API only returns it when the
      // owner has filled out their settings form. Client variant
      // degrades section-by-section when fields are missing.
      setCreator(data.creator ?? null);
      setLicenses((data.licenses as LicenseTier[]) ?? []);
      setRequiresPassword(false);
      if (pw) passwordRef.current = pw;
    } catch {
      setError('Error loading shared project.');
    }
    setLoading(false);
  }, [token]);

  useEffect(() => {
    fetchShare();
  }, [fetchShare]);

  // Log real-time listener playhead coordinates (heatmap)
  useEffect(() => {
    if (!isPlaying || !activeTrack?.id) return;
    
    const sendPing = async () => {
      try {
        await fetch(`/api/tracks/${activeTrack.id}/heatmap`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            position_seconds: currentTime,
            share_token: token,
          }),
        });
      } catch (err) {
        console.warn('Failed to send playhead coordinate ping:', err);
      }
    };

    // Ping every 3 seconds of active play
    const interval = setInterval(sendPing, 3000);
    return () => clearInterval(interval);
  }, [isPlaying, activeTrack?.id, currentTime, token]);

  // Keep the description draft in sync with the latest server value when
  // editing mode is OFF; once they start typing we don't clobber.
  useEffect(() => {
    if (!editing) setDescDraft(project?.description ?? '');
  }, [project?.description, editing]);

  const fetchComments = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/share/${token}/comments`, {
        headers: passwordRef.current ? { 'x-share-password': passwordRef.current } : {},
      });
      const data = await res.json();
      if (res.ok) setComments(data.comments ?? []);
    } catch {
      // Soft-fail — empty comments is the right fallback for guests.
    }
  }, [token]);

  useEffect(() => {
    if (!share) return;
    fetchComments();
  }, [share, fetchComments]);

  // ── unlock ──────────────────────────────────────────────────────────
  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setUnlocking(true);
    await fetchShare(password);
    setUnlocking(false);
  };

  // Sync external play/pause state to the hook. We don't bake this into
  // the hook itself because not every consumer drives playback from React
  // state — some use uncontrolled buttons that call wsPlay() directly.
  useEffect(() => {
    if (!ready) return;
    if (isPlaying) wsPlay();
    else wsPause();
  }, [isPlaying, ready, wsPlay, wsPause]);

  // Volume + mute sync.
  useEffect(() => {
    if (!ready) return;
    wsSetVolume(muted ? 0 : volume);
  }, [volume, muted, ready, wsSetVolume]);

  // ── controls ────────────────────────────────────────────────────────
  const togglePlay = () => setIsPlaying((p) => !p);
  const prevTrack = () => activeIndex > 0 && (setActiveIndex(activeIndex - 1), setIsPlaying(true));
  const nextTrack = () => activeIndex < tracks.length - 1 && (setActiveIndex(activeIndex + 1), setIsPlaying(true));
  const selectTrack = (i: number) => {
    if (i === activeIndex) togglePlay();
    else { setActiveIndex(i); setIsPlaying(true); }
  };

  const downloadTrack = (t: ShareTrack) => {
    // Route through /api/share/[token]/download — the endpoint decides
    // whether to grant based on share.allow_downloads OR a matching
    // license_purchases row keyed by purchaseSessionId. We always pass
    // session_id when we have one; the server ignores it for free shares.
    const url = new URL(`/api/share/${token}/download`, window.location.origin);
    url.searchParams.set('track_id', t.id);
    if (purchaseSessionId) url.searchParams.set('session_id', purchaseSessionId);
    const ext = (t.audio_url.match(/\.(mp3|wav|flac|aiff|aif|m4a|ogg)(?:\?|$)/i)?.[1] || 'mp3').toLowerCase();
    const filename = `${t.title || 'track'}.${ext}`;
    const a = document.createElement('a');
    a.href = url.toString();
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // ── editor actions ──────────────────────────────────────────────────
  const saveDescription = async () => {
    if (!project) return;
    setSavingDesc(true);
    try {
      const res = await fetch(`/api/projects/share/${token}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(passwordRef.current ? { 'x-share-password': passwordRef.current } : {}),
        },
        body: JSON.stringify({ description: descDraft }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error('Couldn’t save description', data.error || `HTTP ${res.status}`);
        return;
      }
      setProject(data.project);
      toast.success('Description saved');
    } finally {
      setSavingDesc(false);
    }
  };

  // Move a track by `delta` positions (+1 down, -1 up). We compute the new
  // order locally for instant feedback, then POST the full list so the
  // server is authoritative — if the patch fails we revert via refetch.
  const moveTrack = async (trackId: string, delta: number) => {
    const idx = tracks.findIndex((t) => t.id === trackId);
    const next = idx + delta;
    if (idx < 0 || next < 0 || next >= tracks.length) return;
    const newOrder = [...tracks];
    [newOrder[idx], newOrder[next]] = [newOrder[next], newOrder[idx]];
    setTracks(newOrder);
    // If the active track moved, keep its index in sync so the player
    // doesn't jump to a different track.
    setActiveIndex(newOrder.findIndex((t) => t.id === activeTrack?.id));
    setReordering(trackId);
    try {
      const res = await fetch(`/api/projects/share/${token}/tracks`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(passwordRef.current ? { 'x-share-password': passwordRef.current } : {}),
        },
        body: JSON.stringify({ track_ids: newOrder.map((t) => t.id) }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        toast.error('Reorder failed', e.error || `HTTP ${res.status}`);
        // Authoritative revert.
        fetchShare(passwordRef.current ?? undefined);
      }
    } finally {
      setReordering(null);
    }
  };

  const submitComment = async () => {
    if (!authorName.trim() || !draft.trim()) return;
    setPosting(true);
    try {
      const res = await fetch(`/api/projects/share/${token}/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(passwordRef.current ? { 'x-share-password': passwordRef.current } : {}),
        },
        body: JSON.stringify({
          author_name: authorName.trim(),
          body: draft.trim(),
          track_id: activeTrack?.id ?? null,
          // Region anchor — both or neither (server validates same).
          region_start: pinnedRegion?.start ?? null,
          region_end: pinnedRegion?.end ?? null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error('Couldn’t post comment', data.error);
        return;
      }
      setDraft('');
      // Clear the pin so the next comment doesn't accidentally attach
      // to the same region — the user can drag a fresh selection if
      // they want to keep commenting on the same range.
      setPinnedRegion(null);
      fetchComments();
    } finally {
      setPosting(false);
    }
  };

  const handleAddCommentFromCanvas = async (body: string, start: number | null, end: number | null) => {
    if (!authorName.trim()) {
      toast.error('Name required', 'Please set your display name in the comments sidebar before leaving a comment.');
      return;
    }
    if (!body.trim()) return;
    setPosting(true);
    try {
      const res = await fetch(`/api/projects/share/${token}/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(passwordRef.current ? { 'x-share-password': passwordRef.current } : {}),
        },
        body: JSON.stringify({
          author_name: authorName.trim(),
          body: body.trim(),
          track_id: activeTrack?.id ?? null,
          region_start: start,
          region_end: end,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error('Couldn’t post comment', data.error);
        return;
      }
      fetchComments();
      toast.success('Comment pinned to waveform!');
    } finally {
      setPosting(false);
    }
  };

  const fmt = (s: number) => {
    if (!isFinite(s) || s < 0) return '0:00';
    return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
  };
  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;

  // ── states ──────────────────────────────────────────────────────────
  if (loading) return (
    <div className="min-h-screen bg-[#0a0907] flex items-center justify-center">
      <Loader2 size={20} className="animate-spin text-[#4a4338]" />
    </div>
  );

  if (requiresPassword) return (
    <div className="min-h-screen bg-[#0a0907] flex items-center justify-center p-6">
      <form onSubmit={handleUnlock} className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-[#14110d] border border-[#1a160f] flex items-center justify-center">
            <Lock size={16} className="text-[#5a5142]" />
          </div>
          <h1 className="text-[18px] font-medium text-white mb-1">Password required</h1>
          <p className="text-[12px] text-[#5a5142]">This shared project is protected</p>
        </div>
        <input
          type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter password"
          className="w-full bg-[#14110d] border border-[#1a160f] rounded-lg px-4 py-3 text-[13px] text-white placeholder:text-[#4a4338] focus:outline-none focus:border-[#2d2620] mb-3"
          autoFocus
        />
        {passwordError && <p className="text-[11px] text-red-400 mb-3">{passwordError}</p>}
        <button
          type="submit" disabled={unlocking || !password}
          className="w-full bg-white text-black py-3 rounded-lg text-[12px] font-medium hover:bg-[#E8DCC8] disabled:opacity-40 transition-colors flex items-center justify-center gap-2"
        >
          {unlocking ? <Loader2 size={13} className="animate-spin" /> : null}
          Unlock
        </button>
      </form>
    </div>
  );

  if (error) return (
    <div className="min-h-screen bg-[#0a0907] flex items-center justify-center p-6">
      <div className="text-center max-w-sm">
        <Shield size={28} className="text-red-400 mx-auto mb-4" />
        <h1 className="text-[18px] font-medium text-white mb-2">Link unavailable</h1>
        <p className="text-[12px] text-[#5a5142]">{error}</p>
      </div>
    </div>
  );

  const canComment = share?.role === 'commenter' || share?.role === 'editor';

  // Portal the post-Stripe banner to <body> so it stays visible across
  // every variant (Client / Producer / Rapper / Friend / default) without
  // having to thread it through each variant's JSX. Dismiss on click.
  const purchaseBannerNode = purchaseBanner && typeof document !== 'undefined'
    ? createPortal(
        <div
          className={`fixed top-4 left-1/2 -translate-x-1/2 z-[200] max-w-[90vw] sm:max-w-md px-5 py-3 rounded-full border backdrop-blur-xl shadow-[0_12px_40px_rgba(0,0,0,0.5)] flex items-center gap-3 animate-in slide-in-from-top-4 fade-in duration-300 ${
            purchaseBanner === 'success'
              ? 'bg-[#0e1f17]/95 border-[#6DC6A4]/30 text-[#9fe5c1]'
              : 'bg-[#1f1410]/95 border-[#8A7A5C]/30 text-[#E8D8B8]'
          }`}
        >
          {purchaseBanner === 'success' ? (
            <>
              <Check size={14} className="text-[#6DC6A4] shrink-0" />
              <span className="text-[12px] font-medium">
                Purchase complete — receipt + access sent to your email.
              </span>
            </>
          ) : (
            <>
              <XIcon size={14} className="text-[#a08a6a] shrink-0" />
              <span className="text-[12px] font-medium">Checkout cancelled.</span>
            </>
          )}
          <button
            onClick={() => setPurchaseBanner(null)}
            className="ml-2 text-current opacity-60 hover:opacity-100 transition-opacity"
            aria-label="Dismiss"
          >
            <XIcon size={12} />
          </button>
        </div>,
        document.body,
      )
    : null;

  // Normalise playlist/track shares into a project-shaped object so the
  // four variant components receive consistent props regardless of content type.
  const displayProject: ShareProject | null = project
    ?? (playlist ? { id: playlist.id, name: playlist.name, cover_url: playlist.cover_url, description: null, bpm_target: null, key_target: null, status: 'active' } : null)
    ?? (shareTrackMeta ? { id: shareTrackMeta.id, name: shareTrackMeta.title, cover_url: shareTrackMeta.cover_url, description: null, bpm_target: null, key_target: null, status: 'active' } : null);

  // Client-variant short-circuit. When the share was created with
  // `recipient_kind === 'client'`, the whole page is replaced with the
  // editorial "intro to my universe" layout: hero photo, bio, curated
  // tracks, license card, social links. Producer / rapper / friend
  // variants continue through to the historical layout below (still
  // the default for now; we'll specialise each variant in follow-ups).
  if (share?.recipient_kind === 'client' && displayProject) {
    return (
      <>
        {purchaseBannerNode}
        <div ref={waveRef} className="hidden" />
        <ClientShareVariant
          project={displayProject}
          tracks={tracks}
          creator={creator}
          licenses={licenses}
          shareToken={share.sales_enabled ? token : undefined}
          playingId={activeTrack?.id ?? null}
          isPlaying={isPlaying}
          onPlay={(t) => {
            const idx = tracks.findIndex((x) => x.id === t.id);
            if (idx >= 0) {
              if (idx === activeIndex) {
                setIsPlaying((p) => !p);
              } else {
                setActiveIndex(idx);
                setIsPlaying(true);
              }
            }
          }}
          currentTime={currentTime}
          duration={duration}
          progressPct={progressPct}
          waveRef={waveRef}
          onSeek={(seconds) => seek(seconds)}
        />
      </>
    );
  }

  if (share?.recipient_kind === 'producer' && displayProject) {
    return (
      <>
      {purchaseBannerNode}
      <ProducerShareVariant
        project={displayProject}
        tracks={tracks}
        creator={creator}
        playingId={activeTrack?.id ?? null}
        isPlaying={isPlaying}
        onPlay={(t) => {
          const idx = tracks.findIndex((x) => x.id === t.id);
          if (idx >= 0) {
            if (idx === activeIndex) {
              setIsPlaying((p) => !p);
            } else {
              setActiveIndex(idx);
              setIsPlaying(true);
            }
          }
        }}
      />
      </>
    );
  }

  if (share?.recipient_kind === 'rapper' && displayProject) {
    return (
      <>
      {purchaseBannerNode}
      <RapperShareVariant
        project={displayProject}
        tracks={tracks}
        creator={creator}
        playingId={activeTrack?.id ?? null}
        isPlaying={isPlaying}
        onPlay={(t) => {
          const idx = tracks.findIndex((x) => x.id === t.id);
          if (idx >= 0) {
            if (idx === activeIndex) {
              setIsPlaying((p) => !p);
            } else {
              setActiveIndex(idx);
              setIsPlaying(true);
            }
          }
        }}
      />
      </>
    );
  }

  if (share?.recipient_kind === 'friend' && displayProject) {
    return (
      <>
      {purchaseBannerNode}
      <FriendShareVariant
        project={displayProject}
        tracks={tracks}
        creator={creator}
        playingId={activeTrack?.id ?? null}
        isPlaying={isPlaying}
        onPlay={(t) => {
          const idx = tracks.findIndex((x) => x.id === t.id);
          if (idx >= 0) {
            if (idx === activeIndex) {
              setIsPlaying((p) => !p);
            } else {
              setActiveIndex(idx);
              setIsPlaying(true);
            }
          }
        }}
      />
      </>
    );
  }

  return (
    <>
    {purchaseBannerNode}
    <div className="min-h-screen bg-[#0a0907] text-[#E8DCC8] flex flex-col">
      {/* Header */}
      <header className="px-8 py-5 border-b border-[#16130e] flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-[5px] bg-white flex items-center justify-center">
            <span className="text-[9px] font-black text-black">AG</span>
          </div>
          <span className="text-[11px] font-medium tracking-[0.2em] uppercase text-[#a08a6a]">U2C Beatstore</span>
        </div>
        <div className="flex items-center gap-2">
          {share && <RoleBadge role={share.role} />}
        </div>
      </header>

      <main className="flex-1 max-w-5xl mx-auto px-8 py-10 w-full space-y-8">
        {/* Project header */}
        {project && (
          <div className="flex items-end gap-5">
            <div className="w-24 h-24 bg-[#16130e] rounded-xl overflow-hidden border border-[#1a160f] shrink-0">
              {project.cover_url
                ? <img loading="lazy" src={project.cover_url} alt="" className="w-full h-full object-cover" />
                : <div className="w-full h-full flex items-center justify-center text-[#3a3328] text-3xl font-black">{project.name.charAt(0)}</div>
              }
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[10px] font-bold text-[#D4BFA0] uppercase tracking-[0.2em] mb-1">Project</p>
                {share?.role === 'editor' && (
                  <button
                    onClick={() => setEditing((e) => !e)}
                    className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-md border transition-colors ${
                      editing
                        ? 'bg-[#2A2418] border-[#8A7A5C] text-[#E8D8B8]'
                        : 'border-[#1a160f] text-[#a08a6a] hover:text-white hover:border-[#2d2620]'
                    }`}
                  >
                    <Pencil size={10} />
                    {editing ? 'Editing' : 'Edit'}
                  </button>
                )}
              </div>
              <h1 className="text-[28px] font-medium text-white tracking-tight truncate">{project.name}</h1>

              {editing && share?.role === 'editor' ? (
                <div className="mt-3 space-y-2 max-w-prose">
                  <textarea
                    value={descDraft}
                    onChange={(e) => setDescDraft(e.target.value)}
                    placeholder="Project description (what is this, where is it going, what feedback are you after…)"
                    rows={3}
                    className="w-full bg-[#0a0907] border border-[#1a160f] rounded-md px-3 py-2 text-[12px] text-[#E8DCC8] placeholder:text-[#4a4338] focus:outline-none focus:border-[#8A7A5C] resize-none"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={saveDescription}
                      disabled={savingDesc || descDraft === (project.description ?? '')}
                      className="flex items-center gap-1.5 bg-[#D4BFA0] hover:bg-[#8A7A5C] disabled:opacity-40 text-white text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded transition-colors"
                    >
                      {savingDesc ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />}
                      Save
                    </button>
                    <button
                      onClick={() => { setDescDraft(project.description ?? ''); }}
                      disabled={descDraft === (project.description ?? '')}
                      className="flex items-center gap-1.5 text-[10px] text-[#a08a6a] hover:text-white px-3 py-1.5 rounded transition-colors disabled:opacity-40"
                    >
                      <XIcon size={10} />
                      Reset
                    </button>
                  </div>
                </div>
              ) : (
                project.description && (
                  <p className="text-[12px] text-[#a08a6a] mt-2 max-w-prose whitespace-pre-wrap">{project.description}</p>
                )
              )}
            </div>
          </div>
        )}

        {/* Player */}
        {activeTrack && (
          <div className="bg-[#0e0c08] border border-[#1a160f] rounded-xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-[#16130e] rounded border border-[#1a160f] overflow-hidden shrink-0">
                {activeTrack.cover_url
                  ? <img loading="lazy" src={activeTrack.cover_url} alt="" className="w-full h-full object-cover" />
                  : <div className="w-full h-full flex items-center justify-center text-[#3a3328]"><Music size={14} /></div>
                }
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-medium text-white truncate">{activeTrack.title}</p>
                <p className="text-[10px] font-mono text-[#5a5142] uppercase tracking-wider mt-0.5">
                  {activeTrack.type}{activeTrack.bpm ? ` · ${activeTrack.bpm} BPM` : ''}{activeTrack.key ? ` · ${activeTrack.key}${activeTrack.scale ? ' ' + activeTrack.scale : ''}` : ''}
                </p>
              </div>
              {useDawCanvas && (
                <span className="text-[9px] font-bold text-[#E8D8B8] bg-[#2A2418] border border-[#8A7A5C]/40 rounded-full px-2.5 py-1 uppercase tracking-wider">
                  DAW mode
                </span>
              )}
            </div>

            {/* Arrangement strip — shown above the player whether DAW
                or inline mode. Driven by the producer's arrangement
                state for this track; renders nothing when no
                arrangement exists yet. Click a section to seek. */}
            <ArrangementOverlay
              trackId={activeTrack.id}
              durationSeconds={activeTrack.duration_seconds || 0}
              currentTime={currentTime}
              onSeek={(s) => setSeekRequest({ time: s, nonce: Date.now() })}
            />

            {useDawCanvas ? (
              // Editor mode → full DAW chrome with zoom, regions, and
              // keyboard shortcuts. PlayerCanvas owns its own WaveSurfer
              // instance; the inline ws above is paused (url=null) so
              // there's no audio collision.
              <PlayerCanvas
                key={activeTrack.id}
                url={audioSrc(activeTrack.audio_url)}
                peaksUrl={activeTrack.peaks_url ?? null}
                height={96}
                enableRegions
                loopRegions
                initialZoom={60}
                onFinish={() => {
                  if (activeIndex < tracks.length - 1) {
                    setActiveIndex(activeIndex + 1);
                  }
                }}
                onRegionsChange={(regions) => {
                  // The most recent region wins — it's the one the
                  // user just dragged. We pin it to the next comment
                  // they submit; clearing all regions on the canvas
                  // unpins.
                  const last = regions[regions.length - 1];
                  setPinnedRegion(last ? { start: last.start, end: last.end } : null);
                }}
                seekRequest={seekRequest}
                comments={comments.filter((c) => c.track_id === activeTrack.id)}
                onAddComment={handleAddCommentFromCanvas}
                canComment={canComment}
              />
            ) : (
              <div ref={waveRef} className="w-full" style={{ minHeight: 56 }} />
            )}

            <div className="flex items-center gap-3 mt-4">
              {/* Track-level transport stays visible in DAW mode too —
                  PlayerCanvas only owns intra-track play/pause; switching
                  tracks is still the share-page's responsibility. */}
              <button onClick={prevTrack} className="text-[#5a5142] hover:text-white transition-colors disabled:opacity-30" disabled={activeIndex === 0}>
                <SkipBack size={14} fill="currentColor" />
              </button>
              {!useDawCanvas && (
                <button onClick={togglePlay} className="w-10 h-10 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 transition-transform">
                  {isPlaying ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" className="ml-0.5" />}
                </button>
              )}
              <button onClick={nextTrack} className="text-[#5a5142] hover:text-white transition-colors disabled:opacity-30" disabled={activeIndex === tracks.length - 1}>
                <SkipForward size={14} fill="currentColor" />
              </button>

              {/* Inline timecode + progress + volume only when the inline
                  player is rendering. DAW mode shows them inside PlayerCanvas. */}
              {!useDawCanvas && (
                <>
                  <span className="text-[10px] font-mono text-[#5a5142] tabular-nums">{fmt(currentTime)}</span>
                  <div className="flex-1 h-1 bg-[#1a160f] rounded-full">
                    <div className="h-full bg-[#D4BFA0] rounded-full transition-all" style={{ width: `${progressPct}%` }} />
                  </div>
                  <span className="text-[10px] font-mono text-[#5a5142] tabular-nums">{fmt(duration)}</span>

                  <div className="flex items-center gap-2 pl-3 border-l border-[#1a160f]">
                    <button onClick={() => setMuted((m) => !m)} className="text-[#5a5142] hover:text-white">
                      {muted || volume === 0 ? <VolumeX size={14} /> : <Volume2 size={14} />}
                    </button>
                    <input
                      type="range" min="0" max="1" step="0.01" value={muted ? 0 : volume}
                      onChange={(e) => { setMuted(false); setVolume(parseFloat(e.target.value)); }}
                      className="w-20 cursor-pointer"
                    />
                  </div>
                </>
              )}

              {/* In DAW mode the download stays right-aligned via ml-auto. */}
              {useDawCanvas && <div className="flex-1" />}

              {share?.allow_downloads ? (
                <button
                  onClick={() => downloadTrack(activeTrack)}
                  className="flex items-center gap-1.5 text-[11px] font-medium text-[#a08a6a] hover:text-white border border-[#1a160f] hover:border-[#2d2620] px-3 py-2 rounded-md transition-colors"
                >
                  <Download size={12} />
                  Download
                </button>
              ) : (
                <div
                  title="The sender disabled downloads on this link."
                  className="flex items-center gap-1.5 text-[11px] font-medium text-[#4a4338] border border-[#161616] px-3 py-2 rounded-md cursor-not-allowed"
                >
                  <Lock size={11} />
                  Downloads off
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tracklist */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] font-mono uppercase tracking-wider text-[#5a5142]">
              {tracks.length} track{tracks.length !== 1 ? 's' : ''}
            </p>
            {editing && share?.role === 'editor' && (
              <p className="text-[10px] font-mono uppercase tracking-wider text-[#D4BFA0]">
                Reorder mode — use the arrows
              </p>
            )}
          </div>
          <div className="border border-[#1a160f] rounded-lg divide-y divide-[#161310]">
            {tracks.map((t, i) => {
              const active = i === activeIndex;
              const canEdit = editing && share?.role === 'editor';
              const isMoving = reordering === t.id;
              return (
                <div
                  key={t.id}
                  onClick={() => { if (!canEdit) selectTrack(i); }}
                  className={`group flex items-center gap-3 px-4 h-14 transition-colors ${
                    canEdit ? 'cursor-default' : 'cursor-pointer'
                  } ${active ? 'bg-[#0e0c08]' : 'hover:bg-[#0c0a08]'} ${isMoving ? 'opacity-60' : ''}`}
                >
                  <span className={`text-[11px] font-mono w-5 text-center ${active ? 'text-[#D4BFA0]' : 'text-[#3a3328]'}`}>{i + 1}</span>

                  {/* Reorder arrows — visible only in editor mode. Stop propagation
                      so clicking them doesn't also fire the row's selectTrack. */}
                  {canEdit && (
                    <div className="flex flex-col -gap-px shrink-0">
                      <button
                        onClick={(e) => { e.stopPropagation(); moveTrack(t.id, -1); }}
                        disabled={i === 0 || !!reordering}
                        className="p-0.5 text-[#6a5d4a] hover:text-white disabled:opacity-20 disabled:cursor-not-allowed"
                        title="Move up"
                      >
                        <ChevronUp size={12} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); moveTrack(t.id, 1); }}
                        disabled={i === tracks.length - 1 || !!reordering}
                        className="p-0.5 text-[#6a5d4a] hover:text-white disabled:opacity-20 disabled:cursor-not-allowed"
                        title="Move down"
                      >
                        <ChevronDown size={12} />
                      </button>
                    </div>
                  )}

                  <div className="w-7 h-7 bg-[#16130e] rounded border border-[#1a160f] overflow-hidden shrink-0">
                    {t.cover_url
                      ? <img loading="lazy" src={t.cover_url} alt="" className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center text-[#2d2620]"><Music size={11} /></div>
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-[12px] font-medium truncate ${active ? 'text-[#E8D8B8]' : 'text-[#E8DCC8]'}`}>{t.title}</p>
                    <p className="text-[9px] font-mono text-[#5a5142] mt-0.5">{t.type}{t.bpm ? ` · ${t.bpm}` : ''}</p>
                  </div>
                  {t.duration_seconds && (
                    <span className="text-[10px] font-mono text-[#5a5142] tabular-nums">{fmt(t.duration_seconds)}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Comments */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <MessageSquare size={13} className="text-[#6a5d4a]" />
            <p className="text-[10px] font-bold text-[#a08a6a] uppercase tracking-[0.2em]">
              Comments {comments.length > 0 && <span className="text-[#5a5142]">({comments.length})</span>}
            </p>
          </div>

          {comments.length === 0 ? (
            <p className="text-[11px] text-[#5a5142] mb-4">
              {canComment ? 'No comments yet — be the first.' : 'No comments yet.'}
            </p>
          ) : (
            <div className="space-y-3 mb-6">
              {comments.map((c) => {
                // Region-pinned comments get a click-to-seek pill. Only
                // works when the comment is on the currently active
                // track (clicking a pill for a different track would
                // need a track switch first; out of scope for now).
                const isRegionPinned = c.region_start != null && c.region_end != null;
                const canSeek = isRegionPinned && c.track_id === activeTrack?.id;
                return (
                  <div key={c.id} className="bg-[#0e0c08] border border-[#1a160f] rounded-md px-4 py-3">
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <span className="text-[11px] font-medium text-[#E8DCC8]">{c.author_name}</span>
                      <span className="text-[9px] font-mono text-[#5a5142]">
                        {new Date(c.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      </span>
                      {c.track_id && (
                        <span className="text-[9px] font-mono text-[#6a5d4a] bg-[#1a160f] rounded px-1.5 py-0.5">
                          on {tracks.find((t) => t.id === c.track_id)?.title || 'track'}
                        </span>
                      )}
                      {isRegionPinned && (
                        <button
                          type="button"
                          disabled={!canSeek}
                          onClick={() => {
                            if (!canSeek) return;
                            setSeekRequest({
                              time: c.region_start!,
                              // Bumping the nonce lets the user replay
                              // the same region multiple times.
                              nonce: Date.now(),
                            });
                          }}
                          className={`text-[9px] font-mono rounded px-1.5 py-0.5 inline-flex items-center gap-1 ${
                            canSeek
                              ? 'bg-[#2A2418] border border-[#8A7A5C]/40 text-[#E8D8B8] hover:bg-[#231f4a] hover:border-[#8A7A5C] cursor-pointer'
                              : 'bg-[#1a160f] border border-[#1a160f] text-[#6a5d4a] cursor-not-allowed'
                          } transition-colors`}
                          title={canSeek ? 'Jump to this region' : 'Switch to the pinned track to play this region'}
                        >
                          <Play size={8} fill="currentColor" />
                          {fmt(c.region_start!)} – {fmt(c.region_end!)}
                        </button>
                      )}
                    </div>
                    <p className="text-[12px] text-[#bbb] leading-relaxed whitespace-pre-wrap">{c.body}</p>
                  </div>
                );
              })}
            </div>
          )}

          {canComment ? (
            <div className="bg-[#0e0c08] border border-[#1a160f] rounded-md p-4 space-y-2">
              <input
                value={authorName}
                onChange={(e) => setAuthorName(e.target.value)}
                placeholder="Your name"
                className="w-full bg-[#0a0907] border border-[#1a160f] rounded px-3 py-2 text-[11px] text-white placeholder:text-[#4a4338] focus:outline-none focus:border-[#8A7A5C]"
              />
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={`Leave feedback${activeTrack ? ` on ${activeTrack.title}` : ''}…`}
                rows={3}
                className="w-full bg-[#0a0907] border border-[#1a160f] rounded px-3 py-2 text-[12px] text-white placeholder:text-[#4a4338] focus:outline-none focus:border-[#8A7A5C] resize-none"
              />
              {pinnedRegion && (
                // Drag-to-create on the waveform sets a region pin for
                // the next comment. Visible chip so the user knows their
                // next comment will be timestamp-anchored; click to clear.
                <button
                  type="button"
                  onClick={() => setPinnedRegion(null)}
                  className="flex items-center gap-2 w-full bg-[#2A2418] border border-[#8A7A5C]/40 rounded px-3 py-1.5 text-[10px] font-mono text-[#E8D8B8] hover:bg-[#231f4a] transition-colors"
                  title="Click to unpin this region"
                >
                  <Play size={9} fill="currentColor" />
                  <span>Pinned to {fmt(pinnedRegion.start)} – {fmt(pinnedRegion.end)}</span>
                  <span className="text-[#6a5d4a] ml-auto">click to clear</span>
                </button>
              )}
              <div className="flex items-center justify-between">
                <p className="text-[9px] text-[#5a5142]">
                  {activeTrack ? `Will be pinned to ${activeTrack.title}` : 'Project-level comment'}
                  {pinnedRegion && ` · region ${fmt(pinnedRegion.start)}–${fmt(pinnedRegion.end)}`}
                </p>
                <button
                  onClick={submitComment}
                  disabled={posting || !authorName.trim() || !draft.trim()}
                  className="flex items-center gap-1.5 bg-[#D4BFA0] hover:bg-[#8A7A5C] disabled:opacity-40 text-white text-[10px] font-bold uppercase tracking-widest px-4 py-2 rounded transition-colors"
                >
                  {posting ? <Loader2 size={11} className="animate-spin" /> : <Send size={10} />}
                  Post
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-[#0a0907] border border-[#161616] rounded-md px-4 py-3 flex items-center gap-2 text-[#5a5142]">
              <Eye size={11} />
              <span className="text-[11px]">This link is view-only — the sender didn't enable comments.</span>
            </div>
          )}
        </section>
      </main>
    </div>
    </>
  );
}

function RoleBadge({ role }: { role: ShareInfo['role'] }) {
  const map = {
    viewer:    { icon: Eye,           label: 'View only' },
    commenter: { icon: MessageSquare, label: 'Commenter' },
    editor:    { icon: Edit3,         label: 'Editor' },
  } as const;
  const { icon: Icon, label } = map[role];
  return (
    <span className="flex items-center gap-1.5 text-[10px] font-bold text-[#E8D8B8] bg-[#2A2418] border border-[#8A7A5C]/40 rounded-full px-3 py-1.5 uppercase tracking-wider">
      <Icon size={10} />
      {label}
    </span>
  );
}
