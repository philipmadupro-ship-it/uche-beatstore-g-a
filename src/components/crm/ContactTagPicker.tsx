'use client';
import { useState } from 'react';
import { useContactTags } from '@/hooks/useContactTags';
import { Plus } from 'lucide-react';

/**
 * Tag picker for a contact. CRM tags are free-form (cities, vibes, deal status),
 * so this is a flat custom-entry input plus a few common starter suggestions —
 * not the fixed track taxonomy. onChanged lets the parent refresh its list.
 */
const SUGGESTIONS = ['vip', 'paid-before', 'needs-followup', 'hot-lead', 'collab', 'exclusive-buyer', 'local', 'cold'];

export function ContactTagPicker({ contactId, onChanged }: { contactId: string; onChanged?: () => void }) {
  const { tags, toggleTag } = useContactTags(contactId);
  const [custom, setCustom] = useState('');

  const add = (tag: string) => {
    const t = tag.trim().toLowerCase();
    if (!t || tags.includes(t)) return;
    toggleTag.mutate({ tag: t, category: 'custom', active: false }, { onSuccess: () => onChanged?.() });
  };
  const remove = (tag: string) => toggleTag.mutate({ tag, category: 'custom', active: true }, { onSuccess: () => onChanged?.() });

  return (
    <div className="space-y-3">
      {/* Current tags */}
      <div className="flex flex-wrap gap-1.5">
        {tags.length === 0 && <span className="text-[11px] text-white/40 italic">No tags yet</span>}
        {tags.map((tag) => (
          <button key={tag} onClick={() => remove(tag)}
            className="group flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-medium bg-white/10 border border-white/30 text-white hover:border-red-400/40 transition-colors">
            {tag}
            <span className="text-white/60 group-hover:text-red-400">×</span>
          </button>
        ))}
      </div>

      {/* Add custom */}
      <form onSubmit={(e) => { e.preventDefault(); add(custom); setCustom(''); }} className="relative">
        <Plus size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
        <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Add a tag…"
          className="w-full bg-[#090907] border border-white/20 rounded-lg pl-8 pr-3 py-2 text-[12px] text-white placeholder:text-white/40 focus:outline-none focus:border-white/40" />
      </form>

      {/* Starter suggestions */}
      <div className="flex flex-wrap gap-1">
        {SUGGESTIONS.filter((s) => !tags.includes(s)).map((s) => (
          <button key={s} onClick={() => add(s)}
            className="px-2 py-0.5 rounded-full text-[10px] font-medium border border-dashed border-white/20 text-white/40 hover:text-white/80 hover:border-white/40 transition-colors">
            + {s}
          </button>
        ))}
      </div>
    </div>
  );
}
