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

/**
 * Persistent tray of in-flight uploads. Mounted globally in the dashboard
 * layout so uploads survive page navigation. On reload, "interrupted" rows
 * surface a "Resume" button that re-prompts for the same file.
 */
export function UploadsTray() {
  const order = useUploadManager((s) => s.order);
  const uploads = useUploadManager((s) => s.uploads);
  const hydrate = useUploadManager((s) => s.hydrate);
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
      <div className="bg-[#090907] border border-[#211F1A] rounded-lg shadow-2xl overflow-hidden">
        <button
          onClick={() => setExpanded((x) => !x)}
          className="tap w-full flex min-h-11 items-center gap-2 px-3 border-b border-[#1A1813] hover:bg-[#171511] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[#090907]"
          aria-expanded={expanded}
          aria-label={expanded ? 'Collapse uploads tray' : 'Expand uploads tray'}
        >
          <Upload size={12} className="text-[#F3E6D1]" />
          <span className="text-[11px] font-medium text-white">
            Uploads
            <span className="text-[#9B9282] font-normal ml-1.5">
              {active > 0 && `${active} running`}
              {active > 0 && (errored > 0 || done > 0) && ' · '}
              {errored > 0 && <span className="text-red-400">{errored} failed</span>}
              {errored > 0 && done > 0 && ' · '}
              {done > 0 && <span className="text-green-400">{done} done</span>}
            </span>
          </span>
          <div className="flex-1" />
          {expanded ? (
            <ChevronDown size={12} className="text-[#9B9282]" />
          ) : (
            <ChevronUp size={12} className="text-[#9B9282]" />
          )}
        </button>

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
  const fileRef = useRef<HTMLInputElement>(null);

  const pct = u.fileSize > 0 ? Math.min(100, (u.bytesUploaded / u.fileSize) * 100) : 0;
  const isActive = u.status === 'uploading' || u.status === 'preparing' || u.status === 'finalizing';

  const onResumePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) resume(u.id, f);
  };

  return (
    <div className="px-3 py-2.5 border-b border-[#24211B] last:border-b-0">
      {/* row 1: name + actions */}
      <div className="flex items-center gap-2 mb-1.5">
        <FileAudio size={11} className="text-[#837B6D] shrink-0" />
        <span className="text-[11px] text-[#F7EBDD] truncate flex-1" title={u.fileName}>
          {u.fileName}
        </span>
        <span className="text-[9px] font-mono text-[#9B9282] shrink-0">
          {formatBytes(u.fileSize)}
        </span>
        <RowActions
          u={u}
          isActive={isActive}
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
      <div className="h-1 bg-[#1A1813] rounded-full overflow-hidden mb-1.5">
        <div
          className={`h-full transition-all duration-200 ${
            u.status === 'success'
              ? 'bg-green-500'
              : u.status === 'error' || u.status === 'interrupted'
              ? 'bg-red-500'
              : u.status === 'paused'
              ? 'bg-[#D0C3AF]'
              : 'bg-gradient-to-r from-[#E7D7BE] to-[#C9BCA8]'
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
            <span className="text-[#B4AA99]">{formatSpeed(u.speedBps)}</span>
            <span className="text-[#6E685B]">·</span>
            <span className="text-[#B4AA99]">ETA {formatEta(u.etaSec)}</span>
          </>
        )}
        {u.status === 'paused' && (
          <span className="text-[#B4AA99]">{Math.round(pct)}% · paused</span>
        )}
      </div>

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
    </div>
  );
}

function StatusBadge({ u, pct }: { u: UploadItem; pct: number }) {
  switch (u.status) {
    case 'queued':
      return <span className="text-[#B4AA99]">queued</span>;
    case 'preparing':
      return (
        <span className="text-[#F3E6D1] flex items-center gap-1">
          <Loader2 size={9} className="animate-spin" /> preparing
        </span>
      );
    case 'uploading':
      return (
        <span className="text-[#F3E6D1]">
          {Math.round(pct)}%
          {u.totalParts > 0 && (
            <span className="text-[#837B6D] ml-1">
              · {u.completedPartNumbers.size}/{u.totalParts}
            </span>
          )}
        </span>
      );
    case 'finalizing':
      return (
        <span className="text-[#F3E6D1] flex items-center gap-1">
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
      return <span className="text-[#D0C3AF]">paused</span>;
    default:
      return null;
  }
}

function RowActions({
  u, isActive, onPause, onRetry, onAbort, onRemove, onPickResume,
}: {
  u: UploadItem;
  isActive: boolean;
  onPause: () => void;
  onRetry: () => void;
  onAbort: () => void;
  onRemove: () => void;
  onPickResume: () => void;
}) {
  const btn = 'tap grid size-8 sm:size-7 place-items-center rounded text-[#B4AA99] hover:text-white hover:bg-[#211F1A] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[#090907]';
  return (
    <div className="flex items-center gap-0.5 shrink-0">
      {isActive && (
        <button onClick={onPause} className={btn} title="Pause" aria-label={`Pause upload for ${u.fileName}`}>
          <Pause size={10} />
        </button>
      )}
      {u.status === 'paused' && (
        <button onClick={onRetry} className={btn} title="Resume" aria-label={`Resume upload for ${u.fileName}`}>
          <Play size={10} />
        </button>
      )}
      {u.status === 'error' && (
        <button onClick={onRetry} className={btn} title="Retry" aria-label={`Retry upload for ${u.fileName}`}>
          <RefreshCw size={10} />
        </button>
      )}
      {u.status === 'interrupted' && (
        <button
          onClick={onPickResume}
          className={`${btn} text-[#E2C16D] hover:text-[#E2C16D]`}
          title="Re-pick file to resume"
          aria-label={`Choose original file to resume upload for ${u.fileName}`}
        >
          <Upload size={10} />
        </button>
      )}
      {(isActive || u.status === 'paused' || u.status === 'queued') && (
        <button onClick={onAbort} className={`${btn} hover:text-red-400`} title="Cancel" aria-label={`Cancel upload for ${u.fileName}`}>
          <X size={10} />
        </button>
      )}
      {(u.status === 'success' || u.status === 'error' || u.status === 'interrupted') && (
        <button onClick={onRemove} className={btn} title="Dismiss" aria-label={`Dismiss upload for ${u.fileName}`}>
          <X size={10} />
        </button>
      )}
    </div>
  );
}
