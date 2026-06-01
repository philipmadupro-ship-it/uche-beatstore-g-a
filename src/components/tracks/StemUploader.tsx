'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Upload, Check, Loader2, X, AudioLines, Plus, Trash2 } from 'lucide-react';
import { toast } from '@/hooks/useToast';
import { cn } from '@/lib/utils';

const STEMS = [
  { key: 'vocals', label: 'Vocals', color: 'text-[#E0A555]' },
  { key: 'drums',  label: 'Drums',  color: 'text-[#e88a8a]' },
  { key: 'bass',   label: 'Bass',   color: 'text-[#7aa8e8]' },
  { key: 'other',  label: 'Other',  color: 'text-[#6DC6A4]' },
] as const;
type StemKey = (typeof STEMS)[number]['key'];

const CATEGORIES = [
  { value: 'vocals', label: 'Vocals' },
  { value: 'melody', label: 'Melody' },
  { value: 'drums',  label: 'Drums' },
  { value: 'bass',   label: 'Bass' },
  { value: 'fx',     label: 'FX' },
  { value: 'other',  label: 'Other' },
] as const;

interface StemFile {
  id: string;
  label: string;
  category: string;
  url: string;
  position: number;
}

interface Props {
  trackId: string;
  initial?: Partial<Record<StemKey, string | null>>;
  onChange?: () => void;
}

/**
 * Stem manager. Two tiers:
 *
 *   1. Core stems — the four named slots (vocals/drums/bass/other) that power
 *      the producer-share per-stem downloads. One file each, re-uploadable.
 *   2. Additional stems — an arbitrary, repeatable list of labeled files
 *      (lead, harmony, 808, perc, adlibs, fx, …) backed by track_stem_files
 *      (migration 080). Each carries an optional custom label + a category.
 *
 * Real sessions export far more than four stems; the additional list removes
 * the four-slot ceiling without disturbing the share-download wiring.
 */
export function StemUploader({ trackId, initial, onChange }: Props) {
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
      const res = await fetch(`/api/tracks/${trackId}/stems/upload`, { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
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

  /* ── Additional (flexible) stems ── */
  const [files, setFiles] = useState<StemFile[]>([]);
  const [filesLoaded, setFilesLoaded] = useState(false);

  const loadFiles = useCallback(async () => {
    try {
      const res = await fetch(`/api/tracks/${trackId}/stem-files`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      // Toplines (recorded in the Lyrics Studio notes) live in the same table
      // but aren't deliverable stems — keep them out of this list.
      setFiles((data.files ?? []).filter((f: StemFile) => f.category !== 'topline'));
    } catch {
      // best-effort
    } finally {
      setFilesLoaded(true);
    }
  }, [trackId]);

  useEffect(() => { loadFiles(); }, [loadFiles]);

  return (
    <div className="rounded-xl border border-[#1f1a13] bg-[#14110d] p-5">
      <div className="flex items-center gap-2 mb-1">
        <AudioLines size={11} className="text-[#a08a6a]" />
        <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#a08a6a]">Stems</p>
      </div>
      <p className="text-[10px] text-[#6a5d4a] mb-4 leading-relaxed">
        Attach exported stems. Recipients with a producer/engineer share can download them.
      </p>

      {/* Core named slots */}
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

      {/* Additional stems — arbitrary, labeled, repeatable */}
      <div className="mt-5 pt-4 border-t border-[#1f1a13]">
        <div className="flex items-center justify-between mb-2.5">
          <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#5a5142]">
            Additional stems{files.length > 0 ? ` · ${files.length}` : ''}
          </p>
        </div>

        {filesLoaded && files.length > 0 && (
          <div className="space-y-1.5 mb-3">
            {files.map((f) => (
              <ExtraStemRow key={f.id} trackId={trackId} file={f} onRemoved={loadFiles} />
            ))}
          </div>
        )}

        <AddStemRow trackId={trackId} onAdded={loadFiles} />
      </div>
    </div>
  );
}

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
  const handleFiles = (files: FileList | null) => { const f = files?.[0]; if (f) onFile(f); };

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); handleFiles(e.dataTransfer.files); }}
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
          {pending ? <Loader2 size={12} className="animate-spin" /> : url ? <Check size={12} /> : error ? <X size={12} className="text-red-400" /> : <Upload size={12} />}
        </div>
        <div className="min-w-0 flex-1">
          <p className={cn('text-[11px] font-medium uppercase tracking-wider', url ? color : 'text-[#a08a6a]')}>{label}</p>
          <p className="text-[9px] text-[#6a5d4a] truncate font-mono">
            {pending ? 'Uploading…' : url ? 'Loaded — click to replace' : error ? error : 'Drop or click'}
          </p>
        </div>
      </div>
    </div>
  );
}

function ExtraStemRow({ trackId, file, onRemoved }: { trackId: string; file: StemFile; onRemoved: () => void }) {
  const [removing, setRemoving] = useState(false);
  const remove = async () => {
    if (removing) return;
    setRemoving(true);
    try {
      const res = await fetch(`/api/tracks/${trackId}/stem-files?file_id=${file.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onRemoved();
    } catch (err) {
      toast.error('Could not remove stem', err instanceof Error ? err.message : 'Try again');
      setRemoving(false);
    }
  };
  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg border border-[#1f1a13] bg-[#1a160f]">
      <Check size={12} className="text-[#6DC6A4] shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium text-[#E8DCC8] truncate">{file.label}</p>
        <p className="text-[9px] font-mono uppercase tracking-wider text-[#6a5d4a]">{file.category}</p>
      </div>
      <button
        onClick={remove}
        disabled={removing}
        className="text-[#5a5142] hover:text-red-400 transition-colors shrink-0 disabled:opacity-40"
        aria-label="Remove stem"
      >
        {removing ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
      </button>
    </div>
  );
}

function AddStemRow({ trackId, onAdded }: { trackId: string; onAdded: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState('');
  const [category, setCategory] = useState('other');
  const [uploading, setUploading] = useState(false);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('label', label.trim() || file.name.replace(/\.[^.]+$/, ''));
      fd.append('category', category);
      const res = await fetch(`/api/tracks/${trackId}/stem-files`, { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setLabel('');
      toast.success('Stem added');
      onAdded();
    } catch (err) {
      toast.error('Stem upload failed', err instanceof Error ? err.message : 'Try again');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Label (e.g. Lead, 808, Adlibs)"
        className="flex-1 min-w-[140px] bg-[#0c0a08] border border-[#1f1a13] rounded-md px-2.5 py-2 text-[11px] text-[#E8DCC8] placeholder:text-[#3a3328] focus:outline-none focus:border-[#8A7A5C] transition-colors"
      />
      <select
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        className="bg-[#0c0a08] border border-[#1f1a13] rounded-md px-2 py-2 text-[11px] text-[#E8DCC8] focus:outline-none focus:border-[#8A7A5C] transition-colors font-mono"
      >
        {CATEGORIES.map((c) => <option key={c.value} value={c.value} className="bg-[#0a0907]">{c.label}</option>)}
      </select>
      <input
        ref={inputRef}
        type="file"
        accept="audio/*,.wav,.mp3,.flac,.aiff,.aif,.m4a,.ogg"
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0])}
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-[#2A2418] border border-[#8A7A5C]/40 text-[#E8D8B8] text-[11px] font-medium hover:bg-[#332b1d] transition-colors disabled:opacity-50"
      >
        {uploading ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
        Add stem
      </button>
    </div>
  );
}
