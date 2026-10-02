'use client';

/**
 * Upload audio into an org (LABEL-14, W3): pick the artist, then either
 * "New songs" (every file becomes a song in that artist's Inbox) or "Add to
 * song as…" a relation of one of the artist's songs. Files go to the global
 * uploads tray, which runs them through `/api/org/<org>/upload/*`
 * (lib/upload/org-target) — the producer's upload path is untouched.
 *
 * Rendered only for a member with `catalog.write`; the routes check it again,
 * per artist and per song.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { Dropdown } from '@/components/ui/Dropdown';
import {
  ORG_UPLOAD_MODE_LABELS,
  orgUploadIntentFor,
  orgUploadTrackFields,
  type OrgUploadMode,
} from '@/lib/labelos/org-upload';
import { useUploadManager } from '@/lib/upload/manager';

type Song = { id: string; title: string | null };
type Songs = { state: 'idle' | 'loading' | 'failed' } | { state: 'ready'; songs: Song[] };

const ACCEPT = '.mp3,.wav,.flac,.aiff,.aif,.m4a,.ogg,audio/*';

export function OrgUploadPanel({ orgId, artists }: { orgId: string; artists: { id: string; name: string }[] }) {
  const enqueue = useUploadManager((s) => s.enqueue);
  const fileInput = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<string>('');
  const [mode, setMode] = useState<OrgUploadMode>('song');
  const [songId, setSongId] = useState<string>('');
  /** Songs fetched per artist; absent = not loaded yet. */
  const [songsBy, setSongsBy] = useState<Record<string, Song[] | 'failed'>>({});
  const [queued, setQueued] = useState<number | null>(null);

  // One artist: it is the artist.
  const contactId = picked || (artists.length === 1 ? artists[0].id : '');
  const linking = mode !== 'song';

  // "Add to song as…" lists the artist's songs (the targets route, scoped like the artist).
  useEffect(() => {
    if (!linking || !contactId || songsBy[contactId] !== undefined) return;
    let cancelled = false;
    fetch(`/api/org/${orgId}/upload/targets?contactId=${encodeURIComponent(contactId)}`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { songs?: Song[] };
        if (!cancelled) setSongsBy((m) => ({ ...m, [contactId]: body.songs ?? [] }));
      })
      .catch(() => {
        if (!cancelled) setSongsBy((m) => ({ ...m, [contactId]: 'failed' }));
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, contactId, linking, songsBy]);

  const loaded = contactId ? songsBy[contactId] : undefined;
  const songs: Songs = !linking || !contactId ? { state: 'idle' } : loaded === undefined ? { state: 'loading' } : loaded === 'failed' ? { state: 'failed' } : { state: 'ready', songs: loaded };
  const pickArtist = (id: string) => {
    setPicked(id);
    setSongId('');
  };

  const intent = orgUploadIntentFor({ contactId: contactId || null, mode, songId: songId || null });
  const artistOptions = useMemo(() => artists.map((a) => ({ value: a.id, label: a.name })), [artists]);
  const modeOptions = useMemo(
    () => (Object.keys(ORG_UPLOAD_MODE_LABELS) as OrgUploadMode[]).map((m) => ({ value: m, label: ORG_UPLOAD_MODE_LABELS[m] })),
    [],
  );
  const songOptions = songs.state === 'ready' ? songs.songs.map((s) => ({ value: s.id, label: s.title || 'Untitled' })) : [];

  function onFiles(files: FileList | null) {
    if (!files || !intent) return;
    const type = orgUploadTrackFields(intent).type;
    for (const file of Array.from(files)) enqueue(file, { org: { orgId, as: intent }, type });
    setQueued(files.length);
    if (fileInput.current) fileInput.current.value = '';
  }

  if (artists.length === 0) return null;

  return (
    <section aria-label="Upload audio" className="mb-6 rounded-xl border border-white/10 bg-[#0D0D0A] p-4 sm:mb-8">
      <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">Upload audio</p>
      <div className="flex flex-wrap items-center gap-2">
        <Dropdown
          aria-label="Artist"
          value={contactId}
          onChange={pickArtist}
          options={artistOptions}
          placeholder="Artist"
        />
        <Dropdown aria-label="What the files are" value={mode} onChange={setMode} options={modeOptions} />
        {linking && (
          <Dropdown
            aria-label="Song"
            value={songId}
            onChange={setSongId}
            options={songOptions}
            placeholder={songs.state === 'loading' ? 'Loading songs…' : songs.state === 'failed' ? 'Could not load songs' : songOptions.length ? 'Song' : 'No songs yet'}
            disabled={!contactId || songOptions.length === 0}
          />
        )}
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={!intent}
          className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-[11px] text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.10] disabled:opacity-40"
        >
          <Upload className="h-3.5 w-3.5" aria-hidden />
          Choose files
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          data-testid="org-upload-input"
          onChange={(e) => onFiles(e.target.files)}
        />
      </div>
      <p className="mt-3 text-[11px] text-white/60" aria-live="polite">
        {queued !== null
          ? `${queued} file${queued === 1 ? '' : 's'} added to the uploads tray.`
          : mode === 'song'
            ? 'Each file becomes a song in the artist’s Inbox. Previews stay private.'
            : 'Each file is linked to the song you pick. Previews stay private.'}
      </p>
    </section>
  );
}
