'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, Settings2, X } from 'lucide-react';
import { Popover } from '@/components/ui/Popover';
import { TAG_TAXONOMY } from '@/lib/types/tags';
import { useUploadPreset } from '@/lib/upload/preset-store';
import { UPLOAD_STATUS_OPTIONS, presetCount } from '@/lib/upload/preset';
import type { CollectionKind } from '@/lib/library/collect-selection';
import type { TrackType } from '@/lib/types';
import { cn } from '@/lib/utils';

export const UPLOAD_TYPE_OPTIONS: { value: TrackType; label: string }[] = [
  { value: 'beat',         label: 'Beat' },
  { value: 'instrumental', label: 'Instrumental' },
  { value: 'song',         label: 'Song' },
  { value: 'remix',        label: 'Remix' },
  { value: 'loop',         label: 'Loop' },
  { value: 'topline',      label: 'Topline' },
];

const TAG_GROUPS: Array<{ category: keyof typeof TAG_TAXONOMY; label: string }> = [
  { category: 'status',      label: 'Status' },
  { category: 'genre',       label: 'Genre' },
  { category: 'mood',        label: 'Mood' },
  { category: 'instruments', label: 'Instruments' },
];

interface NamedRow { id: string; name: string }

const chip = (on: boolean) => cn(
  'tap min-h-8 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
  on
    ? 'border-white/30 bg-white/[0.14] text-white'
    : 'border-white/10 bg-white/[0.04] text-white/60 hover:border-white/20 hover:text-white/80',
);

function Label({ children }: { children: React.ReactNode }) {
  return <p className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.2em] text-white/40">{children}</p>;
}

/**
 * "Upload options" — everything to decide before the files go up: type, state,
 * tags and which project or playlist the new tracks join. Read by `DropZone`
 * through `useUploadPreset`; nothing here sends a request by itself.
 *
 * A Popover, not a modal, and NO `Dropdown` inside it: a Dropdown portals to
 * <body>, which a Popover counts as an outside click (the panel closed under the
 * user's hand — see CLAUDE.md, credits strip). The destination list is plain
 * buttons for that reason.
 */
export function UploadOptions({ className }: { className?: string }) {
  const { type, status, tags, destination, setType, setStatus, toggleTag, reset } = useUploadPreset();
  const count = presetCount({ status, tags, destination });

  return (
    <Popover
      width={320}
      trigger={({ open, toggle, ref }) => (
        <button
          ref={ref as (el: HTMLButtonElement | null) => void}
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-haspopup="true"
          className={cn(
            'tap inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-medium backdrop-blur-md transition-colors',
            open || count > 0
              ? 'border-white/25 bg-white/[0.13] text-white'
              : 'border-white/10 bg-white/[0.04] text-white/60 hover:border-white/20 hover:text-white/80',
            className,
          )}
        >
          <Settings2 size={12} aria-hidden />
          Upload options
          {count > 0 && (
            <span className="grid size-4 place-items-center rounded-full bg-white/20 text-[9px] font-bold tabular-nums text-white">{count}</span>
          )}
          <ChevronDown size={11} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
        </button>
      )}
    >
      <div className="max-h-[min(70vh,520px)] space-y-4 overflow-y-auto p-3">
        <p className="text-[11px] leading-snug text-white/50">
          Applied to every file you upload next, the moment it finishes.
        </p>

        <div>
          <Label>Upload as</Label>
          <div className="flex flex-wrap gap-1.5">
            {UPLOAD_TYPE_OPTIONS.map((o) => (
              <button key={o.value} type="button" aria-pressed={type === o.value} onClick={() => setType(o.value)} className={chip(type === o.value)}>
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <Label>State</Label>
          <div className="flex flex-wrap gap-1.5">
            {UPLOAD_STATUS_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                aria-pressed={status === o.value}
                onClick={() => setStatus(status === o.value ? null : o.value)}
                className={chip(status === o.value)}
              >{o.label}</button>
            ))}
          </div>
        </div>

        {TAG_GROUPS.map(({ category, label }) => (
          <div key={category}>
            <Label>{label} tags</Label>
            <div className="flex flex-wrap gap-1.5">
              {TAG_TAXONOMY[category].map((tag) => {
                const on = tags.some((t) => t.tag.toLowerCase() === tag.toLowerCase());
                return (
                  <button key={tag} type="button" aria-pressed={on} onClick={() => toggleTag({ tag, category })} className={chip(on)}>
                    {tag}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        <DestinationPicker />

        {count > 0 && (
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.2em] text-white/50 transition-colors hover:text-white"
          >
            <X size={10} aria-hidden /> Clear options
          </button>
        )}
      </div>
    </Popover>
  );
}

/** Add to an existing project or playlist. Lists load when the panel opens. */
function DestinationPicker() {
  const destination = useUploadPreset((s) => s.destination);
  const setDestination = useUploadPreset((s) => s.setDestination);
  const [kind, setKind] = useState<CollectionKind>(destination?.kind ?? 'project');
  const [rows, setRows] = useState<Record<CollectionKind, NamedRow[] | null>>({ project: null, playlist: null });
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (rows[kind] !== null) return;
    let cancelled = false;
    fetch(kind === 'project' ? '/api/projects' : '/api/playlists')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('failed'))))
      .then((d) => {
        if (cancelled) return;
        const list = (kind === 'project' ? d?.projects : d?.playlists) as NamedRow[] | undefined;
        setRows((prev) => ({ ...prev, [kind]: (list ?? []).map((x) => ({ id: x.id, name: x.name })) }));
        setFailed(false);
      })
      .catch(() => { if (!cancelled) { setFailed(true); setRows((prev) => ({ ...prev, [kind]: [] })); } });
    return () => { cancelled = true; };
  }, [kind, rows]);

  const list = rows[kind];
  return (
    <div>
      <Label>Add to</Label>
      <div role="group" aria-label="Destination type" className="mb-2 flex rounded-lg border border-white/10 p-0.5">
        {(['project', 'playlist'] as const).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={kind === k}
            onClick={() => setKind(k)}
            className={cn(
              'h-7 flex-1 rounded-md px-3 text-[11px] font-medium capitalize transition-colors',
              kind === k ? 'bg-white/[0.14] text-white' : 'text-white/50 hover:text-white/80',
            )}
          >{k}</button>
        ))}
      </div>
      {list === null ? (
        <p className="px-1 text-[11px] text-white/40">Loading…</p>
      ) : list.length === 0 ? (
        <p className="px-1 text-[11px] text-white/40">{failed ? 'Could not load your list.' : `No ${kind}s yet.`}</p>
      ) : (
        <div className="max-h-36 overflow-y-auto rounded-lg border border-white/10 p-1">
          {list.map((r) => {
            const on = destination?.kind === kind && destination.id === r.id;
            return (
              <button
                key={r.id}
                type="button"
                aria-pressed={on}
                onClick={() => setDestination(on ? null : { kind, id: r.id, name: r.name || 'Untitled' })}
                className={cn(
                  'flex min-h-8 w-full items-center justify-between gap-2 rounded-md px-2.5 text-left text-[11px] transition-colors',
                  on ? 'bg-white/[0.12] text-white' : 'text-white/70 hover:bg-white/[0.06] hover:text-white',
                )}
              >
                <span className="truncate">{r.name || 'Untitled'}</span>
                {on && <span aria-hidden className="text-[10px] text-white/60">✓</span>}
              </button>
            );
          })}
        </div>
      )}
      {destination && (
        <p className="mt-1.5 px-1 text-[10px] text-white/50">
          New tracks join {destination.kind} “{destination.name}”.
        </p>
      )}
    </div>
  );
}
