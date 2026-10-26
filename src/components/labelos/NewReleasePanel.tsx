'use client';

/**
 * "New release" (LABEL-55): a draft from the releases board, with the details
 * a distributor asks for. Only what makes it a record is required — a title
 * and an artist; everything else can be typed now or on the release page, and
 * the gates say what is still missing. The typed strings become the request
 * body in `lib/labelos/release-form` (territories and language are parsed
 * there); the server's own words come back on a refusal (a UPC whose check
 * digit fails, say) and are shown on the form, not swallowed.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Dropdown } from '@/components/ui/Dropdown';
import { toast } from '@/hooks/useToast';
import { createRelease } from '@/lib/labelos/release-client';
import { buildReleaseCreateBody } from '@/lib/labelos/release-form';
import { RELEASE_TYPES } from '@/lib/labelos/releases';

const BTN =
  'rounded-lg border border-white/10 bg-white/[0.06] px-2.5 py-1 text-[11px] text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.10] disabled:opacity-40';
const FIELD = 'w-full rounded-lg border border-white/10 bg-[#090907] px-3 py-2 text-[11px] text-white placeholder:text-white/30 focus:border-white/30 focus:outline-none';
const LABEL = 'text-[10px] font-mono uppercase tracking-[0.2em] text-white/40';

const EMPTY = { title: '', type: 'single', labelName: '', upc: '', cLine: '', pLine: '', genre: '', territories: '', language: '', distributor: '', targetDate: '' };

export function NewReleasePanel({ orgId, orgSlug, artists }: { orgId: string; orgSlug: string; artists: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [contactId, setContactId] = useState(artists[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ field: string; error: string } | null>(null);
  const set = (key: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));

  if (artists.length === 0) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setProblem(null);
    const built = buildReleaseCreateBody({ ...form, contactId });
    if (!built.ok) return setProblem({ field: built.field, error: built.error });
    setBusy(true);
    const res = await createRelease(orgId, built.body);
    setBusy(false);
    if (!res.ok) {
      setProblem({ field: res.field ?? '', error: res.error });
      return void toast.error(res.error);
    }
    toast.success('Release created');
    router.push(`/o/${orgSlug}/releases/${res.release.id}`);
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={BTN} data-testid="release-new-open">
        New release
      </button>
    );
  }

  const text = (key: keyof typeof EMPTY, label: string, extra: { placeholder?: string; testId: string; max?: number; type?: string; hint?: string }) => (
    <label className="block" data-field={key}>
      <span className={LABEL}>{label}</span>
      <input
        className={`${FIELD} mt-1`}
        type={extra.type ?? 'text'}
        value={form[key]}
        onChange={set(key)}
        placeholder={extra.placeholder}
        maxLength={extra.max ?? 200}
        data-testid={extra.testId}
      />
      {extra.hint && <span className="mt-1 block text-[10px] text-white/40">{extra.hint}</span>}
    </label>
  );

  return (
    <form onSubmit={submit} className="w-full max-w-3xl space-y-4 rounded-xl border border-white/10 bg-[#0D0D0A] p-4" data-testid="release-new">
      <p className="text-[11px] text-white/60">A new draft. Only the title and the artist are needed now; the rest can be filled in here or on the release page, and its gates show what is still open.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className={LABEL}>Title</span>
          <input className={`${FIELD} mt-1`} value={form.title} onChange={set('title')} required maxLength={300} data-testid="release-new-title" />
        </label>
        <div>
          <span className={LABEL}>Artist</span>
          <div className="mt-1">
            <Dropdown value={contactId} onChange={setContactId} options={artists.map((a) => ({ value: a.id, label: a.name }))} aria-label="Artist" />
          </div>
        </div>
        <div>
          <span className={LABEL}>Type</span>
          <div className="mt-1">
            <Dropdown value={form.type} onChange={(v) => setForm((f) => ({ ...f, type: v }))} options={RELEASE_TYPES.map((t) => ({ value: t, label: t }))} aria-label="Release type" />
          </div>
        </div>
        {text('labelName', 'Label', { placeholder: 'Label name', testId: 'release-new-label' })}
        {text('upc', 'UPC', { placeholder: '12 or 13 digits', testId: 'release-new-upc', max: 40 })}
        {text('pLine', '℗ line', { placeholder: '℗ 2026 …', testId: 'release-new-pline' })}
        {text('cLine', '© line', { placeholder: '© 2026 …', testId: 'release-new-cline' })}
        {text('genre', 'Genre', { placeholder: 'Primary genre', testId: 'release-new-genre', max: 80 })}
        {text('language', 'Language', { placeholder: 'en, pt-BR…', testId: 'release-new-language', max: 20 })}
        {text('territories', 'Territories', { placeholder: 'WW, or US GB FR…', testId: 'release-new-territories', max: 1000, hint: 'Two-letter country codes; WW is worldwide.' })}
        {text('distributor', 'Distributor', { placeholder: 'Who it will go to', testId: 'release-new-distributor', max: 120 })}
        {text('targetDate', 'Planned date', { type: 'date', testId: 'release-new-date', max: 10 })}
      </div>
      {problem && (
        <p role="alert" className="text-[11px] text-[var(--error-text)]" data-testid="release-new-error" data-field={problem.field}>
          {problem.error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={busy || !form.title.trim() || !contactId} className={BTN} data-testid="release-new-submit">
          Create draft
        </button>
        <button type="button" onClick={() => setOpen(false)} className={BTN}>Cancel</button>
      </div>
    </form>
  );
}
