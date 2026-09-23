'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Upload, X, Pause, Play, RefreshCw, AlertTriangle, CheckCircle2,
  ChevronDown, ChevronUp, Loader2, FileAudio,
} from 'lucide-react';
import {
  useUploadManager,
  formatBytes, formatSpeed, formatEta,
  type UploadItem,
} from '@/lib/upload/manager';
import {
  uploadRowActions, isUploadActive, canEditUploadedTrack,
  type UploadRowAction,
} from '@/lib/upload/row-actions';
import { InlineText } from '@/components/ui/InlineText';
import { parseTitleMetadata, describeTitleMetadata } from '@/lib/upload/title-metadata';
import { InlineTagStrip, type TagGroup } from '@/components/ui/InlineTagStrip';
import { TAG_TAXONOMY } from '@/lib/types/tags';
import { useTags } from '@/hooks/useTags';
import { toast } from '@/hooks/useToast';

/** Shared track vocabulary, same order the drawer uses. */
const TRACK_TAG_GROUPS: TagGroup[] = Object.entries(TAG_TAXONOMY).map(([category, options]) => ({
  category,
  label: category,
  options: options as readonly string[],
}));

/**
 * Persistent tray of in-flight uploads. Mounted globally in the dashboard
 * layout so uploads survive page navigation. On reload, "interrupted" rows
 * surface a "Resume" button that re-prompts for the same file.
 */
