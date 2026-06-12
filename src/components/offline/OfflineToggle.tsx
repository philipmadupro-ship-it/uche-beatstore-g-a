'use client';

import { Download, CheckCircle2, Loader2, Trash2, AlertTriangle } from 'lucide-react';
import { useOfflineTrack } from '@/hooks/useOfflineCache';

interface Props {
  trackId: string;
  audioUrl: string;
  title: string;
  variant?: 'button' | 'compact';
}

function formatMB(bytes: number) {
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

/**
 * Toggle button for caching a single track for offline playback.
 * Renders different states: idle / downloading (with %) / cached / error.
 */
export function OfflineToggle({ trackId, audioUrl, title, variant = 'button' }: Props) {
  const { meta, isCached, downloading, progress, error, download, remove } = useOfflineTrack(trackId);

  if (variant === 'compact') {
    if (downloading) {
      return (
        <div className="inline-flex items-center gap-1.5 text-[10px] text-[#F3E6D1] font-mono">
          <Loader2 size={10} className="animate-spin" />
          {Math.round(progress * 100)}%
        </div>
      );
    }
    if (isCached) {
      return (
        <button
          onClick={remove}
          title={`Cached offline · ${meta ? formatMB(meta.size) : ''}`}
          className="inline-flex items-center gap-1 text-[10px] text-[#6DC6A4] hover:text-red-400 font-mono"
        >
          <CheckCircle2 size={10} />
        </button>
      );
    }
    return (
      <button
        onClick={() => download(audioUrl, title)}
        title="Save offline"
        className="inline-flex items-center gap-1 text-[10px] text-[#9B9282] hover:text-[#F3E6D1]"
      >
        <Download size={10} />
      </button>
    );
  }

  if (downloading) {
    return (
      <button
        disabled
        className="flex items-center gap-2 px-3 py-2 rounded-md border border-[#211F1A] bg-[#171511] text-[#F3E6D1] text-[11px] font-medium"
      >
        <Loader2 size={11} className="animate-spin" />
        Caching… {Math.round(progress * 100)}%
      </button>
    );
  }

  if (isCached) {
    return (
      <button
        onClick={remove}
        className="flex items-center gap-2 px-3 py-2 rounded-md border border-[#6DC6A4]/30 bg-[#0e1f17] text-[#6DC6A4] hover:bg-red-950/30 hover:text-red-400 hover:border-red-900/50 text-[11px] font-medium transition-colors"
      >
        <CheckCircle2 size={11} className="group-hover:hidden" />
        <span>Offline {meta && `· ${formatMB(meta.size)}`}</span>
        <Trash2 size={11} className="opacity-0 group-hover:opacity-100" />
      </button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={() => download(audioUrl, title)}
        className="flex items-center gap-2 px-3 py-2 rounded-md border border-[#211F1A] bg-[#171511] text-[#D0C3AF] hover:text-white hover:bg-[#211F1A] text-[11px] font-medium transition-colors"
      >
        <Download size={11} />
        Save offline
      </button>
      {error && (
        <div className="flex items-center gap-1 text-[10px] text-red-400">
          <AlertTriangle size={9} />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
