'use client';

import { useState } from 'react';
import bcrypt from 'bcryptjs';
import { Lock, Play, Pause, Download, Music } from 'lucide-react';
import { WavePlayer } from '@/components/player/WavePlayer';

interface PublicPlayerProps {
  shareLink: any;
  tracks: any[];
}

export function PublicPlayer({ shareLink, tracks }: PublicPlayerProps) {
  const [password, setPassword] = useState('');
  const [isUnlocked, setIsUnlocked] = useState(!shareLink.password_hash);
  const [error, setError] = useState('');
  const [activeTrack, setActiveTrack] = useState(tracks[0]);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    const matches = await bcrypt.compare(password, shareLink.password_hash);
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
          <div className="mx-auto w-16 h-16 bg-[#16130e] border border-[#1f1a13] rounded-2xl flex items-center justify-center text-[#D4BFA0]">
            <Lock size={24} />
          </div>
          
          <div className="space-y-2">
            <h1 className="text-sm font-black uppercase tracking-[0.4em] text-[#E8DCC8]">Encrypted Access</h1>
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#4a4338]">Enter shared key to stream assets</p>
          </div>

          <form onSubmit={handleUnlock} className="space-y-4">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="ENTER PASSCODE..."
              className="w-full bg-[#16130e] border border-[#1f1a13] rounded-xl py-4 px-6 text-center text-xs font-bold uppercase tracking-[0.2em] text-[#E8DCC8] placeholder-[#2d2620] focus:outline-none focus:border-[#D4BFA0] transition-all"
              autoFocus
            />
            {error && <p className="text-red-500 text-[10px] font-black uppercase tracking-widest">{error}</p>}
            <button
              type="submit"
              className="w-full bg-[#E8DCC8] text-[#0a0907] rounded-xl py-4 text-[10px] font-black uppercase tracking-[0.3em] hover:bg-[#D4BFA0] hover:text-[#E8DCC8] transition-all duration-300"
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
      <div className="flex flex-col md:flex-row items-center md:items-end gap-8 border-b border-[#1f1a13] pb-12">
        <div className="w-48 h-48 bg-[#16130e] rounded-sm shadow-2xl flex items-center justify-center text-[#2d2620]">
          {activeTrack?.cover_url ? (
            <img loading="lazy" src={activeTrack.cover_url} alt="" className="w-full h-full object-cover rounded-sm" />
          ) : (
            <Music size={64} />
          )}
        </div>
        <div className="flex-1 text-center md:text-left space-y-4">
          <p className="text-[10px] font-black uppercase tracking-[0.4em] text-[#D4BFA0]">Public Stream</p>
          <h1 className="text-4xl md:text-5xl font-black uppercase tracking-tight leading-none text-[#E8DCC8]">
            {activeTrack?.title || 'Shared Asset'}
          </h1>
          <div className="flex flex-wrap justify-center md:justify-start gap-4">
             <span className="text-[10px] font-bold text-[#4a4338] uppercase tracking-widest">{activeTrack?.bpm} BPM</span>
             <span className="text-[10px] font-bold text-[#4a4338] uppercase tracking-widest">{activeTrack?.key} {activeTrack?.scale}</span>
          </div>
        </div>
      </div>

      {/* Main Track Player */}
      <div className="bg-[#16130e]/50 border border-[#1f1a13] rounded-3xl p-8 space-y-8 backdrop-blur-xl">
        <WavePlayer
          url={activeTrack?.audio_url}
          peaksUrl={activeTrack?.peaks_url ?? null}
          onFinish={() => {}}
        />
        
        <div className="flex items-center justify-between pt-4">
          <div className="flex gap-2">
            <button className="bg-[#E8DCC8] text-[#0a0907] px-6 py-3 rounded-full text-[10px] font-black uppercase tracking-widest flex items-center gap-2 hover:bg-[#D4BFA0] hover:text-white transition-all">
              <Download size={14} /> Download
            </button>
          </div>
          <p className="text-[10px] font-bold text-[#4a4338] uppercase tracking-widest">
            {tracks.length} Asset{tracks.length > 1 ? 's' : ''} in Bundle
          </p>
        </div>
      </div>

      {/* Track List if multiple */}
      {tracks.length > 1 && (
        <div className="space-y-4">
          <h2 className="text-[10px] font-black uppercase tracking-[0.3em] text-[#4a4338] ml-2">Bundle Contents</h2>
          <div className="grid gap-2">
            {tracks.map((track, i) => (
              <button
                key={track.id}
                onClick={() => setActiveTrack(track)}
                className={`
                  flex items-center gap-4 p-4 rounded-2xl border transition-all duration-300
                  ${activeTrack?.id === track.id 
                    ? 'bg-[#2A2418] border-[#8A7A5C] text-[#E8D8B8]' 
                    : 'bg-[#16130e] border-[#1f1a13] text-[#a08a6a] hover:border-[#4a4338]'}
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
