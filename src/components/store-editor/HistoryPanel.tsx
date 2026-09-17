'use client';

/**
 * Saved versions of the storefront layout.
 *
 * Undo/redo answers "take back what I just did". This answers "put it back the
 * way it was this morning" — a different question, and the only one that
 * survives closing the tab.
 *
 * Restoring is deliberately NOT destructive: it drops the old layout onto the
 * undo stack like any other edit, so a restore you did not mean is one ⌘Z
 * away. A "are you sure" dialog would be the wrong shape here — the safety
 * belongs in the operation being reversible, not in a modal asking you to
 * promise you meant it.
 */

import { useEffect, useState } from 'react';
import { History, RotateCcw, Trash2 } from 'lucide-react';
import {
  deleteSnapshot, formatSnapshotAge, listSnapshots, loadSnapshot,
  type SnapshotSummary,
} from '@/lib/store-editor/history';
import type { StoreLayout } from '@/lib/store-editor/layout';
import { toast } from '@/hooks/useToast';
import { cn } from '@/lib/utils';

export function HistoryPanel({ refreshKey, onRestore }: {
  /** Bumped by the builder after a save, so the list picks up new snapshots. */
  refreshKey: number;
  onRestore: (layout: StoreLayout) => void;
}) {
  const [snapshots, setSnapshots] = useState<SnapshotSummary[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listSnapshots()
      .then((items) => {
        if (cancelled) return;
        setSnapshots(items);
        setState('ready');
      })
      .catch(() => {
        // IndexedDB is unavailable in private mode in some browsers. History
        // is an aid, so it degrades to "not available" rather than breaking
        // the builder around it.
        if (!cancelled) setState('failed');
      });
    return () => { cancelled = true; };
  }, [refreshKey]);

  if (state === 'failed') {
    return (
      <div className="px-4 py-5">
        <p className="text-[11px] leading-relaxed text-white/40">
          Version history is unavailable in this browser. Your work still saves normally.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-0 overflow-y-auto">
      <div className="border-b border-white/10 px-3 py-2.5">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">
          Versions · {snapshots.length}
        </p>
        {/* Said once, plainly, rather than discovered later on another machine. */}
        <p className="mt-1 text-[10px] leading-relaxed text-white/30">
          Kept in this browser. They do not follow you to another device.
        </p>
      </div>

      {state === 'ready' && snapshots.length === 0 ? (
        <div className="px-4 py-5">
          <p className="flex items-center gap-2 text-[11px] leading-relaxed text-white/40">
            <History size={13} className="shrink-0 text-white/25" />
            No versions yet. One is kept each time you come back and change something.
          </p>
        </div>
      ) : null}

      <ul className="py-1">
        {snapshots.map((snapshot, index) => (
          <li
            key={snapshot.id}
            className="group flex items-center gap-2 px-3 py-2 transition-colors hover:bg-white/[0.03]"
          >
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2">
                <span className="text-[12px] text-white/80">
                  {formatSnapshotAge(snapshot.takenAt)}
                </span>
                {index === 0 ? (
                  <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#c8a47a]">
                    Latest
                  </span>
                ) : null}
              </span>
              <span className="mt-0.5 block truncate font-mono text-[9px] uppercase tracking-[0.14em] text-white/30">
                {snapshot.label}
              </span>
            </span>

            <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
              <button
                type="button"
                disabled={busyId === snapshot.id}
                title="Restore this version"
                aria-label={`Restore the version from ${formatSnapshotAge(snapshot.takenAt)}`}
                onClick={async () => {
                  setBusyId(snapshot.id);
                  try {
                    const layout = await loadSnapshot(snapshot.id);
                    if (!layout) {
                      toast.error('That version could not be read.');
                      return;
                    }
                    onRestore(layout);
                    toast.success('Version restored — undo if that was not what you wanted.');
                  } finally {
                    setBusyId(null);
                  }
                }}
                className={cn(
                  'grid size-6 place-items-center text-white/40 transition-colors',
                  'hover:text-white/90 disabled:cursor-wait disabled:text-white/20',
                )}
              >
                <RotateCcw size={12} />
              </button>
              <button
                type="button"
                title="Delete this version"
                aria-label={`Delete the version from ${formatSnapshotAge(snapshot.takenAt)}`}
                onClick={async () => {
                  await deleteSnapshot(snapshot.id);
                  setSnapshots((current) => current.filter((item) => item.id !== snapshot.id));
                }}
                className="grid size-6 place-items-center text-white/40 transition-colors hover:text-white/90"
              >
                <Trash2 size={12} />
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
