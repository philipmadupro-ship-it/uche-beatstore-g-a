'use client';

import { useMemo, useState } from 'react';
import { TAG_TAXONOMY } from '@/lib/types/tags';
import { useTags } from '@/hooks/useTags';
import { useTagVocabulary } from '@/hooks/useTagVocabulary';
import { vocabularyWithApplied, tagKey } from '@/lib/tags/vocabulary';
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
  const { vocabulary } = useTagVocabulary();
  const [customTag, setCustomTag] = useState('');

  // The producer's own tags, plus anything applied to this track that the
  // vocabulary hasn't caught up with yet. Without the second half, a tag used
  // on exactly one track disappears from the workspace the moment it's removed.
  const myTags = useMemo(
    () => vocabularyWithApplied(vocabulary, tags),
    [vocabulary, tags],
  );

  const handleToggle = (tag: string, category: string) => {
    const active = tags.includes(tag);
    toggleTag.mutate({ tag, category, active });
  };

  const handleAddCustom = (e: React.FormEvent) => {
    e.preventDefault();
    const next = customTag.trim();
    if (!next) return;
    // Case-insensitive, matching how the vocabulary and tag_colors (mig 107)
    // decide two spellings are one tag. An exact-match check let "Drill" in
    // alongside "drill" as a second, separately-coloured chip.
    if (tags.some((t) => tagKey(t) === tagKey(next))) {
      setCustomTag('');
      return;
    }
    toggleTag.mutate({ tag: next, category: 'custom', active: false });
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
    <div className="space-y-6 p-4 bg-[#0D0D0A] border border-white/10 rounded-2xl w-full max-w-sm shadow-[0_24px_60px_-12px_rgba(0,0,0,0.7)]">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40">Tag Workspace</h3>
      </div>

      {/* Applied tags — the track's current tags, including custom ones that
          aren't in the taxonomy below. Without this a freshly-created custom
          tag had nowhere to render, so it looked like it never got created.
          Click a chip to remove it. */}
      {tags.length > 0 && (
        <div className="space-y-2">
          <label className="ml-1 text-[9px] font-bold uppercase tracking-widest text-white">
            Applied · {tags.length}
          </label>
          <div className="flex flex-wrap gap-1.5">
            {tags.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => toggleTag.mutate({ tag: t, category: 'custom', active: true })}
                title="Remove tag"
                className="group inline-flex items-center gap-1 rounded-lg border border-white/20 bg-white/12 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white transition-colors hover:bg-white/20"
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
          <label className="text-[9px] font-bold uppercase tracking-widest text-white ml-1 flex items-center gap-1.5">
            <Sparkles size={10} className="text-white" />
            Suggested
          </label>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((s) => (
              <button
                key={`${s.category}:${s.tag}`}
                onClick={() => handleToggle(s.tag, s.category)}
                title={s.reason}
                className="group px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all duration-300 border bg-[#090907] border-dashed border-white/20 text-white/80 hover:bg-white/10 hover:border-white/50 hover:text-white"
              >
                {s.tag}
                <span className="ml-1.5 opacity-50 group-hover:opacity-80">+</span>
              </button>
            ))}
          </div>
          <p className="text-[8px] font-mono uppercase tracking-widest text-white/40 ml-1">
            From audio analysis · click to apply
          </p>
        </div>
      )}

      {/* The producer's own vocabulary. Custom tags used to exist only in the
          "Applied" row above, so one created here was saved to the track and
          then never offered again — on this track after removal, or on any
          other track at all. This is where they live now. */}
      {myTags.length > 0 && (
        <div className="space-y-2">
          <label className="ml-1 text-[9px] font-bold uppercase tracking-widest text-white/40">
            Your tags
          </label>
          <div className="flex flex-wrap gap-1.5">
            {myTags.map(({ tag, category, count }) => {
              const active = tags.some((t) => tagKey(t) === tagKey(tag));
              return (
                <button
                  key={tagKey(tag)}
                  onClick={() => toggleTag.mutate({ tag, category, active })}
                  title={count > 1 ? `Used on ${count} tracks` : 'Used on 1 track'}
                  aria-pressed={active}
                  className={`
                    px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all duration-300 border
                    ${active
                      ? 'bg-white/10 text-white border-white/50 shadow-lg shadow-white/10'
                      : 'bg-transparent text-white/40 border-white/20 hover:border-white/30 hover:text-white/80'}
                  `}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {Object.entries(TAG_TAXONOMY).map(([category, options]) => (
        <div key={category} className="space-y-2">
          <label className="text-[9px] font-bold uppercase tracking-widest text-white/40 ml-1">{category}</label>
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
                      ? 'bg-white/10 text-white border-white/50 shadow-lg shadow-white/10' 
                      : 'bg-transparent text-white/40 border-white/20 hover:border-white/30 hover:text-white/80'}
                  `}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <form onSubmit={handleAddCustom} className="pt-4 border-t border-white/10">
        <div className="flex items-center gap-2">
          <div className="relative group flex-1">
            <input
              type="text"
              value={customTag}
              onChange={(e) => setCustomTag(e.target.value)}
              placeholder="ADD CUSTOM TAG..."
              className="w-full bg-[#090907] border border-white/10 rounded-xl py-3 pl-10 pr-4 text-[10px] font-bold uppercase tracking-widest text-white placeholder-white/30 focus:outline-none focus:border-white/30 transition-all"
            />
            <Plus size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30 group-focus-within:text-white transition-colors" />
          </div>
          {/* Explicit submit so the tag adds on click, not just Enter — the
              missing button is why custom tags appeared not to create. */}
          <button
            type="submit"
            disabled={!customTag.trim() || toggleTag.isPending}
            className="shrink-0 rounded-xl bg-white px-4 py-3 text-[10px] font-black uppercase tracking-widest text-black transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-30"
          >
            Add
          </button>
        </div>
      </form>
    </div>
  );
}
