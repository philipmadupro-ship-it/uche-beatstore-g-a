'use client';

import { useEffect, useRef, useState } from 'react';
import { Upload, Check, Loader2, X, AudioLines } from 'lucide-react';
import { toast } from '@/hooks/useToast';
import { cn } from '@/lib/utils';

const STEMS = [
  { key: 'vocals', label: 'Vocals', color: 'text-[#E0A555]' },
  { key: 'drums',  label: 'Drums',  color: 'text-[#e88a8a]' },
  { key: 'bass',   label: 'Bass',   color: 'text-[#7aa8e8]' },
  { key: 'other',  label: 'Other',  color: 'text-[#6DC6A4]' },
] as const;
type StemKey = (typeof STEMS)[number]['key'];

interface Props {
  trackId: string;
  /** Existing stem URLs (if any) — keys this view to "loaded" state per
   *  slot when a stem already exists. Passed in by parent (drawer /
   *  library detail) so the uploader doesn't have to fetch on its own. */
  initial?: Partial<Record<StemKey, string | null>>;
  /** Fires after a successful upload so the parent can re-fetch the
   *  track + stems and refresh badges elsewhere. */
  onChange?: () => void;
}

/**
 * Four-slot stem uploader. The producer/engineer flow: a finished song
 * the user wants to send out for mix. They drop in their already-
 * exported stems (vocals/drums/bass/other) and the track gets its
 * `stems_status` flipped to 'done' so the producer share variant can
 * expose the per-stem downloads.
 *
 * Each slot is independent — the user can re-upload one stem if they
 * grabbed the wrong file, without re-uploading the rest.
 *
 * Upload posts directly to `/api/tracks/[id]/stems/upload` with a
 * multipart body. We don't go through the chunked upload-init flow
 * because individual stems are usually <100MB and the speed gain
 * from chunking isn't worth the extra hops for this UX.
 */
export function StemUploader({ trackId, initial, onChange }: Props) {
  // Per-slot state. `existing` holds the persisted URL after a successful
  // upload (or as passed in via `initial`). `pending` is true during the
  // active POST. `error` shows on a failed attempt and stays until the
  // next attempt clears it.
  const [existing, setExisting] = useState<Record<StemKey, string | null>>(() => ({
    vocals: initial?.vocals ?? null,
    drums:  initial?.drums  ?? null,
    bass:   initial?.bass   ?? null,
    other:  initial?.other  ?? null,
  }));
  const [pending, setPending] = useState<Record<StemKey, boolean>>({
    vocals: false, drums: false, bass: false, other: false,
  });
  const [errors, setErrors] = useState<Record<StemKey, string | null>>({
    vocals: null, drums: null, bass: null, other: null,
  });

  // Re-sync local state when the parent re-keys the component with new
  // `initial` (e.g. after refetch). Without this the uploader would
  // ignore server-side changes.
  useEffect(() => {
    setExisting({
      vocals: initial?.vocals ?? null,
      drums:  initial?.drums  ?? null,
      bass:   initial?.bass   ?? null,
      other:  initial?.other  ?? null,
    });
  }, [initial?.vocals, initial?.drums, initial?.bass, initial?.other]);

  const upload = async (stemType: StemKey, file: File) => {
    setPending((p) => ({ ...p, [stemType]: true }));
    setErrors((e) => ({ ...e, [stemType]: null }));
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('stemType', stemType);
      const res = await fetch(`/api/tracks/${trackId}/stems/upload`, {
        method: 'POST',
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      setExisting((cur) => ({ ...cur, [stemType]: data.url as string }));
      toast.success(`${stemType} stem uploaded`);
      onChange?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed';
      setErrors((e) => ({ ...e, [stemType]: msg }));
      toast.error(`${stemType} upload failed`, msg);
    } finally {
      setPending((p) => ({ ...p, [stemType]: false }));
    }
  };

  return (
    <div className="rounded-xl border border-[#1f1a13] bg-[#14110d] p-5">
      <div className="flex items-center gap-2 mb-1">
        <AudioLines size={11} className="text-[#a08a6a]" />
        <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#a08a6a]">Stems</p>
      </div>
      <p className="text-[10px] text-[#6a5d4a] mb-4 leading-relaxed">
        Upload the stems for this track. Once attached, recipients with a producer/engineer
        share will be able to download them.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {STEMS.map((s) => (
          <StemSlot
            key={s.key}
            label={s.label}
            color={s.color}
            url={existing[s.key]}
            pending={pending[s.key]}
            error={errors[s.key]}
            onFile={(f) => upload(s.key, f)}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Single stem slot — three states: empty (dropzone), pending (spinner),
 * loaded (check + filename). Re-clicking a loaded slot re-opens the
 * file picker for re-upload.
 */
function StemSlot({
  label, color, url, pending, error, onFile,
}: {
  label: string;
  color: string;
  url: string | null;
  pending: boolean;
  error: string | null;
  onFile: (f: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  const handleFiles = (files: FileList | null) => {
    const f = files?.[0];
    if (f) onFile(f);
  };

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        handleFiles(e.dataTransfer.files);
      }}
      className={cn(
        'group relative px-3 py-3 rounded-lg border cursor-pointer transition-colors',
        drag
          ? 'border-[#8A7A5C] bg-[#2A2418]'
          : url
            ? 'border-[#1f1a13] bg-[#1a160f] hover:border-[#2d2620]'
            : 'border-dashed border-[#1f1a13] bg-[#0c0a08] hover:border-[#2d2620] hover:bg-[#14110d]',
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept="audio/*,.wav,.mp3,.flac,.aiff,.aif,.m4a,.ogg"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <div className="flex items-center gap-2">
        <div className={cn('w-6 h-6 rounded flex items-center justify-center shrink-0', color)}>
          {pending ? (
            <Loader2 size={12} className="animate-spin" />
          ) : url ? (
            <Check size={12} />
          ) : error ? (
            <X size={12} className="text-red-400" />
          ) : (
            <Upload size={12} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className={cn('text-[11px] font-medium uppercase tracking-wider', url ? color : 'text-[#a08a6a]')}>
            {label}
          </p>
          <p className="text-[9px] text-[#6a5d4a] truncate font-mono">
            {pending ? 'Uploading…' : url ? 'Loaded — click to replace' : error ? error : 'Drop or click'}
          </p>
        </div>
      </div>
    </div>
  );
}
