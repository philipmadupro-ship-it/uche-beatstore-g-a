'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import {
  Music, Loader2, Globe, Mail, AtSign, Link2,
  Heart, UserPlus, ArrowLeft, Tag, Gauge, Clock, Music2,
} from 'lucide-react';
import { PlayGlyph, PauseGlyph } from '@/components/player/TransportIcons';
import { usePlayer } from '@/hooks/usePlayer';
import { toast } from '@/hooks/useToast';
import { getBuyerToken } from '@/lib/buyer-session';
import type { Track } from '@/lib/types';

/* ─── Types ─────────────────────────────────────────────────── */

interface CreatorProfile {
  user_id: string;
  display_name?: string | null;
  bio?: string | null;
  hero_image_url?: string | null;
  credits?: string | null;
  license_notes?: string | null;
  instagram_handle?: string | null;
  twitter_handle?: string | null;
  spotify_url?: string | null;
  soundcloud_url?: string | null;
  website_url?: string | null;
  contact_email?: string | null;
  accent_color?: string | null;
  font_style?: string | null;
  text_color_primary?: string | null;
}

interface PlaylistItem {
  id: string;
  name: string;
  cover_url: string | null;
}

interface ProjectItem {
  id: string;
  name: string;
  cover_url: string | null;
  description?: string | null;
  price_usd?: number | null;
}

/* ─── Helpers ───────────────────────────────────────────────── */

