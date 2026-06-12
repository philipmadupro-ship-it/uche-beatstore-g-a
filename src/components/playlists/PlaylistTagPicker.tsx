'use client';
import { useState } from 'react';
import { TAG_TAXONOMY } from '@/lib/types/tags';
import { usePlaylistTags } from '@/hooks/usePlaylistTags';
import { Plus } from 'lucide-react';

/** Tag picker for a playlist — reuses the track taxonomy (genre/mood/instrument/status). */
export function PlaylistTagPicker({ playlistId }: { playlistId: string }) {
  const { tags, toggleTag } = usePlaylistTags(playlistId);
  const [customTag, setCustomTag] = useState('');
  const handleToggle = (tag: string, category: string) => toggleTag.mutate({ tag, category, active: tags.includes(tag) });
  const handleAddCustom = (e: React.FormEvent) => {
    e.preventDefault();
    const t = customTag.trim();
    if (!t || tags.includes(t)) return;
    toggleTag.mutate({ tag: t, category: 'custom', active: false });
    setCustomTag('');
  };
  return (
    <div className="space-y-5 p-4 bg-[#1A1813] border border-[#2B2821] rounded-2xl w-full max-w-sm shadow-2xl">
      <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-[#837B6D]">Playlist tags</h3>
      {Object.entries(TAG_TAXONOMY).map(([category, options]) => (
        <div key={category} className="space-y-2">
          <label className="text-[9px] font-bold uppercase tracking-widest text-[#837B6D] ml-1">{category}</label>
          <div className="flex flex-wrap gap-1.5">
            {options.map((tag) => {
              const active = tags.includes(tag);
              return (
                <button key={tag} onClick={() => handleToggle(tag, category)}
                  className={`px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all border ${active ? 'bg-[#342F27] text-[#F3E6D1] border-[#C9BCA8]' : 'bg-transparent text-[#837B6D] border-[#3B372F] hover:text-[#D0C3AF]'}`}>
                  {tag}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <form onSubmit={handleAddCustom} className="pt-4 border-t border-[#2B2821]">
        <div className="relative group">
          <input type="text" value={customTag} onChange={(e) => setCustomTag(e.target.value)} placeholder="ADD CUSTOM TAG..."
            className="w-full bg-[#090907] border border-[#2B2821] rounded-xl py-3 pl-10 pr-4 text-[10px] font-bold uppercase tracking-widest text-[#F7EBDD] placeholder-[#3B372F] focus:outline-none focus:border-[#E7D7BE] transition-all" />
          <Plus size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#3B372F] group-focus-within:text-[#E7D7BE] transition-colors" />
        </div>
      </form>
    </div>
  );
}
