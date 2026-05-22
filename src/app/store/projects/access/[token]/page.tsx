'use client';

/**
 * /store/projects/access/[token]
 *
 * Post-purchase delivery page for project bundles. Reached from the email
 * Stripe webhook sends after a successful project checkout. The token is
 * resolved server-side via project_access_links; visitors with a valid
 * token see the project cover, name, and a downloadable track list.
 */

import { useEffect, useState, use } from 'react';
import {
  Loader2, Layers, Play, Pause, Music, Download, ShieldCheck, Mail,
} from 'lucide-react';
import { usePlayer } from '@/hooks/usePlayer';
import type { Track } from '@/lib/types';

interface AccessTrack {
  id: string;
  title: string;
  type: string;
  audio_url: string | null;
  wav_url: string | null;
  peaks_url: string | null;
  cover_url: string | null;
  duration_seconds: number | null;
  bpm: number | null;
  key: string | null;
  scale: string | null;
}

interface AccessProject {
  id: string;
  name: string;
  cover_url: string | null;
  description: string | null;
  price_usd: number | null;
}

interface AccessCreator {
  display_name?: string | null;
  contact_email?: string | null;
  instagram_handle?: string | null;
  twitter_handle?: string | null;
  website_url?: string | null;
}

interface AccessInfo {
  buyer_email: string;
  granted_at: string;
}

