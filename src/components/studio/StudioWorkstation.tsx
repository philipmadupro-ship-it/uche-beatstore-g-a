'use client';

/**
 * Studio Workstation v2 — FL-Lite.
 *
 * Capabilities:
 *  - Per-channel: gain, pan, 3-band EQ (low/mid/high), reverb send, delay send,
 *    mute/solo, real-time level meter
 *  - Master: compressor (built into engine), reverb return, delay return,
 *    master gain, level meter
 *  - Tempo (with optional pitch lock) + vinyl pitch shift in semitones
 *  - Loop region (A/B markers) with click-and-drag
 *  - 4-pad drum sampler (Kick / Snare / Hat / Clap) routed through its own
 *    channel strip with full FX available
 *  - Recording → captures master output to WebM, with download + Save to library
 *
 * The engine (src/lib/audio/engine.ts) wraps a single AudioContext; this
 * component is "just" the wiring + UI.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Play, Pause, Loader2, Sliders, Music2, Search, RotateCcw, Volume2, VolumeX,
  Headphones, Circle, Square, Download, Save, Repeat,
} from 'lucide-react';
import { Track } from '@/lib/types';
import { audioSrc } from '@/lib/audio/url';
import { StudioEngine, ChannelKey, playKick, playSnare, playHat, playClap } from '@/lib/audio/engine';
import { toast } from '@/hooks/useToast';
import { LyricsStudio } from '@/components/lyrics/LyricsStudio';
import { StudioMasterFX } from '@/components/studio/sections/StudioMasterFX';
import { StudioTrackPicker } from '@/components/studio/sections/StudioTrackPicker';
import { StudioTransport } from '@/components/studio/sections/StudioTransport';
import { StudioWaveform } from '@/components/studio/sections/StudioWaveform';
import { StudioArrangement } from '@/components/studio/sections/StudioArrangement';
import { StudioMixer } from '@/components/studio/sections/StudioMixer';
import { StudioLastTake } from '@/components/studio/sections/StudioLastTake';

type StemKey = 'vocals' | 'drums' | 'bass' | 'other';

interface StemUrls {
  vocals?: string | null;
  drums?: string | null;
  bass?: string | null;
  other?: string | null;
}

interface ChannelState {
  volume: number;
  pan: number;
  muted: boolean;
  solo: boolean;
  eqLow: number;   // dB
  eqMid: number;   // dB
  eqHigh: number;  // dB
  reverb: number;  // 0..1 send
  delay: number;   // 0..1 send
}

const DEFAULT_CH: ChannelState = {
  volume: 0.85, pan: 0, muted: false, solo: false,
  eqLow: 0, eqMid: 0, eqHigh: 0, reverb: 0, delay: 0,
};

const STEM_COLORS: Record<StemKey | 'pads' | 'master', string> = {
  vocals: 'bg-[#D4BFA0]',
  drums:  'bg-[#E26D5C]',
  bass:   'bg-[#E2C16D]',
  other:  'bg-[#6DC6A4]',
  pads:   'bg-[#F09EE3]',
  master: 'bg-white',
};

function fmtTime(s: number) {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export function StudioWorkstation() {
  // ── Track & stem fetching ──
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loadingTracks, setLoadingTracks] = useState(true);
  const [search, setSearch] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = useMemo(() => tracks.find((t) => t.id === activeId) || null, [tracks, activeId]);

  // Deep-link support: /studio?track=<id> auto-loads that track once the
  // tracks list resolves. Powers the "Send to studio" action from
  // TrackDetailsDrawer / library detail — opens this page with the
  // track preselected. We only apply the param once per mount; user
  // changes via the picker should not get clobbered by a later effect
  // run from the same searchParams reference.
  const searchParams = useSearchParams();
  const requestedTrackId = searchParams?.get('track') ?? null;
  const requestedAppliedRef = useRef(false);
  useEffect(() => {
    if (requestedAppliedRef.current) return;
    if (!requestedTrackId) return;
    if (!tracks.some((t) => t.id === requestedTrackId)) return;
    setActiveId(requestedTrackId);
    requestedAppliedRef.current = true;
  }, [requestedTrackId, tracks]);

  const [stems, setStems] = useState<StemUrls | null>(null);
  const [stemsLoading, setStemsLoading] = useState(false);

  // ── Transport ──
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [tempo, setTempo] = useState(1.0);
  const [preservePitch, setPreservePitch] = useState(true);
  const [pitchSemis, setPitchSemis] = useState(0);

  // ── Loop ──
  const [loopOn, setLoopOn] = useState(false);
  const [loopA, setLoopA] = useState(0);
  const [loopB, setLoopB] = useState(0);

  // ── Arrangement playback config ──
  // Snapshot of the StudioArrangement panel's ordered clip list + the
  // "Play arranged" mode toggle. When `mode` is true and `clips` is
  // non-empty, the playback tick jumps the source audio's currentTime
  // across clip boundaries in display order rather than playing
  // linearly. `currentClipIdxRef` survives across re-renders so we
  // don't reset to clip 0 every tick.
  const [arrConfig, setArrConfig] = useState<{
    mode: boolean;
    clips: Array<{ id: string; sourceStart: number; sourceEnd: number }>;
  }>({ mode: false, clips: [] });
  const currentClipIdxRef = useRef(0);

  // ── Master + channel state ──
  const [masterVol, setMasterVol] = useState(0.9);
  const [reverbReturn, setReverbReturn] = useState(0.7);
  const [delayReturn, setDelayReturn] = useState(0.6);
  const [delayTime, setDelayTime] = useState(0.375);
  const [delayFeedback, setDelayFeedback] = useState(0.35);

  const [channels, setChannels] = useState<Record<'master' | StemKey | 'pads', ChannelState>>({
    master: { ...DEFAULT_CH, volume: 0.9 },
    vocals: { ...DEFAULT_CH },
    drums:  { ...DEFAULT_CH },
    bass:   { ...DEFAULT_CH },
    other:  { ...DEFAULT_CH },
    pads:   { ...DEFAULT_CH },
  });

  // ── Recording ──
  const [recording, setRecording] = useState(false);
  const [lastTake, setLastTake] = useState<{ url: string; size: number; mime: string } | null>(null);
  const [savingTake, setSavingTake] = useState(false);

  // ── Engine + audio elements ──
  const engineRef = useRef<StudioEngine | null>(null);
  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({});
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recChunksRef = useRef<Blob[]>([]);
  const tickRef = useRef<number | null>(null);

  // Init engine on mount
  useEffect(() => {
    const eng = new StudioEngine();
    engineRef.current = eng;
    eng.attachBus('pads');
    return () => {
      eng.destroy();
      engineRef.current = null;
    };
  }, []);

  // Fetch tracks
  useEffect(() => {
    let cancelled = false;
    fetch('/api/tracks')
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const arr: Track[] = Array.isArray(d) ? d : d.tracks || [];
        setTracks(arr.filter((t) => !!t.audio_url));
        setLoadingTracks(false);
      })
      .catch(() => setLoadingTracks(false));
    return () => { cancelled = true; };
  }, []);

  // Fetch stems on track change
  useEffect(() => {
    if (!active) { setStems(null); return; }
    setStems(null);
    if (active.stems_status === 'done') {
      setStemsLoading(true);
      fetch(`/api/stems?track_id=${active.id}`)
        .then((r) => r.json())
        .then((d) => {
          const s = d?.stem || d?.stems || d;
          if (s && (s.vocals_url || s.drums_url || s.bass_url || s.other_url)) {
            setStems({
              vocals: s.vocals_url, drums: s.drums_url, bass: s.bass_url, other: s.other_url,
            });
          }
        })
        .finally(() => setStemsLoading(false));
    }
  }, [active]);

  // Reset transport on track / stems change
  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setLoopOn(false);
    setLoopA(0);
    setLoopB(0);
  }, [activeId, stems]);

  const useStems = !!stems;
  const channelKeys: ('master' | StemKey)[] = useStems ? ['vocals', 'drums', 'bass', 'other'] : ['master'];

  // After audio element refs settle, attach engine channels
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng || !active) return;
    // Detach any previous track channels
    ['master', 'vocals', 'drums', 'bass', 'other'].forEach((k) => eng.detachChannel(k));

    // Wait one tick for refs to mount
    const id = requestAnimationFrame(() => {
      if (useStems) {
        (['vocals', 'drums', 'bass', 'other'] as StemKey[]).forEach((k) => {
          const el = audioRefs.current[k];
          if (el) eng.attachChannel(k, el);
        });
      } else {
        const el = audioRefs.current['master'];
        if (el) eng.attachChannel('master', el);
      }
      // Pads bus is permanent
      if (!eng.channels.has('pads')) eng.attachBus('pads');
    });
    return () => cancelAnimationFrame(id);
  }, [activeId, useStems]);

  // Apply channel state to engine continuously
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng) return;
    const anySolo = (['master', 'vocals', 'drums', 'bass', 'other', 'pads'] as const).some(
      (k) => channels[k]?.solo
    );
    const apply = (k: 'master' | StemKey | 'pads') => {
      const node = eng.channels.get(k);
      const ch = channels[k];
      if (!node || !ch) return;
      const muted = ch.muted || (anySolo && !ch.solo);
      node.gain.gain.value = muted ? 0 : ch.volume;
      node.pan.pan.value = ch.pan;
      node.eqLow.gain.value = ch.eqLow;
      node.eqMid.gain.value = ch.eqMid;
      node.eqHigh.gain.value = ch.eqHigh;
      node.reverbSend.gain.value = ch.reverb;
      node.delaySend.gain.value = ch.delay;
    };
    channelKeys.forEach((k) => apply(k as 'master' | StemKey));
    apply('pads');
  }, [channels, useStems, activeId]);

  // Master + FX returns
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.masterGain.gain.value = masterVol;
    eng.reverbReturn.gain.value = reverbReturn;
    eng.delayReturn.gain.value = delayReturn;
    eng.delayNode.delayTime.value = Math.max(0, Math.min(2, delayTime));
    eng.delayFeedback.gain.value = Math.max(0, Math.min(0.95, delayFeedback));
  }, [masterVol, reverbReturn, delayReturn, delayTime, delayFeedback]);

  // Tempo + pitch (HTMLAudioElement playbackRate / preservesPitch)
  const effectiveRate = preservePitch ? tempo : tempo * Math.pow(2, pitchSemis / 12);
  useEffect(() => {
    const els = ['master', 'vocals', 'drums', 'bass', 'other']
      .map((k) => audioRefs.current[k])
      .filter((el): el is HTMLAudioElement => !!el);
    els.forEach((el) => {
      el.playbackRate = effectiveRate;
      // `preservesPitch` is in the HTML spec but TypeScript's
      // HTMLMediaElement still doesn't ship it across all targets, and
      // the Moz / Webkit prefixed forms are vendor-only. Cast through a
      // local pitch-control shape so we're explicit about what we're
      // touching rather than blanket @ts-ignore (which suppressed
      // unrelated future errors).
      const e = el as HTMLAudioElement & {
        preservesPitch?: boolean;
        mozPreservesPitch?: boolean;
        webkitPreservesPitch?: boolean;
      };
      e.preservesPitch = preservePitch;
      e.mozPreservesPitch = preservePitch;
      e.webkitPreservesPitch = preservePitch;
    });
  }, [effectiveRate, preservePitch, useStems, activeId]);

  // Time / loop tick
  const leader = () => {
    for (const k of channelKeys) {
      const el = audioRefs.current[k];
      if (el) return el;
    }
    return null;
  };

  useEffect(() => {
    if (!isPlaying) {
      if (tickRef.current) cancelAnimationFrame(tickRef.current);
      return;
    }
    const tick = () => {
      const l = leader();
      if (l) {
        setCurrentTime(l.currentTime);
        if (l.duration && isFinite(l.duration)) setDuration(l.duration);

        // Arrangement playback wins over normal loop logic when
        // active. When the source's currentTime crosses the current
        // clip's sourceEnd, we advance to the next clip in display
        // order by setting every audio element's currentTime to
        // that clip's sourceStart. When there's no next clip, we
        // pause — same behaviour as hitting the natural end of a
        // linear track.
        const ac = arrConfig;
        if (ac.mode && ac.clips.length > 0) {
          let idx = currentClipIdxRef.current;
          // Resync the index if the playhead is suddenly outside the
          // currently-tracked clip (e.g. user clicked a different clip
          // mid-playback or seeked the source ribbon).
          const cur = ac.clips[idx];
          if (!cur || l.currentTime < cur.sourceStart - 0.2 || l.currentTime >= cur.sourceEnd + 0.2) {
            const found = ac.clips.findIndex((c) => l.currentTime >= c.sourceStart - 0.05 && l.currentTime < c.sourceEnd);
            if (found >= 0) {
              idx = found;
              currentClipIdxRef.current = idx;
            }
          }
          const clip = ac.clips[idx];
          if (clip && l.currentTime >= clip.sourceEnd - 0.005) {
            const next = ac.clips[idx + 1];
            if (next) {
              currentClipIdxRef.current = idx + 1;
              const els = channelKeys
                .map((k) => audioRefs.current[k])
                .filter((el): el is HTMLAudioElement => !!el);
              els.forEach((el) => { el.currentTime = next.sourceStart; });
            } else {
              // End of arrangement — pause and reset to first clip
              // so the next play starts from the top.
              currentClipIdxRef.current = 0;
              setIsPlaying(false);
            }
          }
        } else if (loopOn && loopB > loopA && l.currentTime >= loopB) {
          // Standard loop region — only honored when arrangement
          // playback isn't running.
          const els = channelKeys
            .map((k) => audioRefs.current[k])
            .filter((el): el is HTMLAudioElement => !!el);
          els.forEach((el) => (el.currentTime = loopA));
        }
      }
      tickRef.current = requestAnimationFrame(tick);
    };
    tickRef.current = requestAnimationFrame(tick);
    return () => {
      if (tickRef.current) cancelAnimationFrame(tickRef.current);
    };
  }, [isPlaying, loopOn, loopA, loopB, useStems, activeId, arrConfig]);

  // Stem drift correction
  useEffect(() => {
    if (!useStems || !isPlaying) return;
    const id = setInterval(() => {
      const els = (['vocals', 'drums', 'bass', 'other'] as StemKey[])
        .map((k) => audioRefs.current[k])
        .filter((el): el is HTMLAudioElement => !!el);
      if (els.length < 2) return;
      const ref = els[0].currentTime;
      for (let i = 1; i < els.length; i++) {
        if (Math.abs(els[i].currentTime - ref) > 0.05) {
          els[i].currentTime = ref;
        }
      }
    }, 1000);
    return () => clearInterval(id);
  }, [useStems, isPlaying, activeId]);

  const togglePlay = async () => {
    const eng = engineRef.current;
    if (eng) await eng.resume();
    const els = channelKeys
      .map((k) => audioRefs.current[k])
      .filter((el): el is HTMLAudioElement => !!el);
    if (els.length === 0) return;
    if (isPlaying) {
      els.forEach((el) => el.pause());
      setIsPlaying(false);
    } else {
      // Arrangement-mode play start. If the source's currentTime isn't
      // inside any clip in the ordered list, jump to the first clip's
      // sourceStart so play actually moves through the arrangement
      // instead of stalling on a "skipped" region of the source. Same
      // rule applies if we previously played past the last clip and
      // reset currentClipIdxRef to 0 — start from the top.
      const t0 = els[0].currentTime;
      if (arrConfig.mode && arrConfig.clips.length > 0) {
        const containing = arrConfig.clips.findIndex(
          (c) => t0 >= c.sourceStart - 0.05 && t0 < c.sourceEnd,
        );
        if (containing >= 0) {
          currentClipIdxRef.current = containing;
        } else {
          currentClipIdxRef.current = 0;
          const first = arrConfig.clips[0];
          els.forEach((el) => { el.currentTime = first.sourceStart; });
        }
      }
      // Sync any out-of-sync stem channels to whatever the leader is
      // now at (either the original currentTime or the jumped-to
      // clip start above).
      const t = els[0].currentTime;
      els.slice(1).forEach((el) => (el.currentTime = t));
      try {
        await Promise.all(els.map((el) => el.play()));
        setIsPlaying(true);
      } catch (e) {
        console.error(e);
      }
    }
  };

  const seek = (t: number) => {
    const els = channelKeys
      .map((k) => audioRefs.current[k])
      .filter((el): el is HTMLAudioElement => !!el);
    els.forEach((el) => (el.currentTime = t));
    setCurrentTime(t);
  };

  const setChannel = (k: 'master' | StemKey | 'pads', patch: Partial<ChannelState>) => {
    setChannels((prev) => ({ ...prev, [k]: { ...prev[k], ...patch } }));
  };

  const reset = () => {
    setTempo(1);
    setPitchSemis(0);
    setPreservePitch(true);
    setMasterVol(0.9);
    setReverbReturn(0.7);
    setDelayReturn(0.6);
    setDelayTime(0.375);
    setDelayFeedback(0.35);
    setLoopOn(false);
    setLoopA(0);
    setLoopB(0);
    setChannels({
      master: { ...DEFAULT_CH, volume: 0.9 },
      vocals: { ...DEFAULT_CH },
      drums:  { ...DEFAULT_CH },
      bass:   { ...DEFAULT_CH },
      other:  { ...DEFAULT_CH },
      pads:   { ...DEFAULT_CH },
    });
  };

  // ── Drum pads ──
  const triggerPad = async (kind: 'kick' | 'snare' | 'hat' | 'openhat' | 'clap') => {
    const eng = engineRef.current;
    if (!eng) return;
    await eng.resume();
    const padCh = eng.channels.get('pads');
    const dest = padCh?.eqLow || eng.masterIn;
    const ctx = eng.ctx;
    const now = ctx.currentTime;
    if (kind === 'kick') playKick(ctx, dest, now);
    else if (kind === 'snare') playSnare(ctx, dest, now);
    else if (kind === 'hat') playHat(ctx, dest, now, false);
    else if (kind === 'openhat') playHat(ctx, dest, now, true);
    else if (kind === 'clap') playClap(ctx, dest, now);
  };

  // Keyboard shortcuts: 1/2/3/4/5 for pads, space for play
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      else if (e.key === '1') triggerPad('kick');
      else if (e.key === '2') triggerPad('snare');
      else if (e.key === '3') triggerPad('hat');
      else if (e.key === '4') triggerPad('openhat');
      else if (e.key === '5') triggerPad('clap');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isPlaying, useStems, activeId]);

  // ── Recording ──
  const startRecording = async () => {
    const eng = engineRef.current;
    if (!eng) return;
    await eng.resume();
    recChunksRef.current = [];
    const stream = eng.recordDest.stream;
    const mime =
      typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
    const rec = new MediaRecorder(stream, { mimeType: mime });
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) recChunksRef.current.push(e.data);
    };
    rec.onstop = () => {
      const blob = new Blob(recChunksRef.current, { type: mime });
      const url = URL.createObjectURL(blob);
      setLastTake({ url, size: blob.size, mime });
    };
    rec.start();
    recorderRef.current = rec;
    setRecording(true);
  };

  const stopRecording = () => {
    const rec = recorderRef.current;
    if (!rec) return;
    rec.stop();
    recorderRef.current = null;
    setRecording(false);
  };

  const saveTakeToLibrary = async () => {
    if (!lastTake) return;
    setSavingTake(true);
    try {
      const blob = await fetch(lastTake.url).then((r) => r.blob());
      const safeTitle = (active?.title || 'session').replace(/[^a-z0-9 _-]/gi, '').slice(0, 40);
      const filename = `Studio Take ${safeTitle} ${new Date().toISOString().slice(0, 10)}.webm`;
      const file = new File([blob], filename, { type: lastTake.mime });
      const fd = new FormData();
      fd.append('file', file);
      fd.append('type', 'instrumental');
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      if (!res.ok) throw new Error('Upload failed');
      // Refresh tracks
      const r2 = await fetch('/api/tracks').then((x) => x.json());
      const arr: Track[] = Array.isArray(r2) ? r2 : r2.tracks || [];
      setTracks(arr.filter((t) => !!t.audio_url));
    } catch (e: any) {
      toast.error('Save failed', e.message);
    } finally {
      setSavingTake(false);
    }
  };

  const filtered = tracks.filter((t) => t.title.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="max-w-[1600px] mx-auto px-10 pt-10 pb-24">
      {/* Header */}
      <div className="flex items-end justify-between mb-8 pb-6 border-b border-[#16130e]">
        <div>
          {/* "Sketchpad" instead of "FL-Lite" — frames Studio as the
              place to put grooves together loose, before they're full
              tracks. Studio outputs save into the Library when ready;
              everything else (Projects = active work, Playlists = for
              listeners) is a different surface. */}
          <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#5a5142] mb-2">Sketchpad</p>
          <h1 className="text-[28px] font-medium tracking-tight text-white leading-none">Studio</h1>
          <p className="text-[11px] text-[#5a5142] mt-2 max-w-md">
            Put grooves together. Jam over a track, loop a section, layer drums, record a take. Save to the library when you&apos;ve got something.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {recording ? (
            <button
              onClick={stopRecording}
              className="flex items-center gap-2 px-3 py-2 rounded-md bg-red-600 text-white hover:bg-red-700 text-[11px] font-medium transition-colors animate-pulse"
            >
              <Square size={11} fill="currentColor" /> Stop
            </button>
          ) : (
            <button
              onClick={startRecording}
              className="flex items-center gap-2 px-3 py-2 rounded-md border border-red-900/50 bg-[#1f0a0a] text-red-300 hover:bg-red-950 text-[11px] font-medium transition-colors"
            >
              <Circle size={9} fill="currentColor" /> Record
            </button>
          )}
          {active && (
            <button
              onClick={reset}
              className="flex items-center gap-2 px-3 py-2 rounded-md border border-[#1a160f] bg-[#14110d] text-[#a08a6a] hover:text-white text-[11px] font-medium transition-colors"
            >
              <RotateCcw size={11} /> Reset
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-[280px_1fr] gap-6">
        {/* Track picker — extracted to sections/StudioTrackPicker. */}
        <StudioTrackPicker
          tracks={filtered}
          loading={loadingTracks}
          activeId={activeId}
          onPick={setActiveId}
          search={search}
          setSearch={setSearch}
        />

        {/* Workstation */}
        <main>
          {!active ? (
            <div className="border border-dashed border-[#1a160f] rounded-lg py-32 text-center">
              <Sliders size={28} className="text-[#3a3328] mx-auto mb-4" />
              <p className="text-[13px] text-[#E8DCC8] mb-1">Pick a track to start</p>
              <p className="text-[11px] text-[#5a5142]">
                EQ · sends · loop · drum pads · live recording
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Track header */}
              <div className="flex items-end justify-between border border-[#16130e] rounded-lg p-5 bg-[#0a0907]">
                <div className="flex items-center gap-4 min-w-0">
                  {active.cover_url ? (
                    <img loading="lazy"
                      src={audioSrc(active.cover_url) || active.cover_url}
                      alt=""
                      className="w-16 h-16 rounded-md object-cover border border-[#1a160f]"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-md bg-[#16130e] border border-[#1a160f] flex items-center justify-center">
                      <Music2 size={20} className="text-[#4a4338]" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#5a5142] mb-1.5">
                      Now in studio
                    </p>
                    <h2 className="text-[18px] font-medium text-white truncate">{active.title}</h2>
                    <p className="text-[11px] text-[#5a5142] mt-1 font-mono uppercase tracking-wider">
                      {active.bpm ? `${Math.round(active.bpm * effectiveRate)} BPM` : '— BPM'}
                      {active.key && ` · ${active.key}${active.scale ? ' ' + active.scale : ''}`}
                      {tempo !== 1 && ` · ${(tempo * 100).toFixed(0)}%`}
                      {!preservePitch && pitchSemis !== 0 && ` · ${pitchSemis > 0 ? '+' : ''}${pitchSemis}st`}
                      {loopOn && ' · LOOP'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={togglePlay}
                  className="w-12 h-12 rounded-full bg-[#D4BFA0] text-white flex items-center justify-center hover:scale-105 active:scale-95 transition-transform shadow-lg shadow-[#D4BFA0]/20"
                >
                  {isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="ml-0.5" />}
                </button>
              </div>

              {/* Hidden audio elements */}
              <div className="sr-only" aria-hidden>
                {useStems ? (
                  (['vocals', 'drums', 'bass', 'other'] as StemKey[]).map((k) => {
                    const url = stems?.[k];
                    if (!url) return null;
                    return (
                      <audio
                        key={`${active.id}-${k}`}
                        ref={(el) => { audioRefs.current[k] = el; }}
                        src={audioSrc(url)}
                        preload="auto"
                        crossOrigin="anonymous"
                      />
                    );
                  })
                ) : (
                  <audio
                    key={active.id}
                    ref={(el) => { audioRefs.current['master'] = el; }}
                    src={audioSrc(active.audio_url)}
                    preload="auto"
                    crossOrigin="anonymous"
                    onLoadedMetadata={(e) => setDuration((e.target as HTMLAudioElement).duration)}
                    onEnded={() => setIsPlaying(false)}
                  />
                )}
              </div>

              {/* Waveform — mirrored amplitude bars with played/unplayed
                  color split. Click anywhere on the strip to scrub.
                  Reads peaks from a precomputed sidecar if the track
                  has one, else decodes the audio in the browser and
                  caches the result. */}
              {active?.audio_url && (
                <div className="mb-4">
                  <StudioWaveform
                    url={active.audio_url}
                    peaksUrl={active.peaks_url ?? null}
                    currentTime={currentTime}
                    duration={duration}
                    onSeek={seek}
                    height={72}
                  />
                </div>
              )}

              {/* Transport + loop + tempo/pitch — extracted to sections/StudioTransport. */}
              <StudioTransport
                currentTime={currentTime} duration={duration} seek={seek}
                loopOn={loopOn} setLoopOn={setLoopOn}
                loopA={loopA} setLoopA={setLoopA}
                loopB={loopB} setLoopB={setLoopB}
                tempo={tempo} setTempo={setTempo}
                pitchSemis={pitchSemis} setPitchSemis={setPitchSemis}
                preservePitch={preservePitch} setPreservePitch={setPreservePitch}
              />

              {/* Drum pads removed per user request — the 4×4 MPC-style
                  grid wasn't earning its real estate. Keyboard hotkeys
                  (1–5) for kick/snare/hat/openhat/clap still work via
                  the document keydown listener below; triggerPad
                  routes through the engine the same way. */}

              {/* Mixer — extracted to sections/StudioMixer (carries ChannelStrip with it). */}
              <StudioMixer
                useStems={useStems}
                stemsLoading={stemsLoading}
                channels={channels}
                setChannel={setChannel}
              />

              {/* Master + FX — extracted to sections/StudioMasterFX. */}
              <StudioMasterFX
                masterVol={masterVol} setMasterVol={setMasterVol}
                reverbReturn={reverbReturn} setReverbReturn={setReverbReturn}
                delayReturn={delayReturn} setDelayReturn={setDelayReturn}
                delayTime={delayTime} setDelayTime={setDelayTime}
                delayFeedback={delayFeedback} setDelayFeedback={setDelayFeedback}
              />

              {/* Arrangement — in-memory clip editor. Round-6 scope:
                  visual splits + drag-to-reorder, no persistence and
                  no playback rewiring (clicking a clip just seeks the
                  source track to that clip's start). Rounds 7/8 will
                  add the `arrangements` table and play-through-clips. */}
              {active?.audio_url && (
                <StudioArrangement
                  trackId={active.id}
                  url={active.audio_url}
                  peaksUrl={active.peaks_url ?? null}
                  bpm={active.bpm ?? null}
                  duration={duration}
                  currentTime={currentTime}
                  onSeek={seek}
                  onPlayConfigChange={setArrConfig}
                />
              )}

              {/* Lyrics — full editor with auto-save + word tools. The
                  component is self-contained: it fetches and persists via
                  /api/tracks/[id]/lyrics, so we just need to mount it with
                  the active track id. */}
              <div className="border border-[#16130e] rounded-lg p-5 bg-[#0a0907]">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-[#E8DCC8]">Lyrics</p>
                    <p className="text-[10px] text-[#5a5142] mt-1">Auto-saves as you type</p>
                  </div>
                </div>
                <LyricsStudio trackId={active.id} />
              </div>

              {/* Last take — extracted to sections/StudioLastTake. */}
              {lastTake && (
                <StudioLastTake take={lastTake} saving={savingTake} onSave={saveTakeToLibrary} />
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

// Sub-component map:
//   Pad        → sections/StudioDrumPads
//   ChannelStrip + STEM_COLORS + ChannelState → sections/StudioMixer
//   Knob       → inlined inside sections/StudioTransport
