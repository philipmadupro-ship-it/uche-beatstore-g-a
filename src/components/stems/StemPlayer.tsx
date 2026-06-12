'use client';

import { useState, useEffect, useRef } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { Play, Pause, Volume2, VolumeX, Loader2 } from 'lucide-react';

interface StemPlayerProps {
  vocalsUrl: string;
  drumsUrl: string;
  bassUrl: string;
  otherUrl: string;
}

export function StemPlayer({ vocalsUrl, drumsUrl, bassUrl, otherUrl }: StemPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [volumes, setVolumes] = useState({ vocals: 0.8, drums: 0.8, bass: 0.8, other: 0.8 });
  const [mutes, setMutes] = useState({ vocals: false, drums: false, bass: false, other: false });
  
  const wavesurfers = useRef<{[key: string]: WaveSurfer | null}>({
    vocals: null, drums: null, bass: null, other: null
  });

  const containers = {
    vocals: useRef<HTMLDivElement>(null),
    drums: useRef<HTMLDivElement>(null),
    bass: useRef<HTMLDivElement>(null),
    other: useRef<HTMLDivElement>(null),
  };

  useEffect(() => {
    let readyCount = 0;
    const urls = { vocals: vocalsUrl, drums: drumsUrl, bass: bassUrl, other: otherUrl };

    Object.entries(urls).forEach(([key, url]) => {
      if (!containers[key as keyof typeof containers].current) return;

      wavesurfers.current[key] = WaveSurfer.create({
        container: containers[key as keyof typeof containers].current!,
        // Match the app-wide waveform palette: frosted unplayed bars + warm
        // accent played, thin rounded "liquid" bars.
        waveColor: 'rgba(232,220,200,0.18)',
        progressColor: '#E7D7BE',
        height: 40,
        barWidth: 2,
        barGap: 1.6,
        barRadius: 3,
        normalize: true,
      });

      wavesurfers.current[key]?.load(url);
      wavesurfers.current[key]?.on('ready', () => {
        readyCount++;
        if (readyCount === 4) setLoading(false);
      });
    });

    // Synchronized seek
    const mainKey = 'vocals';
    wavesurfers.current[mainKey]?.on('interaction', () => {
      const time = wavesurfers.current[mainKey]?.getCurrentTime() || 0;
      Object.values(wavesurfers.current).forEach(ws => ws?.setTime(time));
    });

    return () => {
      Object.values(wavesurfers.current).forEach(ws => ws?.destroy());
    };
  }, [vocalsUrl, drumsUrl, bassUrl, otherUrl]);

  useEffect(() => {
    Object.values(wavesurfers.current).forEach(ws => {
      if (isPlaying) ws?.play();
      else ws?.pause();
    });
  }, [isPlaying]);

  const handleVolumeChange = (key: string, val: number) => {
    setVolumes(prev => ({ ...prev, [key]: val }));
    if (!mutes[key as keyof typeof mutes]) {
      wavesurfers.current[key]?.setVolume(val);
    }
  };

  const toggleMute = (key: string) => {
    const newMute = !mutes[key as keyof typeof mutes];
    setMutes(prev => ({ ...prev, [key]: newMute }));
    wavesurfers.current[key]?.setVolume(newMute ? 0 : volumes[key as keyof typeof volumes]);
  };

  const StemRow = ({ name, iconColor }: { name: string, iconColor: string }) => (
    <div className="flex flex-col gap-3 p-6 bg-[#090907] border border-[#2B2821] rounded-2xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-2 h-2 rounded-full ${iconColor}`} />
          <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[#F7EBDD]">{name}</span>
        </div>
        <div className="flex items-center gap-4">
          <button onClick={() => toggleMute(name.toLowerCase())} className={`${mutes[name.toLowerCase() as keyof typeof mutes] ? 'text-red-500' : 'text-[#837B6D] hover:text-[#F7EBDD]'} transition-colors`}>
            {mutes[name.toLowerCase() as keyof typeof mutes] ? <VolumeX size={14} /> : <Volume2 size={14} />}
          </button>
          <input 
            type="range" min="0" max="1" step="0.01" 
            value={volumes[name.toLowerCase() as keyof typeof volumes]}
            onChange={(e) => handleVolumeChange(name.toLowerCase(), parseFloat(e.target.value))}
            className="w-24 h-1 bg-[#2B2821] rounded-full appearance-none cursor-pointer accent-[#E7D7BE]"
          />
        </div>
      </div>
      <div ref={containers[name.toLowerCase() as keyof typeof containers]} className="opacity-50" />
    </div>
  );

  return (
    <div className="space-y-4 bg-[#1A1813] p-8 rounded-3xl border border-[#2B2821]">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h3 className="text-sm font-black uppercase tracking-[0.3em] text-[#F7EBDD]">Stem Mixer</h3>
          <p className="text-[9px] font-bold uppercase tracking-widest text-[#837B6D] mt-1">4-Channel Spectral Isolation</p>
        </div>
        <button 
          onClick={() => setIsPlaying(!isPlaying)}
          disabled={loading}
          className="w-12 h-12 rounded-full bg-[#E7D7BE] text-white flex items-center justify-center hover:scale-105 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-xl shadow-[#E7D7BE]/20"
        >
          {loading ? <Loader2 size={20} className="animate-spin" /> : (isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="ml-1" />)}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <StemRow name="Vocals" iconColor="bg-blue-500" />
        <StemRow name="Drums" iconColor="bg-red-500" />
        <StemRow name="Bass" iconColor="bg-yellow-500" />
        <StemRow name="Other" iconColor="bg-green-500" />
      </div>
    </div>
  );
}
