'use client';

import { useMemo, useState } from 'react';
import { TAG_TAXONOMY } from '@/lib/types/tags';
import { useTags } from '@/hooks/useTags';
import { Plus, Sparkles, X } from 'lucide-react';
import { suggestTags, type TrackFeatures } from '@/lib/audio/feature-tags';

interface TagPickerProps {
  trackId: string;
  /**
   * Audio analysis features for the track. When present, the picker shows a
   * "Suggested" row above the manual taxonomy with one-click chips derived
   * from BPM/energy/valence/etc. Optional so older callers (no features) keep
   * working untouched.
   */
  features?: TrackFeatures | null;
}

export function TagPicker({ trackId, features }: TagPickerProps) {
  const { tags, toggleTag } = useTags(trackId);
  const [customTag, setCustomTag] = useState('');

  const handleToggle = (tag: string, category: string) => {
    const active = tags.includes(tag);
    toggleTag.mutate({ tag, category, active });
  };

  const handleAddCustom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customTag.trim()) return;
    if (tags.includes(customTag.trim())) return;
    toggleTag.mutate({ tag: customTag.trim(), category: 'custom', active: false });
    setCustomTag('');
  };

  // Recompute suggestions only when features or applied tags change.
  // Cheap (synchronous heuristics over a handful of rules) so memo is mostly
  // about reference stability for the rendered chip list.
  const suggestions = useMemo(() => {
    if (!features) return [];
    return suggestTags(features, tags, 6);
  }, [features, tags]);

  return (
    <div className="space-y-6 p-4 bg-[#1A1813] border border-[#2B2821] rounded-2xl w-full max-w-sm shadow-2xl">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-[#837B6D]">Tag Workspace</h3>
      </div>

      {/* Applied tags — the track's current tags, including custom ones that
          aren't in the taxonomy below. Without this a freshly-created custom
          tag had nowhere to render, so it looked like it never got created.
          Click a chip to remove it. */}
      {tags.length > 0 && (
        <div className="space-y-2">
          <label className="ml-1 text-[9px] font-bold uppercase tracking-widest text-[#F3E6D1]">
            Applied · {tags.length}
          </label>
          <div className="flex flex-wrap gap-1.5">
            {tags.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => toggleTag.mutate({ tag: t, category: 'custom', active: true })}
                title="Remove tag"
                className="group inline-flex items-center gap-1 rounded-lg border border-[#E7D7BE]/30 bg-[#E7D7BE]/12 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-[#F3E6D1] transition-colors hover:bg-[#E7D7BE]/20"
              >
                {t}
                <X size={9} className="opacity-60 transition-opacity group-hover:opacity-100" />
              </button>
            ))}
          </div>
        </div>
      )}

      {suggestions.length > 0 && (
        <div className="space-y-2">
          <label className="text-[9px] font-bold uppercase tracking-widest text-[#F3E6D1] ml-1 flex items-center gap-1.5">
            <Sparkles size={10} className="text-[#E7D7BE]" />
            Suggested
          </label>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((s) => (
              <button
                key={`${s.category}:${s.tag}`}
                onClick={() => handleToggle(s.tag, s.category)}
                title={s.reason}
                className="group px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all duration-300 border bg-[#090907] border-dashed border-[#C9BCA8]/40 text-[#F3E6D1]/80 hover:bg-[#342F27] hover:border-[#C9BCA8] hover:text-[#F3E6D1]"
              >
                {s.tag}
                <span className="ml-1.5 opacity-50 group-hover:opacity-80">+</span>
              </button>
            ))}
          </div>
          <p className="text-[8px] font-mono uppercase tracking-widest text-[#837B6D] ml-1">
            From audio analysis · click to apply
          </p>
        </div>
      )}

      {Object.entries(TAG_TAXONOMY).map(([category, options]) => (
        <div key={category} className="space-y-2">
          <label className="text-[9px] font-bold uppercase tracking-widest text-[#837B6D] ml-1">{category}</label>
          <div className="flex flex-wrap gap-1.5">
            {options.map((tag) => {
              const active = tags.includes(tag);
              return (
                <button
                  key={tag}
                  onClick={() => handleToggle(tag, category)}
                  className={`
                    px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all duration-300 border
                    ${active 
                      ? 'bg-[#342F27] text-[#F3E6D1] border-[#C9BCA8] shadow-lg shadow-[#E7D7BE]/5' 
                      : 'bg-transparent text-[#837B6D] border-[#3B372F] hover:border-[#837B6D] hover:text-[#D0C3AF]'}
                  `}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <form onSubmit={handleAddCustom} className="pt-4 border-t border-[#2B2821]">
        <div className="flex items-center gap-2">
          <div className="relative group flex-1">
            <input
              type="text"
              value={customTag}
              onChange={(e) => setCustomTag(e.target.value)}
              placeholder="ADD CUSTOM TAG..."
              className="w-full bg-[#090907] border border-[#2B2821] rounded-xl py-3 pl-10 pr-4 text-[10px] font-bold uppercase tracking-widest text-[#F7EBDD] placeholder-[#3B372F] focus:outline-none focus:border-[#E7D7BE] transition-all"
            />
            <Plus size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#3B372F] group-focus-within:text-[#E7D7BE] transition-colors" />
          </div>
          {/* Explicit submit so the tag adds on click, not just Enter — the
              missing button is why custom tags appeared not to create. */}
          <button
            type="submit"
            disabled={!customTag.trim() || toggleTag.isPending}
            className="shrink-0 rounded-xl bg-[#E7D7BE] px-4 py-3 text-[10px] font-black uppercase tracking-widest text-black transition-colors hover:bg-[#F3E6D1] disabled:cursor-not-allowed disabled:opacity-30"
          >
            Add
          </button>
        </div>
      </form>
    </div>
  );
}
