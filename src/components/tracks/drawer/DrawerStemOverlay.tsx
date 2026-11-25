'use client';

import { X, Scissors, TriangleAlert } from 'lucide-react';
import { StemPlayer } from '@/components/stems/StemPlayer';
import { useDialogBehavior } from '@/hooks/useDialogBehavior';

interface StemData {
  vocals_url: string;
  drums_url: string;
  bass_url: string;
  other_url: string;
}

interface Props {
  /** When false, the overlay isn't rendered at all (no z-index reservation). */
  open: boolean;
  /** queued / processing show the waiting state, failed the error and Retry, ready the mixer.
   *  The status is the server's (the stem pipeline owns the job), not the drawer's guess. */
  status: 'idle' | 'queued' | 'processing' | 'ready' | 'failed';
  /** Why the job failed (shown with Retry). */
  error?: string | null;
  onRetry?: () => void;
  /** Final URLs from the completed stem job. Required when status === 'ready'. */
  data: StemData | null;
  onClose: () => void;
}

/**
 * Full-screen stem player overlay — extracted from TrackDetailsDrawer.
 *
 * The drawer owns the lifecycle (job submission, polling, status state);
 * this component is purely presentational. Clean separation lets the
 * drawer file shrink and lets us style the overlay without touching
 * the drawer's state plumbing.
 */
export function DrawerStemOverlay({ open, status, error, onRetry, data, onClose }: Props) {
  const panelRef = useDialogBehavior({ open, onClose });

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label="Neural stem extraction"
      tabIndex={-1}
 className="fixed inset-0 bg-black/95 z-[60] flex items-center justify-center p-4 sm:p-12 backdrop-blur-xl ui-fade-in duration-500 focus:outline-none"
    >
      <div className="w-full max-w-5xl">
        <div className="flex justify-between items-center gap-3 mb-8 px-0 sm:px-4">
          <div>
            <h2 className="text-2xl sm:text-4xl font-black text-white uppercase tracking-tighter leading-none mb-2">
              Neural stem extraction
            </h2>
            <p className="text-white/80 text-[10px] font-bold uppercase tracking-[0.4em]">
              Multi-channel isolated signal routing
            </p>
          </div>
          <button
            onClick={onClose}
            className="bg-[#0D0D0A] border border-white/10 hover:border-red-500/50 hover:text-red-500 p-3 sm:p-4 shrink-0 rounded-2xl text-white/40 transition-all transform hover:rotate-90"
          >
            <X size={28} />
          </button>
        </div>

        {status === 'queued' || status === 'processing' ? (
          <div className="bg-[#0D0D0A] border border-white/10 rounded-[2rem] sm:rounded-[3rem] p-10 sm:p-32 flex flex-col items-center justify-center gap-8 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.7)]">
            <div className="relative">
              <div className="w-24 h-24 border-4 border-white/20 border-t-white rounded-full animate-spin" />
              <Scissors className="absolute inset-0 m-auto text-white" size={32} />
            </div>
            <div className="text-center" role="status" aria-live="polite">
              <p className="text-xl font-black text-white uppercase tracking-widest mb-2">
                {status === 'queued' ? 'Queued' : 'Splitting stems'}
              </p>
              <p className="text-[10px] font-bold text-white/40 uppercase tracking-[0.3em]">
                {status === 'queued'
                  ? 'Waiting for the separation service — you can close this'
                  : 'This runs in the background — you can close this and come back'}
              </p>
            </div>
          </div>
        ) : status === 'failed' ? (
          <div className="bg-[#0D0D0A] border border-white/10 rounded-[2rem] sm:rounded-[3rem] p-10 sm:p-24 flex flex-col items-center justify-center gap-6 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.7)]">
            <TriangleAlert className="text-[#ff8b73]" size={40} />
            <div className="text-center max-w-md" role="alert">
              <p className="text-xl font-black text-white uppercase tracking-widest mb-2">Stem split failed</p>
              <p className="text-[11px] text-white/60 leading-relaxed">{error || 'Stem separation failed.'}</p>
            </div>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="px-6 py-3 rounded-lg bg-white/[0.06] border border-white/10 hover:bg-white/[0.10] hover:border-white/20 text-white/80 text-[10px] font-mono uppercase tracking-[0.2em] transition-colors"
              >
                Retry split
              </button>
            )}
          </div>
        ) : data ? (
 <div className="ui-modal-panel duration-700">
            <StemPlayer
              vocalsUrl={data.vocals_url}
              drumsUrl={data.drums_url}
              bassUrl={data.bass_url}
              otherUrl={data.other_url}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
