'use client';

import { useMemo, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { AudioGradient } from '@/components/ui/AudioGradient';
import { DitherShader, type DitherColorMode, type DitherMode, type DitherTexture } from '@/components/ui/dither-shader';
import { DitherModeSelector } from '@/components/store/DitherModeSelector';
import { usePlayer } from '@/hooks/usePlayer';
import type { Track } from '@/lib/types';

export interface PreviewTrack {
  id: string;
  title: string;
  type: string;
  audio_url: string | null;
  cover_url: string | null;
  peaks_url?: string | null;
  bpm?: number | null;
  key?: string | null;
  scale?: string | null;
}

export interface ShaderPreviewPayload {
  creator?: {
    display_name?: string | null;
    accent_color?: string | null;
  } | null;
  tracks?: PreviewTrack[];
}

interface ShaderPreviewClientProps {
  payload: ShaderPreviewPayload;
}

export function ShaderPreviewClient({ payload }: ShaderPreviewClientProps) {
  const playableTracks = useMemo(
    () => payload.tracks?.filter((track) => track.cover_url && track.audio_url) ?? [],
    [payload.tracks],
  );
  const [selectedId, setSelectedId] = useState(playableTracks[0]?.id ?? null);
  const [mode, setMode] = useState<DitherMode>('bayer');
  const [colorMode, setColorMode] = useState<DitherColorMode>('original');
  const [texture, setTexture] = useState<DitherTexture>('paper');
  const { currentTrack, isPlaying, setTrack, togglePlay, analyserNode } = usePlayer();

  const selectedTrack = playableTracks.find((track) => track.id === selectedId) ?? playableTracks[0] ?? null;
  const accentColor = payload.creator?.accent_color ?? '#D4BFA0';
  const isCurrent = selectedTrack ? currentTrack?.id === selectedTrack.id : false;

  const startPreview = () => {
    if (!selectedTrack) return;
    if (isCurrent) {
      togglePlay();
      return;
    }
    setTrack(selectedTrack as unknown as Track);
  };

  return (
    <main className="min-h-screen bg-[#0a0907] px-4 py-8 text-[#E8DCC8] md:px-10">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-col gap-4 border-b border-white/[0.08] pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-[#a08a6a]">
              Shader preview
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-5xl">
              Audio-reactive dither cover
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[#a08a6a]">
              Uses live store tracks, the active WavePlayer audio engine, and the analyser-driven shader now wired
              into active Store cards.
            </p>
          </div>
          <a
            href="/store"
            className="w-fit rounded-full border border-white/[0.10] px-4 py-2 text-[10px] font-mono uppercase tracking-[0.22em] text-[#a08a6a] transition-colors hover:text-[#E8DCC8]"
          >
            Back to store
          </a>
        </div>

        {!selectedTrack ? (
          <div className="rounded-2xl border border-dashed border-[#1f1a13] p-10 text-center text-sm text-[#a08a6a]">
            No playable store tracks with cover art were found.
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
            <section className="overflow-hidden rounded-[2rem] border border-white/[0.08] bg-[#14110d] shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
              <div className="relative aspect-square min-h-[360px] overflow-hidden bg-black md:aspect-[16/11]">
                <DitherShader
                  src={selectedTrack.cover_url ?? ''}
                  alt={selectedTrack.title}
                  mode={mode}
                  colorMode={colorMode}
                  texture={texture}
                  reactivity={1.45}
                  detail={1.35}
                  analyserNode={isCurrent ? analyserNode : null}
                  gridSize={4}
                  threshold={0.5}
                  brightness={1}
                  className="block h-full w-full"
                />
                <AudioGradient
                  analyserNode={isCurrent ? analyserNode : null}
                  accentColor={accentColor}
                  className="pointer-events-none"
                />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#0a0907] via-[#0a0907]/80 to-transparent p-6">
                  <p className="text-[10px] font-mono uppercase tracking-[0.25em] text-[#a08a6a]">
                    {selectedTrack.type}
                  </p>
                  <h2 className="mt-2 text-3xl font-semibold">{selectedTrack.title}</h2>
                  <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-mono uppercase tracking-[0.18em] text-[#D4BFA0]">
                    {selectedTrack.bpm && <span>{selectedTrack.bpm} BPM</span>}
                    {selectedTrack.key && <span>{selectedTrack.key}{selectedTrack.scale === 'minor' ? 'm' : ''}</span>}
                    {isCurrent && isPlaying && <span>Analyser live</span>}
                  </div>
                </div>
              </div>
            </section>

            <aside className="space-y-4">
              <div className="rounded-3xl border border-white/[0.08] bg-[#14110d] p-4">
                <button
                  type="button"
                  onClick={startPreview}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-4 text-sm font-semibold text-black transition-opacity hover:opacity-90"
                  style={{ backgroundColor: accentColor }}
                >
                  {isCurrent && isPlaying ? <Pause size={16} /> : <Play size={16} />}
                  {isCurrent && isPlaying ? 'Pause shader preview' : 'Play shader preview'}
                </button>
                <p className="mt-3 text-center text-[10px] font-mono uppercase tracking-[0.18em] text-[#6a5d4a]">
                  Audio plays through the global player only
                </p>
              </div>

              <DitherModeSelector
                mode={mode}
                colorMode={colorMode}
                texture={texture}
                onChange={(nextMode, nextColorMode, nextTexture) => {
                  setMode(nextMode);
                  setColorMode(nextColorMode);
                  setTexture(nextTexture);
                }}
              />

              <div className="rounded-3xl border border-white/[0.08] bg-black/20 p-4">
                <p className="mb-3 text-[10px] font-mono uppercase tracking-[0.25em] text-[#6a5d4a]">
                  Preview track
                </p>
                <div className="space-y-2">
                  {playableTracks.map((track) => (
                    <button
                      key={track.id}
                      type="button"
                      onClick={() => setSelectedId(track.id)}
                      className={`w-full rounded-xl border px-3 py-2 text-left text-sm transition-colors ${
                        selectedTrack.id === track.id
                          ? 'border-[#D4BFA0]/45 bg-[#D4BFA0]/10 text-[#E8DCC8]'
                          : 'border-white/[0.06] bg-white/[0.02] text-[#a08a6a] hover:text-[#E8DCC8]'
                      }`}
                    >
                      <span className="block truncate">{track.title}</span>
                      <span className="mt-1 block text-[9px] font-mono uppercase tracking-[0.18em] text-[#6a5d4a]">
                        {track.bpm ? `${track.bpm} BPM` : 'No BPM'} · {track.key ?? 'No key'}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </aside>
          </div>
        )}
      </div>
    </main>
  );
}