function fmt(secs: number | null): string {
  if (!secs) return '—';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const TYPE_LABELS: Record<string, string> = {
  beat: 'Beat',
  instrumental: 'Instrumental',
  song: 'Song',
  remix: 'Remix',
};

/* ─── Follow store (localStorage, no auth required) ─────────── */

function getFollowedProducers(): Set<string> {
  try {
    const raw = localStorage.getItem('antigravity-followed-producers');
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function setFollowedProducers(ids: Set<string>) {
  localStorage.setItem('antigravity-followed-producers', JSON.stringify([...ids]));
}

/* ─── Page ──────────────────────────────────────────────────── */

export default function ProducerPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);

  const [creator, setCreator] = useState<CreatorProfile | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<PlaylistItem[]>([]);
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [isFollowing, setIsFollowing] = useState(false);

  const { currentTrack, isPlaying, setTrack, togglePlay, setQueue } = usePlayer();

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/store/producer/${encodeURIComponent(slug)}`);
        if (res.status === 404) { setNotFound(true); return; }
        const data = await res.json();
        if (data.error) { setNotFound(true); return; }
        setCreator(data.creator ?? null);
        setTracks(data.tracks ?? []);
        setPlaylists(data.playlists ?? []);
        setProjects(data.projects ?? []);
        // Check follow status
        if (data.creator?.user_id) {
          setIsFollowing(getFollowedProducers().has(data.creator.user_id));
        }
      } catch {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [slug]);

  const handleFollow = () => {
    if (!creator?.user_id) return;
    const followed = getFollowedProducers();
    const willFollow = !followed.has(creator.user_id);
    // Instant optimistic localStorage feedback (works anonymous too).
    if (willFollow) {
      followed.add(creator.user_id);
      setIsFollowing(true);
      toast.success('Following', `You'll be notified when ${creator.display_name || 'this producer'} drops new beats.`);
    } else {
      followed.delete(creator.user_id);
      setIsFollowing(false);
      toast.info('Unfollowed', `You unfollowed ${creator.display_name || 'this producer'}`);
    }
    setFollowedProducers(followed);

    // Best-effort DB persistence so the producer can see + notify followers.
    // If the buyer has no identity (no token), the API returns needsEmail
    // and we silently keep the localStorage follow — no friction.
    const token = getBuyerToken();
    fetch('/api/store/follow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        producer_user_id: creator.user_id,
        action: willFollow ? 'follow' : 'unfollow',
        token: token ?? undefined,
      }),
    }).catch(() => undefined);
  };

  const handlePlayTrack = (t: Track) => {
    if (currentTrack?.id === t.id) { togglePlay(); return; }
    setQueue(tracks);
    setTrack(t);
  };

  const accentColor = creator?.accent_color || '#D4BFA0';

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0907] flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-[#5a5142]" />
      </div>
    );
  }

  if (notFound || !creator) {
    return (
      <div className="min-h-screen bg-[#0a0907] flex flex-col items-center justify-center gap-4 text-[#5a5142]">
        <Music size={36} />
        <p className="text-[14px]">Producer not found.</p>
        <Link href="/store" className="text-[12px] underline hover:text-[#E8DCC8]">← Back to store</Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0907] text-[#E8DCC8]">
      {/* ── Hero ── */}
      <div className="relative">
        {/* Hero background image */}
        {creator.hero_image_url ? (
          <div className="h-[220px] md:h-[320px] w-full relative overflow-hidden">
            <img
              src={creator.hero_image_url}
              alt=""
              className="w-full h-full object-cover opacity-40"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#0a0907]/60 to-[#0a0907]" />
          </div>
        ) : (
          <div className="h-[140px] md:h-[200px] w-full bg-gradient-to-b from-[#14110d] to-[#0a0907]" />
        )}

        {/* Back link */}
        <div className="absolute top-4 left-4 md:left-8">
          <Link
            href="/store"
            className="inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-[#5a5142] hover:text-[#a08a6a] transition-colors"
          >
            <ArrowLeft size={11} />
            Store
          </Link>
        </div>

        {/* Producer header card */}
        <div className="max-w-6xl mx-auto px-4 md:px-10 -mt-12 md:-mt-20 relative z-10">
          <div className="flex flex-col md:flex-row md:items-end gap-4 md:gap-6">
            {/* Avatar placeholder */}
            <div className="w-20 h-20 md:w-28 md:h-28 rounded-2xl bg-[#14110d] border border-[#1f1a13] flex items-center justify-center shadow-lg shrink-0">
              <Music size={32} className="text-[#5a5142]" />
            </div>

            <div className="flex-1 min-w-0">
              <h1 className="text-2xl md:text-4xl font-bold text-white leading-tight">
                {creator.display_name || 'Producer'}
              </h1>
              {creator.credits && (
                <p className="text-[12px] text-[#6a5d4a] mt-1">{creator.credits}</p>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={handleFollow}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-[11px] font-bold uppercase tracking-wider transition-all border ${
                  isFollowing
                    ? 'bg-transparent border-[#5a5142] text-[#5a5142] hover:border-[#E8DCC8] hover:text-[#E8DCC8]'
                    : 'bg-[#D4BFA0] border-[#D4BFA0] text-black hover:bg-[#E8D8B8]'
                }`}
              >
                {isFollowing ? <Heart size={12} fill="currentColor" /> : <UserPlus size={12} />}
                {isFollowing ? 'Following' : 'Follow'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Main content ── */}
      <div className="max-w-6xl mx-auto px-4 md:px-10 py-8 md:py-12">
        <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-8 md:gap-14 items-start">

          {/* Left sidebar: Bio + social */}
          <div className="flex flex-col gap-5 md:sticky md:top-24">
            {creator.bio && (
              <div className="rounded-xl border border-[#1f1a13] bg-[#14110d] p-4">
                <p className="text-[9px] font-mono uppercase tracking-widest text-[#5a5142] mb-2">Bio</p>
                <p className="text-[12px] text-[#a08a6a] leading-relaxed">{creator.bio}</p>
              </div>
            )}

            {/* Social links */}
            <div className="rounded-xl border border-[#1f1a13] bg-[#14110d] p-4 space-y-2">
              <p className="text-[9px] font-mono uppercase tracking-widest text-[#5a5142] mb-2">Links</p>
              {creator.instagram_handle && (
                <a href={`https://instagram.com/${creator.instagram_handle.replace(/^@/, '')}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-[11px] text-[#6a5d4a] hover:text-[#E8DCC8] transition-colors">
                  <AtSign size={12} /> {creator.instagram_handle}
                </a>
              )}
              {creator.twitter_handle && (
                <a href={`https://twitter.com/${creator.twitter_handle.replace(/^@/, '')}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-[11px] text-[#6a5d4a] hover:text-[#E8DCC8] transition-colors">
                  <Link2 size={12} /> {creator.twitter_handle}
                </a>
              )}
              {creator.spotify_url && (
                <a href={creator.spotify_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-[11px] text-[#6a5d4a] hover:text-[#E8DCC8] transition-colors">
                  <Music size={12} /> Spotify
                </a>
              )}
              {creator.soundcloud_url && (
                <a href={creator.soundcloud_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-[11px] text-[#6a5d4a] hover:text-[#E8DCC8] transition-colors">
                  <Music2 size={12} /> SoundCloud
                </a>
              )}
              {creator.website_url && (
                <a href={creator.website_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-[11px] text-[#6a5d4a] hover:text-[#E8DCC8] transition-colors">
                  <Globe size={12} /> Website
                </a>
              )}
              {creator.contact_email && (
                <a href={`mailto:${creator.contact_email}`} className="flex items-center gap-2 text-[11px] text-[#6a5d4a] hover:text-[#E8DCC8] transition-colors">
                  <Mail size={12} /> {creator.contact_email}
                </a>
              )}
            </div>

            {/* Stats */}
            <div className="rounded-xl border border-[#1f1a13] bg-[#14110d] p-4 grid grid-cols-2 gap-3">
              <div>
                <p className="text-[18px] font-bold text-white">{tracks.length}</p>
                <p className="text-[9px] font-mono uppercase tracking-wider text-[#5a5142]">Tracks</p>
              </div>
              <div>
                <p className="text-[18px] font-bold text-white">{playlists.length + projects.length}</p>
                <p className="text-[9px] font-mono uppercase tracking-wider text-[#5a5142]">Collections</p>
              </div>
            </div>
          </div>

          {/* Right: Track grid + collections */}
          <div className="flex flex-col gap-8">
            {/* Tracks */}
            {tracks.length > 0 && (
              <section>
                <p className="text-[10px] font-mono uppercase tracking-[0.25em] text-[#5a5142] mb-4">
                  All Tracks
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {tracks.map((t) => (
                    <TrackCard
                      key={t.id}
                      track={t}
                      accentColor={accentColor}
                      isCurrent={currentTrack?.id === t.id}
                      isPlaying={isPlaying && currentTrack?.id === t.id}
                      onPlay={() => handlePlayTrack(t)}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Featured playlists */}
            {playlists.length > 0 && (
              <section>
                <p className="text-[10px] font-mono uppercase tracking-[0.25em] text-[#5a5142] mb-4">
                  Playlists
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {playlists.map((pl) => (
                    <Link
                      key={pl.id}
                      href={`/store/playlists/${pl.id}`}
                      className="group flex flex-col rounded-xl border border-[#1f1a13] bg-[#14110d] overflow-hidden hover:border-[#2d2620] transition-all"
                    >
                      <div className="relative w-full aspect-square bg-[#0a0907]">
                        {pl.cover_url ? (
                          <img src={pl.cover_url} alt={pl.name} className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.04]" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-[#3a3328]">
                            <Music size={20} />
                          </div>
                        )}
                      </div>
                      <div className="p-2.5">
                        <p className="text-[11px] font-medium text-[#E8DCC8] truncate">{pl.name}</p>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {/* Featured projects */}
            {projects.length > 0 && (
              <section>
                <p className="text-[10px] font-mono uppercase tracking-[0.25em] text-[#5a5142] mb-4">
                  Projects
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {projects.map((proj) => (
                    <Link
                      key={proj.id}
                      href={`/store/projects/${proj.id}`}
                      className="group flex flex-col rounded-xl border border-[#1f1a13] bg-[#14110d] overflow-hidden hover:border-[#2d2620] transition-all"
                    >
                      <div className="relative w-full aspect-square bg-[#0a0907]">
                        {proj.cover_url ? (
                          <img src={proj.cover_url} alt={proj.name} className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.04]" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-[#3a3328]">
                            <Music size={20} />
                          </div>
                        )}
                      </div>
                      <div className="p-2.5">
                        <p className="text-[11px] font-medium text-[#E8DCC8] truncate">{proj.name}</p>
                        {proj.price_usd != null && Number(proj.price_usd) > 0 && (
                          <p className="text-[9px] font-mono text-[#5a5142] mt-0.5">${Number(proj.price_usd)} bundle</p>
                        )}
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {tracks.length === 0 && playlists.length === 0 && projects.length === 0 && (
              <div className="text-center py-16 text-[#5a5142] text-[12px]">
                No public releases yet.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Track Card ───────────────────────────────────────────── */

function TrackCard({
  track,
  accentColor,
  isCurrent,
  isPlaying,
  onPlay,
}: {
  track: Track;
  accentColor: string;
  isCurrent: boolean;
  isPlaying: boolean;
  onPlay: () => void;
}) {
  return (
    <Link
      href={`/store/${track.id}`}
      className="group flex flex-col rounded-xl border border-[#1f1a13] bg-[#14110d] overflow-hidden hover:border-[#2d2620] transition-all"
    >
      <div className="relative w-full aspect-square bg-[#0a0907]">
        {track.cover_url ? (
          <img
            src={track.cover_url}
            alt={track.title}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[#3a3328]">
            <Music size={20} />
          </div>
        )}
        {/* Play overlay */}
        <button
          onClick={(e) => { e.preventDefault(); onPlay(); }}
          className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <div className="w-12 h-12 rounded-full bg-white text-black flex items-center justify-center shadow-lg">
            {isCurrent && isPlaying ? (
              <PauseGlyph size={18} />
            ) : (
              <PlayGlyph size={18} className="ml-0.5" />
            )}
          </div>
        </button>
        {isCurrent && (
          <div className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-black/70 backdrop-blur text-[8px] font-mono uppercase tracking-wider text-white flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[#6DC6A4] animate-pulse" />
            {isPlaying ? 'Playing' : 'Paused'}
          </div>
        )}
      </div>
      <div className="p-2.5">
        <p className="text-[11px] font-medium text-[#E8DCC8] truncate">{track.title}</p>
        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
          <span className="text-[9px] font-mono text-[#5a5142] uppercase tracking-wider">
            {TYPE_LABELS[track.type] ?? track.type}
          </span>
          {track.bpm && (
            <span className="text-[9px] font-mono text-[#5a5142]">· {track.bpm} BPM</span>
          )}
        </div>
      </div>
    </Link>
  );
}