function fmt(secs: number | null): string {
  if (!secs) return '—';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function ProjectAccessPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);

  const [project, setProject] = useState<AccessProject | null>(null);
  const [tracks, setTracks] = useState<AccessTrack[]>([]);
  const [creator, setCreator] = useState<AccessCreator | null>(null);
  const [access, setAccess] = useState<AccessInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [invalid, setInvalid] = useState(false);

  const { currentTrack, isPlaying, setTrack: playTrack, togglePlay, setQueue } = usePlayer();

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/store/projects/access/${token}`);
        if (res.status === 404) { setInvalid(true); return; }
        const data = await res.json();
        if (data.error) { setInvalid(true); return; }
        setProject(data.project);
        setTracks(data.tracks ?? []);
        setCreator(data.creator ?? null);
        setAccess(data.access ?? null);
      } catch {
        setInvalid(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0907] flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-[#5a5142]" />
      </div>
    );
  }

  if (invalid || !project) {
    return (
      <div className="min-h-screen bg-[#0a0907] flex flex-col items-center justify-center gap-4 text-[#5a5142] px-6">
        <Layers size={36} />
        <p className="text-[14px] text-center">This access link is invalid or has expired.</p>
        {creator?.contact_email && (
          <a
            href={`mailto:${creator.contact_email}`}
            className="text-[11px] underline hover:text-[#E8DCC8]"
          >
            Contact the producer
          </a>
        )}
      </div>
    );
  }

  const totalDuration = tracks.reduce((acc, t) => acc + (t.duration_seconds ?? 0), 0);

  return (
    <div className="min-h-screen bg-[#0a0907] text-[#E8DCC8]">
      <div className="max-w-5xl mx-auto px-4 md:px-10 pt-10 pb-12">
        {/* Receipt banner */}
        <div className="flex items-start gap-3 rounded-2xl border border-[#6DC6A4]/20 bg-[#6DC6A4]/5 px-5 py-4 mb-8">
          <ShieldCheck size={18} className="text-[#6DC6A4] shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-semibold text-[#6DC6A4]">Purchase verified</p>
            <p className="text-[10px] text-[#5a5142] mt-0.5">
              {access?.buyer_email ? <>Access granted to {access.buyer_email}.</> : 'You have full bundle access.'}
              {' '}
              Keep this link private.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[minmax(220px,300px)_1fr] gap-8 items-start">
          {/* Cover */}
          <div className="md:sticky md:top-24">
            <div className="w-full aspect-square rounded-2xl overflow-hidden bg-[#14110d] border border-[#1f1a13] shadow-[0_16px_60px_rgba(0,0,0,0.6)]">
              {project.cover_url ? (
                <img src={project.cover_url} alt={project.name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-[#2A2418] to-[#0a0907] text-[#5a5142]">
                  <Layers size={48} />
                </div>
              )}
            </div>
            {creator?.contact_email && (
              <a
                href={`mailto:${creator.contact_email}`}
                className="mt-4 flex items-center justify-center gap-2 w-full py-2.5 rounded-xl border border-[#1f1a13] bg-[#14110d] text-[11px] text-[#a08a6a] hover:text-[#E8DCC8] hover:border-[#2d2620] transition-colors"
              >
                <Mail size={12} />
                Contact producer
              </a>
            )}
          </div>

          {/* Details */}
          <div className="flex flex-col gap-6 min-w-0">
            <div>
              <p className="text-[10px] font-mono uppercase tracking-[0.25em] text-[#a08a6a] mb-2">
                Project bundle
              </p>
              <h1 className="text-2xl md:text-4xl font-bold text-white leading-tight tracking-tight">
                {project.name}
              </h1>
              {creator?.display_name && (
                <p className="mt-1 text-[13px] text-[#6a5d4a]">
                  prod. {creator.display_name}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2 mt-4">
                <span className="text-[10px] font-mono uppercase tracking-wider text-[#a08a6a] bg-[#14110d] border border-[#1f1a13] px-2.5 py-1 rounded-full">
                  {tracks.length} {tracks.length === 1 ? 'track' : 'tracks'}
                </span>
                {totalDuration > 0 && (
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[#a08a6a] bg-[#14110d] border border-[#1f1a13] px-2.5 py-1 rounded-full">
                    {fmt(totalDuration)} total
                  </span>
                )}
              </div>
            </div>

            {project.description && (
              <div className="rounded-xl border border-[#1f1a13] bg-[#14110d] px-5 py-4">
                <p className="text-[13px] text-[#a08a6a] leading-relaxed whitespace-pre-line">
                  {project.description}
                </p>
              </div>
            )}

            {/* Track list with download buttons */}
            <div>
              <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#5a5142] mb-3">
                Your files
              </p>
              {tracks.length === 0 ? (
                <div className="rounded-xl border border-[#1f1a13] bg-[#14110d] px-5 py-6 text-center">
                  <Music size={20} className="text-[#3a3328] mx-auto mb-2" />
                  <p className="text-[12px] text-[#6a5d4a]">No tracks in this project.</p>
                </div>
              ) : (
                <div className="rounded-xl border border-[#1f1a13] bg-[#14110d] overflow-hidden divide-y divide-[#1a160f]">
                  {tracks.map((t, i) => {
                    const isCur = currentTrack?.id === t.id;
                    const isCurPlaying = isCur && isPlaying;
                    const wav = t.wav_url;
                    const mp3 = t.audio_url;
                    return (
                      <div
                        key={t.id}
                        className={`flex items-center gap-3 px-4 py-3 hover:bg-[#16130e] transition-colors ${isCur ? 'bg-[#16130e]' : ''}`}
                      >
                        <button
                          onClick={() => {
                            if (isCur) { togglePlay(); return; }
                            setQueue(tracks as unknown as Track[]);
                            playTrack(t as unknown as Track);
                          }}
                          className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                            isCur ? 'bg-[#D4BFA0] text-black' : 'bg-white/[0.06] text-[#a08a6a] hover:bg-white/[0.12] hover:text-white'
                          }`}
                        >
                          {isCurPlaying
                            ? <Pause size={11} fill="currentColor" />
                            : <Play size={11} fill="currentColor" className="ml-0.5" />}
                        </button>
                        <span className="text-[10px] font-mono text-[#5a5142] tabular-nums w-5 text-right shrink-0">
                          {i + 1}
                        </span>
                        <div className="w-9 h-9 rounded-md shrink-0 bg-[#0a0907] overflow-hidden border border-[#1f1a13]">
                          {t.cover_url
                            ? <img src={t.cover_url} alt="" className="w-full h-full object-cover" />
                            : <div className="w-full h-full flex items-center justify-center text-[#3a3328]"><Music size={12} /></div>}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-[12px] font-medium truncate ${isCur ? 'text-[#D4BFA0]' : 'text-[#E8DCC8]'}`}>
                            {t.title}
                          </p>
                          <p className="text-[9px] font-mono text-[#5a5142] uppercase tracking-wider">
                            {t.type}
                            {t.bpm ? ` · ${t.bpm} BPM` : ''}
                            {t.key ? ` · ${t.key}` : ''}
                          </p>
                        </div>
                        <span className="hidden sm:inline text-[10px] font-mono text-[#5a5142] tabular-nums shrink-0">
                          {fmt(t.duration_seconds)}
                        </span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {wav && (
                            <a
                              href={wav}
                              download
                              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#D4BFA0] text-black text-[10px] font-bold uppercase tracking-wider hover:bg-[#E8D8B8] transition-colors"
                            >
                              <Download size={10} />
                              WAV
                            </a>
                          )}
                          {mp3 && (
                            <a
                              href={mp3}
                              download
                              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/[0.06] border border-white/[0.08] text-[#E8DCC8] text-[10px] font-bold uppercase tracking-wider hover:bg-white/[0.12] transition-colors"
                            >
                              <Download size={10} />
                              MP3
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
