'use client';

/**
 * The metadata editor of an org song or recording (LABEL-53): title, version,
 * ISRC, ISWC, BPM, key, language, explicit, genre, recording date, ℗ line,
 * master owner and notes, saved together with Save.
 *
 *  - It loads `GET …/songs/<id>/metadata`, which also says which fields THIS
 *    member may change (`writable`): the ISRC needs `release.write`, the rest
 *    `catalog.write`. A field they may not change is shown, read-only.
 *  - Save sends only the fields that differ, with the token the form loaded
 *    with. If someone saved first the server answers 409 with their values;
 *    the form says so, shows the current values and keeps what you typed in
 *    place until you choose "Use the current values" (no silent overwrite).
 *
 * The rules (formats, ranges, normal forms) are the server's
 * (lib/labelos/track-metadata); a 400 names the field and the form puts the
 * message under it.
 */
import { useCallback, useEffect, useState } from 'react';
import { toast } from '@/hooks/useToast';
import { cn } from '@/lib/utils';
import { fieldsFor, TEXT_MAX, type MetadataField, type MetadataValues } from '@/lib/labelos/track-metadata';
import { diffDraft, fetchMetadata, saveMetadata, toDraft, type MetadataLoad } from '@/lib/labelos/track-metadata-client';

const LABEL = 'text-[10px] font-mono uppercase tracking-[0.2em] text-white/40';
const BTN =
  'rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[11px] text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.10] disabled:cursor-not-allowed disabled:opacity-40';
const FIELD =
  'w-full rounded-lg border border-white/10 bg-[#090907] px-3 py-2 text-[11px] text-white placeholder:text-white/30 focus:border-white/30 focus:outline-none disabled:opacity-60';

const FIELD_LABEL: Record<MetadataField, string> = {
  title: 'Title',
  version_label: 'Version',
  isrc: 'ISRC',
  iswc: 'ISWC',
  bpm: 'BPM',
  key: 'Key',
  language: 'Language',
  explicit: 'Explicit',
  genre: 'Genre',
  recorded_on: 'Recorded on',
  p_line: '℗ line',
  master_owner: 'Master owner',
  notes: 'Notes',
};
const PLACEHOLDER: Partial<Record<MetadataField, string>> = {
  version_label: 'Radio edit',
  isrc: 'GB-AAA-26-00001',
  iswc: 'T-034.524.680-1',
  key: 'F minor',
  language: 'en, pt-BR',
  p_line: '℗ 2026 Label',
  recorded_on: 'YYYY-MM-DD',
};
const HINT: Partial<Record<MetadataField, string>> = {
  isrc: 'Needs release rights. Dashes are fine; stored compact.',
  notes: 'Private to people who can edit this. Never shown in the activity feed.',
};
const EXPLICIT_CHOICES: { value: string; label: string }[] = [
  { value: 'unset', label: 'Not stated' },
  { value: 'no', label: 'Clean' },
  { value: 'yes', label: 'Explicit' },
];

