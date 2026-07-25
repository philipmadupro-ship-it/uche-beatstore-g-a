'use client';

import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import { useDropzone, type FileRejection } from 'react-dropzone';
import { AlertTriangle, Upload, CheckCircle2, Loader2, FileAudio, X } from 'lucide-react';
import { analyzeAudio } from '@/lib/audio/analyze.client';
import { useUploadManager } from '@/lib/upload/manager';
import {
  readUploadTypeDraft,
  uploadFileExtension,
  uploadRejectionMessage,
  writeUploadTypeDraft,
} from '@/lib/upload/dropzone-draft';
import type { TrackType } from '@/lib/types';

interface DropZoneProps {
  playlistId?: string;
  onUploadSuccess?: () => void;
  defaultType?: TrackType;
}

const TYPE_PICKER: { value: TrackType; label: string }[] = [
  { value: 'beat',         label: 'Beat' },
  { value: 'instrumental', label: 'Instrumental' },
  { value: 'song',         label: 'Song' },
  { value: 'remix',        label: 'Remix' },
];

// Format badge colours — warm neutrals for the standard formats,
// slightly brighter for the lossless ones so the producer knows at
// a glance which files are high-quality.
const FORMAT_STYLE: Record<string, string> = {
  wav:  'text-[#8ecf9f] bg-[#0a1f0a]/60 border-[#1f3a1f]',
  flac: 'text-[#8ecf9f] bg-[#0a1f0a]/60 border-[#1f3a1f]',
  aiff: 'text-[#8ecf9f] bg-[#0a1f0a]/60 border-[#1f3a1f]',
  aif:  'text-[#8ecf9f] bg-[#0a1f0a]/60 border-[#1f3a1f]',
  mp3:  'text-[#D6BE7A] bg-[#1f1a0a]/60 border-[#3a2f1f]',
  m4a:  'text-[#D0C3AF] bg-[#211F1A]/60 border-[#3B372F]',
  ogg:  'text-[#D0C3AF] bg-[#211F1A]/60 border-[#3B372F]',
};

