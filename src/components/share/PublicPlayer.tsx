'use client';

import { useState } from 'react';
import NextImage from 'next/image';
import bcrypt from 'bcryptjs';
import { Lock, Download, Music } from 'lucide-react';
import { WavePlayer } from '@/components/player/WavePlayer';

interface PublicShareLink {
  password_hash?: string | null;
}

interface PublicTrack {
  id: string;
  title: string;
  type?: string | null;
  audio_url: string;
  cover_url?: string | null;
  peaks_url?: string | null;
  bpm?: number | null;
  key?: string | null;
  scale?: string | null;
}

interface PublicPlayerProps {
  shareLink: PublicShareLink;
  tracks: PublicTrack[];
}

export function PublicPlayer({ shareLink, tracks }: PublicPlayerProps) {
  const [password, setPassword] = useState('');
  const [isUnlocked, setIsUnlocked] = useState(!shareLink.password_hash);
  const [error, setError] = useState('');
  const [activeTrack, setActiveTrack] = useState(tracks[0]);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const passwordHash = shareLink.password_hash;
    if (!passwordHash) {
      setIsUnlocked(true);
      return;
    }
    
    const matches = await bcrypt.compare(password, passwordHash);
    if (matches) {
      setIsUnlocked(true);
    } else {
      setError('Invalid Access Key');
    }
  };

  if (!isUnlocked) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-8 text-center">
          <div className="mx-auto w-16 h-16 bg-[#0E0E0E] border border-white/10 rounded-2xl flex items-center justify-center text-white">
            <Lock size={24} />
          </div>
          
          <div className="space-y-2">
            <h1 className="text-sm font-black uppercase tracking-[0.4em] text-white">Encrypted Access</h1>
            <p className="text-[10px] font-bold uppercase tracking-widest text-white/40">Enter shared key to stream assets</p>
          </div>

          <form onSubmit={handleUnlock} className="space-y-4">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="ENTER PASSCODE..."
              className="w-full bg-[#0E0E0E] border border-white/10 rounded-xl py-4 px-6 text-center text-xs font-bold uppercase tracking-[0.2em] text-white placeholder-white/30 focus:outline-none focus:border-white/30 transition-all"
              autoFocus
            />
            {error && <p className="text-red-500 text-[10px] font-black uppercase tracking-widest">{error}</p>}
            <button
              type="submit"
              className="w-full bg-white text-[#090907] rounded-xl py-4 text-[10px] font-black uppercase tracking-[0.3em] hover:bg-white hover:text-white transition-all duration-300"
            >
              Unlock Transmission
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-8 lg:p-16 space-y-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row items-center md:items-end gap-8 border-b border-white/10 pb-12">
        <div className="relative w-48 h-48 bg-[#0E0E0E] rounded-sm shadow-2xl flex items-center justify-center text-white/30 overflow-hidden">
          {activeTrack?.cover_url ? (
            <NextImage src={activeTrack.cover_url} alt="" fill sizes="192px" unoptimized className="object-cover" />
          ) : (
            <Music size={64} />
          )}
        </div>
        <div className="flex-1 text-center md:text-left space-y-4">
          <p className="text-[10px] font-black uppercase tracking-[0.4em] text-white">Public Stream</p>
          <h1 className="text-4xl md:text-5xl font-black uppercase tracking-tight leading-none text-white">
            {activeTrack?.title || 'Shared Asset'}
          </h1>
          <div className="flex flex-wrap justify-center md:justify-start gap-4">
             <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">{activeTrack?.bpm} BPM</span>
             <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">{activeTrack?.key} {activeTrack?.scale}</span>
          </div>
        </div>
      </div>

      {/* Main Track Player */}
      <div className="bg-[#0E0E0E]/50 border border-white/10 rounded-3xl p-8 space-y-8 backdrop-blur-xl">
        <WavePlayer
          url={activeTrack?.audio_url}
          peaksUrl={activeTrack?.peaks_url ?? null}
          onFinish={() => {}}
        />
        
        <div className="flex items-center justify-between pt-4">
          <div className="flex gap-2">
            <button className="bg-white text-[#090907] px-6 py-3 rounded-full text-[10px] font-black uppercase tracking-widest flex items-center gap-2 hover:bg-white hover:text-white transition-all">
              <Download size={14} /> Download
            </button>
          </div>
          <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest">
            {tracks.length} Asset{tracks.length > 1 ? 's' : ''} in Bundle
          </p>
        </div>
      </div>

      {/* Track List if multiple */}
      {tracks.length > 1 && (
        <div className="space-y-4">
          <h2 className="text-[10px] font-black uppercase tracking-[0.3em] text-white/40 ml-2">Bundle Contents</h2>
          <div className="grid gap-2">
            {tracks.map((track, i) => (
              <button
                key={track.id}
                onClick={() => setActiveTrack(track)}
                className={`
                  flex items-center gap-4 p-4 rounded-2xl border transition-all duration-300
                  ${activeTrack?.id === track.id 
                    ? 'bg-white/10 border-white/50 text-white' 
                    : 'bg-[#0E0E0E] border-white/10 text-white/80 hover:border-white/30'}
                `}
              >
                <span className="text-[10px] font-black opacity-30 w-4">{(i + 1).toString().padStart(2, '0')}</span>
                <span className="flex-1 text-left text-xs font-black uppercase tracking-wider">{track.title}</span>
                <span className="text-[10px] font-bold opacity-50">{track.bpm} BPM</span>
              </button>
            ))}
          </div>
        </div>
      )}
      
      <footer className="pt-20 text-center opacity-20">
        <p className="text-[9px] font-black uppercase tracking-[0.5em]">U2C Beatstore</p>
      </footer>
    </div>
  );
}