export function OrgTrackMetadata({ orgId, trackId, title, testId = 'org-metadata' }: { orgId: string; trackId: string; title?: string; testId?: string }) {
  const [loaded, setLoaded] = useState<MetadataLoad | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<MetadataField, string> | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [saved, setSaved] = useState<MetadataValues | null>(null);
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState<{ field?: MetadataField; message: string } | null>(null);
  const [conflict, setConflict] = useState<{ values: MetadataValues; updatedAt: string | null; message: string } | null>(null);

  const apply = useCallback((values: MetadataValues, updatedAt: string | null) => {
    setSaved(values);
    setToken(updatedAt);
    setDraft(toDraft(values));
  }, []);

  useEffect(() => {
    let live = true;
    void fetchMetadata(orgId, trackId).then((r) => {
      if (!live) return;
      if (!r.ok) { setLoadError(r.error); return; }
      setLoaded(r.data);
      apply(r.data.values, r.data.updatedAt);
    });
    return () => { live = false; };
  }, [orgId, trackId, apply]);

  if (loadError) return <p className="text-[11px] text-red-400" role="alert" data-testid={`${testId}-error`}>{loadError}</p>;
  if (!loaded || !draft || !saved) return <p className="text-[11px] text-white/40" data-testid={`${testId}-loading`}>Loading details…</p>;

  const fields = fieldsFor(loaded.kind);
  const writable = new Set<MetadataField>(loaded.writable);
  const patch = diffDraft(saved, draft, fields.filter((f) => writable.has(f)));
  const dirty = Object.keys(patch).length > 0;
  const set = (f: MetadataField, v: string) => {
    setDraft({ ...draft, [f]: v });
    if (fieldError?.field === f) setFieldError(null);
  };

  const save = async () => {
    setBusy(true);
    setFieldError(null);
    const res = await saveMetadata(orgId, trackId, token, patch as Partial<MetadataValues>);
    setBusy(false);
    if (res.ok) {
      apply(res.values, res.updatedAt);
      setConflict(null);
      toast.success(res.changed.length ? 'Details saved' : 'Nothing to save');
      return;
    }
    if (res.conflict) {
      setConflict({ values: res.values, updatedAt: res.updatedAt, message: res.error });
      return;
    }
    setFieldError({ field: res.field, message: res.error });
  };

  return (
    <form
      className="space-y-4"
      data-testid={testId}
      onSubmit={(e) => { e.preventDefault(); if (dirty && !busy && !conflict) void save(); }}
    >
      {title && <h3 className={LABEL}>{title}</h3>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {fields.map((f) => {
          const id = `${testId}-${f}`;
          const readOnly = !writable.has(f);
          const err = fieldError?.field === f ? fieldError.message : null;
          return (
            <div key={f} className={cn('space-y-1', (f === 'notes' || f === 'title') && 'sm:col-span-2')}>
              <label htmlFor={id} className={LABEL}>{FIELD_LABEL[f]}</label>
              {f === 'explicit' ? (
                <div id={id} role="group" aria-label="Explicit" className="flex gap-1">
                  {EXPLICIT_CHOICES.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      disabled={readOnly}
                      aria-pressed={draft.explicit === c.value}
                      onClick={() => set('explicit', c.value)}
                      className={cn('rounded-lg border px-3 py-1.5 text-[11px] transition-colors disabled:opacity-40', draft.explicit === c.value ? 'border-white/30 bg-white/[0.14] text-white' : 'border-white/10 bg-white/[0.06] text-white/60 hover:border-white/20 hover:bg-white/[0.10]')}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              ) : f === 'notes' ? (
                <textarea id={id} rows={3} value={draft.notes} maxLength={TEXT_MAX.notes} disabled={readOnly} onChange={(e) => set(f, e.target.value)} className={FIELD} aria-invalid={!!err} />
              ) : (
                <input
                  id={id}
                  value={draft[f]}
                  disabled={readOnly}
                  inputMode={f === 'bpm' ? 'numeric' : undefined}
                  maxLength={f in TEXT_MAX ? TEXT_MAX[f as keyof typeof TEXT_MAX] : 64}
                  placeholder={PLACEHOLDER[f]}
                  onChange={(e) => set(f, e.target.value)}
                  className={FIELD}
                  aria-invalid={!!err}
                  aria-describedby={err ? `${id}-err` : undefined}
                  autoComplete="off"
                  spellCheck={false}
                />
              )}
              {err ? (
                <p id={`${id}-err`} role="alert" className="text-[11px] text-red-400" data-testid={`${id}-error`}>{err}</p>
              ) : HINT[f] && !readOnly ? (
                <p className="text-[11px] text-white/40">{HINT[f]}</p>
              ) : readOnly && f === 'isrc' ? (
                <p className="text-[11px] text-white/40">Your role cannot change the ISRC.</p>
              ) : null}
            </div>
          );
        })}
      </div>

      {conflict && (
        <div role="alert" className="space-y-2 rounded-xl border border-white/20 bg-white/[0.06] p-3 text-[11px] text-white/80" data-testid={`${testId}-conflict`}>
          <p>{conflict.message}</p>
          <button
            type="button"
            className={BTN}
            data-testid={`${testId}-reload`}
            onClick={() => { apply(conflict.values, conflict.updatedAt); setConflict(null); }}
          >
            Use the current values
          </button>
        </div>
      )}
      {fieldError && !fieldError.field && <p role="alert" className="text-[11px] text-red-400">{fieldError.message}</p>}

      <div className="flex items-center gap-3">
        <button type="submit" disabled={!dirty || busy || !!conflict} className={BTN} data-testid={`${testId}-save`}>
          {busy ? 'Saving…' : 'Save details'}
        </button>
        {dirty && !busy && <span className="text-[11px] text-white/40">Unsaved changes</span>}
      </div>
    </form>
  );
}