export function UploadsTray() {
  const order = useUploadManager((s) => s.order);
  const uploads = useUploadManager((s) => s.uploads);
  const hydrate = useUploadManager((s) => s.hydrate);
  const clearFinished = useUploadManager((s) => s.clearFinished);
  const [expanded, setExpanded] = useState(true);

  // Hydrate persisted sessions once on mount
  useEffect(() => { hydrate(); }, [hydrate]);

  // Block accidental reload while uploads are running
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      const active = Object.values(uploads).some(
        (u) => u.status === 'uploading' || u.status === 'preparing' || u.status === 'finalizing'
      );
      if (active) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [uploads]);

  const items = useMemo(() => order.map((id) => uploads[id]).filter(Boolean), [order, uploads]);
  const visible = items.filter((u) => u.status !== 'aborted');

  if (visible.length === 0) return null;

  const active = visible.filter(
    (u) => u.status === 'uploading' || u.status === 'preparing' || u.status === 'finalizing' || u.status === 'queued'
  ).length;
  const errored = visible.filter((u) => u.status === 'error' || u.status === 'interrupted').length;
  const done = visible.filter((u) => u.status === 'success').length;

  return (
    <div className="fixed bottom-24 right-4 z-50 w-[360px] max-w-[calc(100vw-2rem)]">
      <div className="bg-[#090907] border border-white/10 rounded-lg shadow-[0_24px_60px_-12px_rgba(0,0,0,0.7)] overflow-hidden">
        <div className="flex items-center gap-1 border-b border-[#0D0D0A]">
          <button
            onClick={() => setExpanded((x) => !x)}
            className="tap flex-1 flex min-h-11 items-center gap-2 px-3 hover:bg-white/[0.04] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-black"
            aria-expanded={expanded}
            aria-label={expanded ? 'Collapse uploads tray' : 'Expand uploads tray'}
          >
            <Upload size={12} className="text-white" />
            <span className="text-[11px] font-medium text-white">
              Uploads
              <span className="text-white/40 font-normal ml-1.5">
                {active > 0 && `${active} running`}
                {active > 0 && (errored > 0 || done > 0) && ' · '}
                {errored > 0 && <span className="text-red-400">{errored} failed</span>}
                {errored > 0 && done > 0 && ' · '}
                {done > 0 && <span className="text-green-400">{done} done</span>}
              </span>
            </span>
            <div className="flex-1" />
            {expanded ? (
              <ChevronDown size={12} className="text-white/40" />
            ) : (
              <ChevronUp size={12} className="text-white/40" />
            )}
          </button>
          {errored + done > 0 && (
            <button
              type="button"
              onClick={clearFinished}
              className="tap grid size-11 shrink-0 place-items-center mr-1 rounded text-white/40 hover:text-white hover:bg-white/[0.05] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
              title="Clear finished uploads"
              aria-label="Clear finished uploads"
            >
              <X size={12} />
            </button>
          )}
        </div>

        {expanded && (
          <div className="max-h-[60vh] overflow-y-auto">
            {visible.map((u) => (
              <UploadRow key={u.id} u={u} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function UploadRow({ u }: { u: UploadItem }) {
  const pause = useUploadManager((s) => s.pause);
  const retry = useUploadManager((s) => s.retry);
  const abort = useUploadManager((s) => s.abort);
  const remove = useUploadManager((s) => s.remove);
  const resume = useUploadManager((s) => s.resume);
  const patch = useUploadManager((s) => s._patch);
  const fileRef = useRef<HTMLInputElement>(null);

  const pct = u.fileSize > 0 ? Math.min(100, (u.bytesUploaded / u.fileSize) * 100) : 0;
  const isActive = isUploadActive(u.status);
  const editable = canEditUploadedTrack(u);
  const trackId = (u.track?.id as string | undefined) ?? '';
  const trackTitle = (u.track?.title as string | undefined) ?? u.fileName.replace(/\.[^.]+$/, '');
  const filenameMeta = describeTitleMetadata(parseTitleMetadata(u.fileName));

  /**
   * Rename the track this row created.
   *
   * The tray is the only place the freshly-created row id is on screen, and it
   * is the moment the producer still knows what the file is. Before this, a
   * beat landed in the library under whatever the file was called —
   * `beat_final_v3_140.wav` — and fixing it meant finding it again later.
   */
  const renameUploadedTrack = async (next: string) => {
    if (!trackId) return false;
    try {
      const res = await fetch(`/api/tracks/${trackId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: next }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `HTTP ${res.status}`);
      }
      // Keep the tray's own copy in step so the row does not snap back to the
      // filename on the next store update.
      patch(u.id, { track: { ...(u.track ?? {}), title: next } });
      return true;
    } catch (err) {
      toast.error('Rename failed', err instanceof Error ? err.message : 'Try again');
      return false;
    }
  };

  const onResumePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) resume(u.id, f);
  };

  return (
    <div className="px-3 py-2.5 border-b border-[#24211B] last:border-b-0">
      {/* row 1: name + actions */}
      <div className="flex items-center gap-2 mb-1.5">
        <FileAudio size={11} className="text-white/40 shrink-0" />
        {editable ? (
          <InlineText
            label={`Title of ${trackTitle}`}
            value={trackTitle}
            onSave={renameUploadedTrack}
            maxLength={200}
            className="-mx-1 min-w-0 flex-1 px-1 text-[11px] text-white"
            inputClassName="text-[11px]"
          />
        ) : (
          <span className="text-[11px] text-white truncate flex-1" title={u.fileName}>
            {u.fileName}
          </span>
        )}
        <span className="text-[9px] font-mono text-white/40 shrink-0">
          {formatBytes(u.fileSize)}
        </span>
        <RowActions
          u={u}
          onPause={() => pause(u.id)}
          onRetry={() => retry(u.id)}
          onAbort={() => abort(u.id)}
          onRemove={() => remove(u.id)}
          onPickResume={() => fileRef.current?.click()}
        />
        <input
          ref={fileRef} type="file"
          aria-label={`Resume upload for ${u.fileName}`}
          accept=".csv,.mp3,.wav,.flac,.aiff,.aif,.m4a,.ogg"
          onChange={onResumePick}
          className="hidden"
        />
      </div>

      {/* row 2: progress bar */}
      <div className="h-1 bg-[#0D0D0A] rounded-full overflow-hidden mb-1.5">
        <div
          className={`h-full transition-all duration-200 ${
            u.status === 'success'
              ? 'bg-green-500'
              : u.status === 'error' || u.status === 'interrupted'
              ? 'bg-red-500'
              : u.status === 'paused'
              ? 'bg-white/80'
              : 'bg-gradient-to-r from-[#FFFFFF] to-[#C7B89D]'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* row 3: status line */}
      <div className="flex items-center gap-2 text-[10px] font-mono">
        <StatusBadge u={u} pct={pct} />
        <div className="flex-1" />
        {isActive && (
          <>
            <span className="text-white/60">{formatSpeed(u.speedBps)}</span>
            <span className="text-white/30">·</span>
            <span className="text-white/60">ETA {formatEta(u.etaSec)}</span>
          </>
        )}
        {u.status === 'paused' && (
          <span className="text-white/60">{Math.round(pct)}% · paused</span>
        )}
      </div>

      {/* What the filename said. Shown on success, so the producer can see the
          BPM and key were taken from the name rather than guessed — and spot
          it if the name lied. */}
      {u.status === 'success' && filenameMeta && (
        <p className="mt-1 text-[10px] text-white/40">{filenameMeta}</p>
      )}

      {/* error/info detail */}
      {u.error && u.status !== 'success' && (
        <p className="mt-1 text-[10px] text-red-400 flex items-start gap-1">
          <AlertTriangle size={9} className="mt-0.5 shrink-0" />
          <span className="break-words">{u.error}</span>
        </p>
      )}
      {u.status === 'interrupted' && !u.error && (
        <p className="mt-1 text-[10px] text-[#E2C16D]">
          Upload interrupted. Re-pick the same file to resume from {Math.round(pct)}%.
        </p>
      )}

      {/* Tag it while you still remember what it is. */}
      {editable && <UploadedTrackTags trackId={trackId} />}
    </div>
  );
}

/**
 * Tags for a just-uploaded track, in the tray.
 *
 * Split out because `useTags` must not run for rows that have no track id —
 * a hook cannot be called conditionally, so the condition lives on whether
 * this component is rendered at all.
 */
function UploadedTrackTags({ trackId }: { trackId: string }) {
  const { tags, toggleTag } = useTags(trackId);
  return (
    <div className="mt-2">
      <InlineTagStrip
        subject="track"
        tags={tags}
        groups={TRACK_TAG_GROUPS}
        emptyLabel="Tag it"
        onToggle={({ tag, category, active }) => toggleTag.mutate({ tag, category, active })}
      />
    </div>
  );
}

function StatusBadge({ u, pct }: { u: UploadItem; pct: number }) {
  switch (u.status) {
    case 'queued':
      return <span className="text-white/60">queued</span>;
    case 'preparing':
      return (
        <span className="text-white flex items-center gap-1">
          <Loader2 size={9} className="animate-spin" /> preparing
        </span>
      );
    case 'uploading':
      return (
        <span className="text-white">
          {Math.round(pct)}%
          {u.totalParts > 0 && (
            <span className="text-white/40 ml-1">
              · {u.completedPartNumbers.size}/{u.totalParts}
            </span>
          )}
        </span>
      );
    case 'finalizing':
      return (
        <span className="text-white flex items-center gap-1">
          <Loader2 size={9} className="animate-spin" /> finalizing · analyzing
        </span>
      );
    case 'success':
      return (
        <span className="text-green-400 flex items-center gap-1">
          <CheckCircle2 size={9} /> done
        </span>
      );
    case 'error':
      return (
        <span className="text-red-400 flex items-center gap-1">
          <AlertTriangle size={9} /> failed
        </span>
      );
    case 'interrupted':
      return <span className="text-[#E2C16D]">interrupted</span>;
    case 'paused':
      return <span className="text-white/80">paused</span>;
    default:
      return null;
  }
}

function RowActions({
  u, onPause, onRetry, onAbort, onRemove, onPickResume,
}: {
  u: UploadItem;
  onPause: () => void;
  onRetry: () => void;
  onAbort: () => void;
  onRemove: () => void;
  onPickResume: () => void;
}) {
  const btn = 'tap grid size-8 sm:size-7 place-items-center rounded text-white/60 hover:text-white hover:bg-white/[0.05] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-black';

  /* Which controls this row offers is decided by `uploadRowActions` from the
     status alone. It used to be five inline conditionals, one of which keyed
     off an `isActive` flag computed by the parent beside the status it came
     from — two sources for one fact. */
  const spec: Record<UploadRowAction, { icon: React.ReactNode; title: string; label: string; onClick: () => void; className?: string }> = {
    pause:   { icon: <Pause size={10} />, title: 'Pause', label: `Pause upload for ${u.fileName}`, onClick: onPause },
    resume:  { icon: <Play size={10} />, title: 'Resume', label: `Resume upload for ${u.fileName}`, onClick: onRetry },
    retry:   { icon: <RefreshCw size={10} />, title: 'Retry', label: `Retry upload for ${u.fileName}`, onClick: onRetry },
    repick:  { icon: <Upload size={10} />, title: 'Re-pick file to resume', label: `Choose original file to resume upload for ${u.fileName}`, onClick: onPickResume, className: 'text-[#E2C16D] hover:text-[#E2C16D]' },
    cancel:  { icon: <X size={10} />, title: 'Cancel', label: `Cancel upload for ${u.fileName}`, onClick: onAbort, className: 'hover:text-red-400' },
    dismiss: { icon: <X size={10} />, title: 'Dismiss', label: `Dismiss upload for ${u.fileName}`, onClick: onRemove },
  };

  return (
    <div className="flex items-center gap-0.5 shrink-0">
      {uploadRowActions(u.status).map((action) => {
        const a = spec[action];
        return (
          <button
            key={action}
            type="button"
            onClick={a.onClick}
            title={a.title}
            aria-label={a.label}
            className={`${btn} ${a.className ?? ''}`}
          >
            {a.icon}
          </button>
        );
      })}
    </div>
  );
}
