'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Upload, Check, Loader2, X, AudioLines, Plus, Trash2 } from 'lucide-react';
import { toast, confirmToast } from '@/hooks/useToast';
import { cn } from '@/lib/utils';
import { Dropdown } from '@/components/ui/Dropdown';
import { InlineText } from '@/components/ui/InlineText';

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
    <div className="rounded-xl border border-white/10 bg-white/[0.04] p-5">
      <div className="flex items-center gap-2 mb-1">
        <AudioLines size={11} className="text-white/80" />
        <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/80">Stems</p>
      </div>
      <p className="text-[10px] text-white/60 mb-4 leading-relaxed">
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
      <div className="mt-5 pt-4 border-t border-white/10">
        <div className="flex items-center justify-between mb-2.5">
          <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-white/40">
            Additional stems{files.length > 0 ? ` · ${files.length}` : ''}
          </p>
        </div>

        {filesLoaded && files.length > 0 && (
          <div className="space-y-1.5 mb-3">
            {files.map((f) => (
              <ExtraStemRow key={f.id} trackId={trackId} file={f} onRemoved={loadFiles} onChanged={loadFiles} />
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
  const inputId = useId();
  const [drag, setDrag] = useState(false);
  const handleFiles = (files: FileList | null) => { const f = files?.[0]; if (f) onFile(f); };

  return (
    <div>
      <input
        id={inputId}
        ref={inputRef}
        type="file"
        accept="audio/*,.wav,.mp3,.flac,.aiff,.aif,.m4a,.ogg"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <button
      type="button"
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); handleFiles(e.dataTransfer.files); }}
      aria-describedby={error ? `${inputId}-error` : undefined}
      className={cn(
        'tap group relative w-full min-h-14 px-3 py-3 rounded-lg border text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-black',
        drag
          ? 'border-white/50 bg-white/10'
          : url
            ? 'border-white/10 bg-white/[0.05] hover:border-white/20'
            : 'border-dashed border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]',
      )}
    >
      <div className="flex items-center gap-2">
        <div className={cn('w-6 h-6 rounded flex items-center justify-center shrink-0', color)}>
          {pending ? <Loader2 size={12} className="animate-spin" /> : url ? <Check size={12} /> : error ? <X size={12} className="text-red-400" /> : <Upload size={12} />}
        </div>
        <div className="min-w-0 flex-1">
          <p className={cn('text-[11px] font-medium uppercase tracking-wider', url ? color : 'text-white/80')}>{label}</p>
          <p id={error ? `${inputId}-error` : undefined} className="text-[9px] text-white/60 truncate font-mono">
            {pending ? 'Uploading…' : url ? 'Loaded — click to replace' : error ? error : 'Drop or click'}
          </p>
        </div>
      </div>
      </button>
    </div>
  );
}

/**
 * One additional stem file.
 *
 * Label and category are edited in place. Before, the row was read-only with a
 * single Remove button, so fixing a typo in "Adlibs" meant deleting the file
 * and uploading it again — a destructive round trip on assets that are often
 * the only copy outside the producer's DAW. Removal now confirms for the same
 * reason: unlike the offline cache, a deleted stem does not come back.
 */
function ExtraStemRow({ trackId, file, onRemoved, onChanged }: {
  trackId: string; file: StemFile; onRemoved: () => void; onChanged: () => void;
}) {
  const [removing, setRemoving] = useState(false);

  const patch = async (body: Record<string, unknown>) => {
    try {
      const res = await fetch(`/api/tracks/${trackId}/stem-files`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_id: file.id, ...body }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `HTTP ${res.status}`);
      }
      onChanged();
      return true;
    } catch (err) {
      toast.error('Could not save', err instanceof Error ? err.message : 'Try again');
      return false;
    }
  };

  const remove = async () => {
    if (removing) return;
    const ok = await confirmToast(
      `Remove "${file.label}"?`,
      'The stem file is deleted permanently. This cannot be undone.',
      { confirmLabel: 'Remove', cancelLabel: 'Keep', danger: true },
    );
    if (!ok) return;
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
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg border border-white/10 bg-white/[0.05]">
      <Check size={12} className="text-[#6DC6A4] shrink-0" />
      <div className="min-w-0 flex-1">
        <InlineText
          label={`Label for ${file.label}`}
          value={file.label}
          onSave={(next) => patch({ label: next })}
          maxLength={120}
          className="-mx-1 px-1 text-[11px] font-medium text-white"
          inputClassName="text-[11px] font-medium"
        />
      </div>
      <Dropdown
        value={file.category}
        onChange={(next) => { void patch({ category: next }); }}
        options={CATEGORIES.map((c) => ({ value: c.value, label: c.label }))}
        menuWidth={150}
        align="right"
        aria-label={`Category for ${file.label}`}
        className="min-h-9 w-[104px] shrink-0 font-mono text-[10px] uppercase tracking-wider"
      />
      <button
        onClick={remove}
        disabled={removing}
        className="tap grid size-11 shrink-0 place-items-center rounded-full text-white/40 transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:opacity-40"
        aria-label={`Remove stem ${file.label}`}
      >
        {removing ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
      </button>
    </div>
  );
}

function AddStemRow({ trackId, onAdded }: { trackId: string; onAdded: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const labelId = useId();
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
      <div className="min-w-[150px] flex-1">
        <label htmlFor={labelId} className="mb-1 block text-[8px] font-mono uppercase tracking-[0.18em] text-white/40">
          Stem label
        </label>
        <input
          id={labelId}
          name="stem-label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Lead, 808, Adlibs…"
          autoComplete="off"
          className="min-h-11 w-full rounded-md border border-white/10 bg-white/[0.02] px-2.5 py-2 text-[11px] text-white transition-colors placeholder:text-white/30 focus:outline-none focus:border-white/50"
        />
      </div>
      <div>
        <span className="mb-1 block text-[8px] font-mono uppercase tracking-[0.18em] text-white/40">
          Category
        </span>
        {/* `Dropdown` over `<select>` is a documented convention — a native
            select renders the OS menu, which ignores the app's palette and
            cannot be styled to match the fields beside it. */}
        <Dropdown
          value={category}
          onChange={setCategory}
          options={CATEGORIES.map((c) => ({ value: c.value, label: c.label }))}
          menuWidth={150}
          aria-label="Stem category"
          className="min-h-11 w-[130px] font-mono text-[11px]"
        />
      </div>
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
        className="tap mt-4 flex min-h-11 items-center gap-1.5 rounded-md border border-white/20 bg-white/10 px-3 py-2 text-[11px] font-medium text-white transition-colors hover:bg-[#332b1d] disabled:opacity-50"
      >
        {uploading ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
        Add stem
      </button>
    </div>
  );
}