function fmtBytes(b: number): string {
  if (b >= 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024).toFixed(0)} KB`;
}

interface FileCard {
  id: string;
  file: File;
  ext: string;
  analyzing: boolean;
  queued: boolean;
  done: boolean;
  rejected?: boolean;
  error?: string;
  analysisError?: boolean;
  bpm?: number | null;
  key?: string | null;
  scale?: string | null;
}

export function DropZone({ playlistId, onUploadSuccess, defaultType = 'instrumental' }: DropZoneProps) {
  const enqueue = useUploadManager((s) => s.enqueue);
  const [selectedType, setSelectedType] = useState<TrackType>(() => readUploadTypeDraft(defaultType));
  const [cards, setCards] = useState<FileCard[]>([]);
  const mountedRef = useRef(false);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    };
  }, []);

  useEffect(() => {
    writeUploadTypeDraft(selectedType);
  }, [selectedType]);

  const safeSetCards = useCallback((next: SetStateAction<FileCard[]>) => {
    if (mountedRef.current) setCards(next);
  }, []);

  const onDrop = useCallback(async (accepted: File[], rejected: FileRejection[]) => {
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current);

    const rejectedCards: FileCard[] = rejected.map((item, i) => ({
      id: `rejected-${item.file.name}-${item.file.size}-${i}`,
      file: item.file,
      ext: uploadFileExtension(item.file.name),
      analyzing: false,
      queued: false,
      done: false,
      rejected: true,
      error: uploadRejectionMessage(item.errors),
    }));

    if (accepted.length === 0) {
      safeSetCards(rejectedCards);
      return;
    }

    // Populate cards immediately so the user sees their files right away.
    const initial: FileCard[] = accepted.map((f) => ({
      id: `accepted-${f.name}-${f.size}-${f.lastModified}`,
      file: f,
      ext: uploadFileExtension(f.name),
      analyzing: true,
      queued: false,
      done: false,
    }));
    const acceptedOffset = rejectedCards.length;
    safeSetCards([...rejectedCards, ...initial]);

    // Run analysis in parallel, update each card as its result lands.
    const analyses = await Promise.all(
      accepted.map(async (f, i) => {
        try {
          const result = await analyzeAudio(f);
          safeSetCards((prev) => prev.map((c, ci) =>
            ci === acceptedOffset + i
              ? { ...c, analyzing: false, bpm: result?.bpm ?? null, key: result?.key ?? null, scale: result?.scale ?? null }
              : c,
          ));
          return result;
        } catch {
          safeSetCards((prev) => prev.map((c, ci) =>
            ci === acceptedOffset + i ? { ...c, analyzing: false, analysisError: true } : c,
          ));
          return null;
        }
      }),
    );

    // Enqueue all files.
    accepted.forEach((file, i) => {
      enqueue(file, {
        type: selectedType,
        projectId: playlistId ?? null,
        analysis: analyses[i],
        onSuccess: () => {
          safeSetCards((prev) => prev.map((c, ci) => ci === acceptedOffset + i ? { ...c, done: true } : c));
          onUploadSuccess?.();
        },
      });
      safeSetCards((prev) => prev.map((c, ci) => ci === acceptedOffset + i ? { ...c, queued: true } : c));
    });

    // Clear successful/queued cards after a short beat; rejected files stay
    // visible until dismissed so the producer has time to act on the reason.
    clearTimerRef.current = setTimeout(() => {
      safeSetCards((prev) => prev.filter((card) => card.rejected && !card.done && !card.queued));
    }, 4000);
  }, [enqueue, playlistId, onUploadSuccess, safeSetCards, selectedType]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'audio/mpeg': ['.mp3'], 'audio/mp3': ['.mp3'],
      'audio/wav': ['.wav'], 'audio/wave': ['.wav'], 'audio/x-wav': ['.wav'],
      'audio/flac': ['.flac'], 'audio/x-flac': ['.flac'],
      'audio/aiff': ['.aiff', '.aif'], 'audio/x-aiff': ['.aiff', '.aif'],
      'audio/mp4': ['.m4a'], 'audio/x-m4a': ['.m4a'],
      'audio/ogg': ['.ogg'],
    },
    multiple: true,
    maxSize: 500 * 1024 * 1024,
  });

  const analyzing = cards.some((c) => c.analyzing);
  const uploadableCards = cards.filter((c) => !c.rejected);
  const rejectedCards = cards.filter((c) => c.rejected);
  const allQueued = uploadableCards.length > 0 && uploadableCards.every((c) => c.queued);
  const allDone = uploadableCards.length > 0 && uploadableCards.every((c) => c.done);

  return (
    <div className="space-y-3">
      {/* Type picker */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-mono uppercase tracking-widest text-[#837B6D] mr-1">Upload as</span>
        {TYPE_PICKER.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={(e) => { e.stopPropagation(); setSelectedType(opt.value); }}
            className={`tap min-h-11 rounded-lg border px-3 py-2 font-mono text-[10px] uppercase tracking-wider transition-[background-color,border-color,color,transform] ${
              selectedType === opt.value
                ? 'bg-[#342F27] border-[#C9BCA8]/50 text-[#F3E6D1]'
                : 'bg-[#171511] border-[#211F1A] text-[#B4AA99] hover:text-[#F7EBDD] hover:border-[#3B372F]'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <p id="upload-dropzone-help" className="sr-only">
        Upload WAV, FLAC, AIFF, MP3, M4A, or OGG audio files up to 500 MB.
      </p>

      {/* Drop zone */}
      <div
        {...getRootProps()}
        aria-describedby="upload-dropzone-help upload-dropzone-status"
        className={`
          relative overflow-hidden group cursor-pointer
          border-2 border-dashed rounded-2xl transition-[transform,background-color,border-color,box-shadow] duration-300
          ${isDragActive
            ? 'border-[#E7D7BE] bg-[#342F27]/25 scale-[0.99] shadow-[0_0_40px_rgba(231,215,190,0.08)]'
            : allDone
              ? 'border-green-500/40 bg-green-500/[0.03]'
              : 'border-[#2B2821] hover:border-[#6E685B] hover:bg-[#0e0c09]'}
        `}
      >
        <input {...getInputProps()} />

        {cards.length > 0 ? (
          /* Per-file cards — shown once files are dropped. */
          <div className="p-4 space-y-2">
            {cards.map((card) => {
              const fmtCls = FORMAT_STYLE[card.ext] ?? FORMAT_STYLE.ogg;
              return (
                <div
                  key={card.id}
                  className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                    card.rejected
                      ? 'bg-red-500/[0.04] border-red-500/25'
                      : card.done
                      ? 'bg-green-500/[0.04] border-green-500/20'
                      : 'bg-[#171511] border-[#2B2821]'
                  }`}
                >
                  {/* Format icon */}
                  <div className="w-8 h-8 rounded-lg bg-[#090907] border border-[#2B2821] flex items-center justify-center shrink-0">
                    <FileAudio size={14} className="text-[#837B6D]" />
                  </div>

                  {/* File info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-medium text-[#F7EBDD] truncate">{card.file.name.replace(/\.[^.]+$/, '')}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`text-[8px] font-mono font-black uppercase px-1.5 py-0.5 rounded border ${fmtCls}`}>
                        {card.ext.toUpperCase()}
                      </span>
                      <span className="text-[9px] font-mono text-[#837B6D]">{fmtBytes(card.file.size)}</span>
                      {card.rejected && (
                        <span className="text-[8px] font-mono font-bold uppercase px-1.5 py-0.5 rounded border text-red-300 bg-red-500/10 border-red-500/25">
                          Not queued
                        </span>
                      )}
                      {!card.analyzing && card.analysisError && (
                        <span className="text-[8px] font-mono font-bold uppercase px-1.5 py-0.5 rounded border text-[#E2C16D] bg-[#1f1a0a]/50 border-[#3a2f1f]">
                          Analysis skipped
                        </span>
                      )}
                      {!card.analyzing && card.bpm && (
                        <span className="text-[9px] font-mono text-[#B4AA99] tabular-nums">{card.bpm} BPM</span>
                      )}
                      {!card.analyzing && card.key && (
                        <span className={`text-[8px] font-mono font-bold px-1.5 py-0.5 rounded ${
                          card.scale === 'minor'
                            ? 'text-[#9d95e8] bg-[#1a1833]/50 border border-[#534AB7]/25'
                            : 'text-[#c8a47a] bg-[#1f1a10]/50 border border-[#3d3020]/30'
                        }`}>
                          {card.key}{card.scale === 'minor' ? 'm' : ''}
                        </span>
                      )}
                    </div>
                    {card.error && (
                      <p className="mt-1 text-[10px] leading-snug text-red-300" role="alert">
                        {card.error}
                      </p>
                    )}
                  </div>

                  {/* State icon */}
                  <div className="shrink-0">
                    {card.rejected ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCards((prev) => prev.filter((item) => item.id !== card.id));
                        }}
                        className="tap grid size-8 place-items-center rounded text-red-300 hover:bg-red-500/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                        aria-label={`Dismiss upload error for ${card.file.name}`}
                      >
                        <X size={14} />
                      </button>
                    ) : card.analyzing ? (
                      <Loader2 size={14} className="animate-spin text-[#E7D7BE]" />
                    ) : card.done ? (
                      <CheckCircle2 size={14} className="text-green-400" />
                    ) : card.analysisError ? (
                      <AlertTriangle size={14} className="text-[#E2C16D]" />
                    ) : (
                      <div className="w-2 h-2 rounded-full bg-[#E7D7BE] animate-pulse" />
                    )}
                  </div>
                </div>
              );
            })}
            {analyzing && (
              <p id="upload-dropzone-status" className="text-[9px] font-mono uppercase tracking-wider text-[#837B6D] text-center pt-1" aria-live="polite">
                Analyzing audio — BPM and key detected automatically
              </p>
            )}
            {!allDone && allQueued && (
              <p id="upload-dropzone-status" className="text-[9px] font-mono uppercase tracking-wider text-[#E7D7BE]/70 text-center pt-1" aria-live="polite">
                Queued in Uploads tray — upload continues in the background
              </p>
            )}
            {allDone && (
              <p id="upload-dropzone-status" className="text-[9px] font-mono uppercase tracking-wider text-green-400/70 text-center pt-1" aria-live="polite">
                Upload complete — library refreshes automatically
              </p>
            )}
            {rejectedCards.length > 0 && !analyzing && !allQueued && !allDone && (
              <p id="upload-dropzone-status" className="text-[9px] font-mono uppercase tracking-wider text-red-300/80 text-center pt-1" aria-live="polite">
                {rejectedCards.length} file{rejectedCards.length === 1 ? '' : 's'} need attention before upload
              </p>
            )}
          </div>
        ) : (
          /* Default idle/drag state — compact single-row layout */
          <div className="py-4 px-5 flex items-center gap-4 text-left">
            <div className={`
              w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-all duration-300
              ${isDragActive
                ? 'bg-[#342F27] text-[#E7D7BE] scale-110'
                : 'bg-[#211F1A] text-[#837B6D] group-hover:bg-[#342F27] group-hover:text-[#E7D7BE]'}
            `}>
              <Upload size={16} className="transition-transform group-hover:scale-110 duration-300" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-widest text-[#F7EBDD]">
                {isDragActive ? 'Drop to ingest' : 'Drop beats or click to upload'}
              </p>
              <p className="text-[9px] font-mono text-[#6E685B] mt-0.5">
                WAV · FLAC · AIFF · MP3 · M4A · OGG · up to 500 MB
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
