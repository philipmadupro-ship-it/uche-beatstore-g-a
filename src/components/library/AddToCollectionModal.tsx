'use client';

import { useMemo, useState } from 'react';
import { FolderPlus, ListMusic } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Dropdown } from '@/components/ui/Dropdown';
import type { CollectTarget, CollectionKind } from '@/lib/library/collect-selection';
import { cn } from '@/lib/utils';

interface NamedRow { id: string; name: string }

interface Props {
  /** Which tab opens first — the batch bar has a button for each. */
  initialKind: CollectionKind;
  count: number;
  playlists: readonly NamedRow[];
  projects: readonly NamedRow[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (target: CollectTarget) => void;
}

const NEW = '__new__';

/**
 * "Put the selected tracks somewhere": a new playlist or project, or an existing
 * one. Presentational — the request sequence is `addTracksToCollection`.
 */
export function AddToCollectionModal({ initialKind, count, playlists, projects, busy, onClose, onSubmit }: Props) {
  const [kind, setKind] = useState<CollectionKind>(initialKind);
  const [destination, setDestination] = useState<string>(NEW);
  const [name, setName] = useState('');

  const rows = kind === 'playlist' ? playlists : projects;
  const options = useMemo(
    () => [
      { value: NEW, label: kind === 'playlist' ? 'New playlist' : 'New project' },
      ...rows.map((r) => ({ value: r.id, label: r.name || 'Untitled', separator: r === rows[0] })),
    ],
    [kind, rows],
  );
  // Switching tab must drop a destination that belongs to the other list.
  const selected = destination !== NEW && rows.some((r) => r.id === destination) ? destination : NEW;
  const creating = selected === NEW;
  const noun = kind === 'playlist' ? 'playlist' : 'project';
  const plural = `${count} track${count === 1 ? '' : 's'}`;

  const submit = () => onSubmit({ kind, existingId: creating ? null : selected, name });

  return (
    <Modal
      onClose={() => { if (!busy) onClose(); }}
      title={creating ? `New ${noun} from ${plural}` : `Add ${plural} to a ${noun}`}
      description="Tracks already in it are skipped. Nothing is listed in the store."
      icon={kind === 'playlist' ? <ListMusic size={16} aria-hidden="true" /> : <FolderPlus size={16} aria-hidden="true" />}
      size="sm"
      footer={(
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={submit} loading={busy} disabled={busy}>
            {creating ? `Create ${noun}` : `Add to ${noun}`}
          </Button>
        </div>
      )}
    >
      <div className="space-y-4">
        <div role="group" aria-label="Destination type" className="flex rounded-lg border border-white/10 p-0.5">
          {(['playlist', 'project'] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={kind === k}
              onClick={() => setKind(k)}
              className={cn(
                'h-8 flex-1 rounded-md px-3 text-[11px] font-medium capitalize transition-colors',
                kind === k ? 'bg-white/[0.14] text-white' : 'text-white/50 hover:text-white/80',
              )}
            >{k}</button>
          ))}
        </div>

        <div>
          <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">Destination</p>
          <Dropdown
            value={selected}
            onChange={setDestination}
            options={options}
            aria-label={`Choose a ${noun}`}
            className="w-full"
          />
        </div>

        {creating && (
          <div>
            <label htmlFor="collection-name" className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">
              Name <span className="normal-case tracking-normal text-white/30">(optional)</span>
            </label>
            <input
              id="collection-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !busy) submit(); }}
              maxLength={120}
              placeholder={`Leave blank to name it automatically`}
              className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2.5 text-[13px] text-white placeholder:text-white/30 focus:border-white/30 focus:outline-none"
            />
          </div>
        )}
      </div>
    </Modal>
  );
}
