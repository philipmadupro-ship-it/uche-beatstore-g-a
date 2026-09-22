'use client';

/**
 * Saved covers.
 *
 * Before this existed, reloading the page threw away everything — there was no
 * save of any kind. Covers autosave as you work; this panel is how you get back
 * to one, start another, or clear one out.
 */

import { FilePlus2, Copy, Trash2, HardDrive } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CoverDocumentSummary } from '@/lib/cover/document-store';
import { PanelSection, StudioButton } from './StudioControls';

/** Bytes as something a person reads at a glance. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Relative time, coarse on purpose — an exact clock is noise in a file list. */
export function formatRelativeTime(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function DocumentsPanel({
  documents, activeId, onNew, onOpen, onDuplicate, onDelete,
}: {
  documents: CoverDocumentSummary[];
  activeId: string;
  onNew: () => void;
  onOpen: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const totalBytes = documents.reduce((sum, item) => sum + item.bytes, 0);

  return (
    <PanelSection title="Saved covers">
      <StudioButton variant="accent" onClick={onNew} className="w-full">
        <FilePlus2 size={13} /> New cover
      </StudioButton>

      {documents.length === 0 ? (
        <p className="text-[11px] leading-relaxed text-white/40">
          Nothing saved yet. Your work saves itself as you go.
        </p>
      ) : null}

      <ul className="grid gap-1">
        {documents.map((item) => {
          const active = item.id === activeId;
          return (
            <li
              key={item.id}
              className={cn(
                'group relative border transition-colors',
                active ? 'border-white/40 bg-white/[0.08]' : 'border-white/10 hover:border-white/20',
              )}
            >
              <button
                type="button"
                onClick={() => onOpen(item.id)}
                aria-current={active}
                className="block w-full p-2 pr-14 text-left"
              >
                <span className="block truncate text-[11px] text-white/90">{item.name}</span>
                <span className="block truncate font-mono text-[10px] uppercase tracking-[0.12em] text-white/40">
                  {formatRelativeTime(item.updatedAt)} · {item.layerCount} layers
                  {item.imageCount > 0 ? ` · ${item.imageCount} img` : ''}
                </span>
              </button>
              <span className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                <button
                  type="button"
                  title={`Duplicate ${item.name}`}
                  aria-label={`Duplicate ${item.name}`}
                  onClick={() => onDuplicate(item.id)}
                  className="grid h-6 w-6 place-items-center text-white/40 transition-colors hover:text-white/90"
                >
                  <Copy size={12} />
                </button>
                <button
                  type="button"
                  title={`Delete ${item.name}`}
                  aria-label={`Delete ${item.name}`}
                  onClick={() => onDelete(item.id)}
                  className="grid h-6 w-6 place-items-center text-white/40 transition-colors hover:text-white/90"
                >
                  <Trash2 size={12} />
                </button>
              </span>
            </li>
          );
        })}
      </ul>

      {documents.length > 0 ? (
        <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-white/40">
          <HardDrive size={11} /> {documents.length} saved · {formatBytes(totalBytes)}
        </p>
      ) : null}
    </PanelSection>
  );
}
