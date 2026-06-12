'use client';

import { useEffect, useState } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import { Track } from '@/lib/types';
import { toast } from '@/hooks/useToast';

interface Props {
  track: Track;
  /** Called optimistically before the PATCH lands so the drawer's
   *  optimistic overlay can absorb the new notes value. */
  onOptimistic: (notes: string) => void;
  /** Called on rollback when the PATCH fails. */
  onRollback: () => void;
  /** Refetch hook for the parent after a successful save. */
  onSaved?: () => void;
}

/**
 * Private-notes textarea — extracted from TrackDetailsDrawer.
 *
 * Owns its own draft state (so typing doesn't refire the parent's
 * render tree on every keystroke) and saves on blur with the same
 * optimistic-+-rollback pattern the drawer's `patchTrack` uses. The
 * parent passes hooks for both, so the drawer can keep its single
 * source of truth for the overlay.
 */
export function TrackNotesEditor({ track, onOptimistic, onRollback, onSaved }: Props) {
  const [notes, setNotes] = useState(track.notes || '');
  const [isSaving, setIsSaving] = useState(false);

  // When the parent swaps tracks (or refetches and supplies new notes),
  // re-seed the draft. Local edits in flight are abandoned — same
  // behavior as the pre-extraction version.
  useEffect(() => {
    setNotes(track.notes || '');
  }, [track.id, track.notes]);

  const saveNotes = async () => {
    if (notes === (track.notes || '')) return;
    setIsSaving(true);
    onOptimistic(notes);
    try {
      const res = await fetch(`/api/tracks/${track.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes }),
      });
      if (!res.ok) {
        onRollback();
        toast.error('Save notes failed');
        return;
      }
      onSaved?.();
    } catch (err: unknown) {
      onRollback();
      toast.error('Save notes failed', err instanceof Error ? err.message : undefined);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="p-8 border-b border-[#2B2821] space-y-6">
      <div className="flex items-center gap-2 mb-2">
        <FileText size={16} className="text-[#E7D7BE]" />
        <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-white">Private Notes</h3>
      </div>
      <div className="relative group">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={saveNotes}
          className="w-full bg-[#090907] border border-[#2B2821] rounded-xl p-4 text-[11px] text-[#F7EBDD] placeholder:text-[#3B372F] focus:outline-none focus:border-[#E7D7BE] transition-all h-32 resize-none font-medium leading-relaxed"
          placeholder="ADD PRODUCTION NOTES, COLLABORATORS, OR MIX VERSION DETAILS..."
        />
        {isSaving && (
          <div className="absolute top-3 right-3 flex items-center gap-2 px-2 py-1 bg-[#342F27] rounded-md border border-[#E7D7BE]/20 animate-in fade-in">
            <Loader2 size={10} className="animate-spin text-[#E7D7BE]" />
            <span className="text-[8px] font-bold text-[#E7D7BE] uppercase tracking-widest">Saving</span>
          </div>
        )}
      </div>
    </div>
  );
}
