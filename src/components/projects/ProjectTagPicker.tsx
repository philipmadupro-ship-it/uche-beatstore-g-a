'use client';

import { useState } from 'react';
import { TAG_TAXONOMY, PROJECT_TYPE_OPTIONS } from '@/lib/types/tags';
import { useProjectTags } from '@/hooks/useProjectTags';
import { Plus } from 'lucide-react';

/**
 * Tag picker for a project (mig 081). Same chip UX as the track TagPicker but
 * without audio-derived suggestions, and with an extra "Project type" group
 * (Album / EP / Single / …) sourced from PROJECT_TYPE_OPTIONS. Projects reuse
 * the genre/mood/instrument/status vocab for cross-filtering with the library.
 */
export function ProjectTagPicker({ projectId }: { projectId: string }) {
  const { tags, toggleTag } = useProjectTags(projectId);
  const [customTag, setCustomTag] = useState('');

  const handleToggle = (tag: string, category: string) => {
    toggleTag.mutate({ tag, category, active: tags.includes(tag) });
  };

  const handleAddCustom = (e: React.FormEvent) => {
    e.preventDefault();
    const t = customTag.trim();
    if (!t || tags.includes(t)) return;
    toggleTag.mutate({ tag: t, category: 'custom', active: false });
    setCustomTag('');
  };

  const groups: [string, readonly string[]][] = [
    ['project type', PROJECT_TYPE_OPTIONS],
    ...Object.entries(TAG_TAXONOMY) as [string, readonly string[]][],
  ];

  return (
    <div className="space-y-5 p-4 bg-[#16130e] border border-[#1f1a13] rounded-2xl w-full max-w-sm shadow-2xl">
      <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-[#4a4338]">Project tags</h3>

      {groups.map(([category, options]) => (
        <div key={category} className="space-y-2">
          <label className="text-[9px] font-bold uppercase tracking-widest text-[#4a4338] ml-1">{category}</label>
          <div className="flex flex-wrap gap-1.5">
            {options.map((tag) => {
              const active = tags.includes(tag);
              return (
                <button
                  key={tag}
                  onClick={() => handleToggle(tag, category === 'project type' ? 'project_type' : category)}
                  className={`px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all duration-300 border ${
                    active
                      ? 'bg-[#2A2418] text-[#E8D8B8] border-[#8A7A5C] shadow-lg shadow-[#D4BFA0]/5'
                      : 'bg-transparent text-[#4a4338] border-[#2d2620] hover:border-[#4a4338] hover:text-[#a08a6a]'
                  }`}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <form onSubmit={handleAddCustom} className="pt-4 border-t border-[#1f1a13]">
        <div className="relative group">
          <input
            type="text"
            value={customTag}
            onChange={(e) => setCustomTag(e.target.value)}
            placeholder="ADD CUSTOM TAG..."
            className="w-full bg-[#0a0907] border border-[#1f1a13] rounded-xl py-3 pl-10 pr-4 text-[10px] font-bold uppercase tracking-widest text-[#E8DCC8] placeholder-[#2d2620] focus:outline-none focus:border-[#D4BFA0] transition-all"
          />
          <Plus size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#2d2620] group-focus-within:text-[#D4BFA0] transition-colors" />
        </div>
      </form>
    </div>
  );
}
