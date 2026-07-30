'use client';

import { X, Scissors } from 'lucide-react';
import { StemPlayer } from '@/components/stems/StemPlayer';

interface StemData {
  vocals_url: string;
  drums_url: string;
  bass_url: string;
  other_url: string;
}

interface Props {
  /** When false, the overlay isn't rendered at all (no z-index reservation). */
  open: boolean;
  /** 'processing' shows the loading state; 'ready' shows the mixer. */
  status: 'idle' | 'processing' | 'ready';
  /** 0–100. The poll loop normalizes both Demucs's 0..1 and the Moises
   *  synthetic milestones into this range. */
  progress: number;
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
export function DrawerStemOverlay({ open, status, progress, data, onClose }: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/95 z-[60] flex items-center justify-center p-12 backdrop-blur-xl animate-in fade-in duration-500">
      <div className="w-full max-w-5xl">
        <div className="flex justify-between items-center mb-8 px-4">
          <div>
            <h2 className="text-4xl font-black text-white uppercase tracking-tighter leading-none mb-2">
              Neural stem extraction
            </h2>
            <p className="text-white/80 text-[10px] font-bold uppercase tracking-[0.4em]">
              Multi-channel isolated signal routing
            </p>
          </div>
          <button
            onClick={onClose}
            className="bg-[#0D0D0A] border border-white/10 hover:border-red-500/50 hover:text-red-500 p-4 rounded-2xl text-white/40 transition-all transform hover:rotate-90"
          >
            <X size={28} />
          </button>
        </div>

        {status === 'processing' ? (
          <div className="bg-[#0D0D0A] border border-white/10 rounded-[3rem] p-32 flex flex-col items-center justify-center gap-8 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.7)]">
            <div className="relative">
              <div className="w-24 h-24 border-4 border-white/20 border-t-white rounded-full animate-spin" />
              <Scissors className="absolute inset-0 m-auto text-white animate-pulse" size={32} />
            </div>
            <div className="text-center">
              {progress === 0 ? (
                <>
                  <p className="text-xl font-black text-white uppercase tracking-widest mb-2 animate-pulse">Loading neural model</p>
                  <p className="text-[10px] font-bold text-white/40 uppercase tracking-[0.3em]">First run warms the GPU — this can take ~30 seconds</p>
                </>
              ) : (
                <>
                  <p className="text-xl font-black text-white uppercase tracking-widest mb-2 animate-pulse">Decompressing audio matrix</p>
                  <p className="text-[10px] font-bold text-white/40 uppercase tracking-[0.3em]">AI Stem Splitting in Progress — {progress}%</p>
                </>
              )}
              <div className="mt-4 w-64 mx-auto h-1 bg-white/[0.05] rounded-full overflow-hidden">
                <div
                  className={`h-full bg-white transition-all duration-500 ${progress === 0 ? 'animate-pulse' : ''}`}
                  style={{ width: `${progress === 0 ? 8 : progress}%` }}
                />
              </div>
            </div>
          </div>
        ) : data ? (
          <div className="animate-in zoom-in-95 duration-700">
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
