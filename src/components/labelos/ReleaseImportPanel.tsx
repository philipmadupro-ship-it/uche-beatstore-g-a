'use client';

/**
 * "Add released music" (LABEL-42): enter an album that is already out — on
 * Spotify, say — so it can go on the store. It skips every gate (there is
 * nothing left to ready), so the board offers it to an owner or an admin only
 * and the server re-checks the role; the form asks for what makes the record
 * true (the artist, the title and the day it came out) and nothing else.
 * Songs are added on the release page afterwards.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Dropdown } from '@/components/ui/Dropdown';
import { toast } from '@/hooks/useToast';
import { importReleasedRelease } from '@/lib/labelos/release-client';
import { RELEASE_TYPES } from '@/lib/labelos/releases';

const BTN =
  'rounded-lg border border-white/10 bg-white/[0.06] px-2.5 py-1 text-[11px] text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.10] disabled:opacity-40';
const FIELD = 'w-full rounded-lg border border-white/10 bg-[#090907] px-3 py-2 text-[11px] text-white placeholder:text-white/30 focus:border-white/30 focus:outline-none';
const LABEL = 'text-[10px] font-mono uppercase tracking-[0.2em] text-white/40';

export function ReleaseImportPanel({ orgId, orgSlug, artists }: { orgId: string; orgSlug: string; artists: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [contactId, setContactId] = useState(artists[0]?.id ?? '');
  const [type, setType] = useState<string>('album');
  const [releaseDate, setReleaseDate] = useState('');
  const [busy, setBusy] = useState(false);

  if (artists.length === 0) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const res = await importReleasedRelease(orgId, { title: title.trim(), contactId, type, releaseDate });
    setBusy(false);
    if (!res.ok) return void toast.error(res.error);
    toast.success('Release added');
    router.push(`/o/${orgSlug}/releases/${res.release.id}`);
  };

  if (!open) {
    return (
      <div className="mb-6">
        <button type="button" onClick={() => setOpen(true)} className={BTN} data-testid="release-import-open">
          Add released music
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mb-6 max-w-xl space-y-3 rounded-xl border border-white/10 bg-[#0D0D0A] p-4" data-testid="release-import">
      <p className="text-[11px] text-white/60">For music that is already out. It skips the release gates; add the songs on the next page.</p>
      <label className="block">
        <span className={LABEL}>Title</span>
        <input className={`${FIELD} mt-1`} value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={300} data-testid="release-import-title" />
      </label>
      <div>
        <span className={LABEL}>Artist</span>
        <div className="mt-1">
          <Dropdown value={contactId} onChange={setContactId} options={artists.map((a) => ({ value: a.id, label: a.name }))} aria-label="Artist" />
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        <div>
          <span className={LABEL}>Type</span>
          <div className="mt-1">
            <Dropdown value={type} onChange={setType} options={RELEASE_TYPES.map((t) => ({ value: t, label: t }))} aria-label="Release type" />
          </div>
        </div>
        <label className="block">
          <span className={LABEL}>Came out on</span>
          <input type="date" className={`${FIELD} mt-1`} value={releaseDate} onChange={(e) => setReleaseDate(e.target.value)} required data-testid="release-import-date" />
        </label>
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={busy || !title.trim() || !releaseDate} className={BTN} data-testid="release-import-submit">
          Add release
        </button>
        <button type="button" onClick={() => setOpen(false)} className={BTN}>Cancel</button>
      </div>
    </form>
  );
}
