'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Sparkles, Users, X } from 'lucide-react';
import { Popover } from '@/components/ui/Popover';
import { toast } from '@/hooks/useToast';
import { errorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';
import {
  KNOWN_COLLABORATOR_ROLES,
  isAutoDerived,
  roleLabel,
  sortCollaborators,
  type TrackCollaborator,
} from '@/lib/tracks/collaborators';

interface Props {
  trackId: string;
  className?: string;
}

interface ApiErrorResponse {
  error?: string;
}

/**
 * Who's credited on this track — producer, features, collaborators.
 *
 * Same interaction shape as `ui/InlineTagStrip`: applied credits are pills
 * that remove in one click, adding opens a small popover. Not built on top
 * of InlineTagStrip itself, because a credit is a (name, role) pair rather
 * than a single string, but it deliberately does not hand-roll a menu for
 * anything beyond that — there is nothing here CLAUDE.md would call a menu.
 *
 * A credit pulled from the upload filename (source: 'filename') is
 * visually distinct from one the producer typed (source: 'manual') — a
 * small marker plus its own title text — because migration 115's whole
 * point is that a re-parse of the filename only ever replaces the former.
 * Deleting either kind is allowed here; only the automatic REPLACE-on-reparse
 * is scoped to 'filename' rows, and that logic lives in
 * lib/upload/collaborators.ts, not here.
 */
export function TrackCollaboratorStrip({ trackId, className }: Props) {
  const [collaborators, setCollaborators] = useState<TrackCollaborator[] | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [role, setRole] = useState<(typeof KNOWN_COLLABORATOR_ROLES)[number]>('collaborator');
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const fetchCollaborators = useCallback(async () => {
    try {
      const res = await fetch(`/api/tracks/${trackId}/collaborators`);
      if (!res.ok) {
        setCollaborators([]);
        return;
      }
      const data = await res.json();
      setCollaborators(Array.isArray(data) ? data : []);
    } catch {
      setCollaborators([]);
    }
  }, [trackId]);

  useEffect(() => {
    setCollaborators(null);
    fetchCollaborators();
  }, [fetchCollaborators]);

  const ordered = sortCollaborators(collaborators ?? []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    setSaving(true);
    try {
      const res = await fetch(`/api/tracks/${trackId}/collaborators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed, role }),
      });
      const json = await res.json().catch(() => ({})) as ApiErrorResponse & TrackCollaborator;
      if (!res.ok) {
        toast.error('Could not add credit', json.error || `HTTP ${res.status}`);
        return;
      }
      setCollaborators((c) => [...(c ?? []), json as TrackCollaborator]);
      setName('');
    } catch (err) {
      toast.error('Could not add credit', errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (id: string) => {
    setRemovingId(id);
    const prev = collaborators;
    setCollaborators((c) => (c ?? []).filter((row) => row.id !== id));
    try {
      const res = await fetch(`/api/tracks/${trackId}/collaborators`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as ApiErrorResponse;
        setCollaborators(prev);
        toast.error('Could not remove credit', json.error || `HTTP ${res.status}`);
      }
    } catch (err) {
      setCollaborators(prev);
      toast.error('Could not remove credit', errorMessage(err));
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      <Users size={11} className="shrink-0 text-white/30" />

      {ordered.map((c) => {
        const auto = isAutoDerived(c.source);
        return (
          <span
            key={c.id}
            title={auto ? 'Read from the uploaded filename' : 'Added by hand'}
            className="group/credit inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.06] py-1 pl-2.5 pr-1 text-[10px] font-medium text-white/70 transition-colors hover:border-white/20 hover:text-white"
          >
            {auto && <Sparkles size={9} className="shrink-0 text-white/40" aria-hidden="true" />}
            <span>{c.name}</span>
            <span className="text-white/30">· {roleLabel(c.role)}</span>
            {auto && <span className="sr-only">(from filename)</span>}
            <button
              type="button"
              onClick={() => handleRemove(c.id)}
              disabled={removingId === c.id}
              aria-label={`Remove credit for ${c.name}`}
              className="grid size-4 place-items-center rounded-full text-white/30 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
            >
              <X size={9} />
            </button>
          </span>
        );
      })}

      <Popover
        width={280}
        open={open}
        onOpenChange={setOpen}
        initialFocus
        label="Add a credit"
        trigger={({ open: isOpen, toggle: toggleOpen, ref }) => (
          <button
            type="button"
            ref={ref as (el: HTMLButtonElement | null) => void}
            onClick={toggleOpen}
            aria-label="Add a track credit"
            aria-expanded={isOpen}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-medium transition-colors',
              isOpen
                ? 'border-white/40 bg-white/10 text-white'
                : 'border-dashed border-white/15 text-white/40 hover:border-white/30 hover:text-white',
            )}
          >
            <Plus size={10} />
            {ordered.length === 0 ? 'Add credit' : 'Credit'}
          </button>
        )}
      >
        <form onSubmit={handleAdd} className="space-y-3 p-3">
          <div>
            <label htmlFor="collaborator-name" className="mb-1 block text-[9px] font-mono uppercase tracking-[0.2em] text-white/40">
              Name
            </label>
            <input
              id="collaborator-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Metro Boomin"
              maxLength={120}
              autoFocus
              className="w-full rounded-lg border border-white/10 bg-[#090907] px-3 py-2 text-[11px] text-white placeholder:text-white/30 focus:border-white/30 focus:outline-none"
            />
          </div>
          <div>
            <p className="mb-1 block text-[9px] font-mono uppercase tracking-[0.2em] text-white/40">Role</p>
            <div className="flex flex-wrap gap-1.5">
              {KNOWN_COLLABORATOR_ROLES.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRole(r)}
                  aria-pressed={role === r}
                  className={cn(
                    'rounded-lg border px-2.5 py-1 text-[10px] font-medium transition-colors',
                    role === r
                      ? 'border-white/40 bg-white/10 text-white'
                      : 'border-white/10 text-white/40 hover:border-white/20 hover:text-white/80',
                  )}
                >
                  {roleLabel(r)}
                </button>
              ))}
            </div>
          </div>
          <button
            type="submit"
            disabled={saving || !name.trim()}
            className="w-full rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.10] disabled:opacity-40"
          >
            {saving ? 'Adding…' : 'Add credit'}
          </button>
        </form>
      </Popover>
    </div>
  );
}
