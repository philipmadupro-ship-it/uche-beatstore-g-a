'use client';

/**
 * One shared project, as its external member sees it (LABEL-21, 07 §1):
 *
 *   Uche × Producer X · shared by Night Shift · Nova            [Contributor]
 *   Recordings   ▶ Midnight · 140 BPM · F min · added by Producer X   ⤓
 *   Add a version   [song ▾]  [Choose files]
 *
 * Everything plays through the persistent PlayerBar (the shared layout
 * mounts it) from `/api/org/<org>/audio/<track>` — never a stored
 * reference. The controls shown are exactly what the role may do
 * (`view.me.can`, from the §2.6 table); the routes re-check each request, so
 * a control that is gone is never the only thing standing in the way. A
 * download is audited by the file's own route (`recording.downloaded`).
 */
import { useMemo, useRef, useState } from 'react';
import { Download, Music, Pause, Play, Upload } from 'lucide-react';
import { Dropdown } from '@/components/ui/Dropdown';
import { usePlayer } from '@/hooks/usePlayer';
import { PROJECT_ROLE_LABELS, projectRoleSummary } from '@/lib/labelos/project-members';
import { sharedRecordingPlayerTrack, type SharedProjectView as View, type SharedRecording } from '@/lib/labelos/shared-project';
import { useUploadManager } from '@/lib/upload/manager';

const LABEL = 'text-[10px] font-mono uppercase tracking-[0.2em] text-white/40';
const ACCEPT = '.mp3,.wav,.flac,.aiff,.aif,.m4a,.ogg,audio/*';

function duration(seconds: number | null): string | null {
  if (!seconds || seconds <= 0) return null;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function SharedProjectView({ view }: { view: View }) {
  const { project, me, recordings, uploadTargets } = view;
  const currentId = usePlayer((s) => s.currentTrack?.id ?? null);
  const isPlaying = usePlayer((s) => s.isPlaying);
  const enqueue = useUploadManager((s) => s.enqueue);
  const fileInput = useRef<HTMLInputElement>(null);
  const [songId, setSongId] = useState<string>(uploadTargets.length === 1 ? uploadTargets[0].id : '');
  const [queued, setQueued] = useState<number | null>(null);

  const songOptions = useMemo(() => uploadTargets.map((t) => ({ value: t.id, label: t.title })), [uploadTargets]);

  const toggle = (rec: SharedRecording) => {
    if (currentId === rec.id) {
      usePlayer.getState().togglePlay();
      return;
    }
    usePlayer.getState().setTrack(sharedRecordingPlayerTrack(rec, project.name));
  };

  function onFiles(files: FileList | null) {
    if (!files || !songId) return;
    for (const file of Array.from(files)) {
      // A new VERSION of the song (W4: appended, never overwriting). The
      // route re-checks the role and puts it in THIS project only.
      enqueue(file, { org: { orgId: project.orgId, as: { kind: 'link', songId, relation: 'version' } }, type: 'song' });
    }
    setQueued(files.length);
    if (fileInput.current) fileInput.current.value = '';
  }

  return (
    <div className="space-y-8" data-testid="shared-project">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className={`${LABEL} mb-2`}>Shared by {project.orgName}</p>
          <h1 className="font-heading text-[28px] font-bold leading-[1.05] tracking-tight text-white sm:text-[32px] md:text-[40px]">{project.name}</h1>
          {project.artistNames.length > 0 && <p className="mt-2 text-[11px] text-white/60">{project.artistNames.join(' · ')}</p>}
        </div>
        <div className="text-right">
          <span className="inline-block rounded-lg border border-white/20 px-2 py-0.5 text-[11px] text-white/70" data-testid="shared-role">
            {PROJECT_ROLE_LABELS[me.role]}
          </span>
          <p className="mt-1.5 max-w-xs text-[11px] text-white/40">{projectRoleSummary(me.role, me.allowDownloads)}</p>
        </div>
      </header>

      <section aria-labelledby="shared-recordings" className="space-y-3">
        <h2 id="shared-recordings" className={LABEL}>Recordings</h2>
        {recordings.length === 0 ? (
          <p className="rounded-xl border border-white/10 bg-[#0D0D0A] px-4 py-6 text-center text-[11px] text-white/40">Nothing has been added to this project yet.</p>
        ) : (
          <ul className="divide-y divide-white/[0.06] rounded-xl border border-white/10 bg-[#0D0D0A]">
            {recordings.map((r) => {
              const active = currentId === r.id;
              const playing = active && isPlaying;
              const len = duration(r.durationSeconds);
              return (
                <li key={r.id} className="flex items-center gap-3 px-3 py-2.5" data-testid={`shared-rec-${r.id}`}>
                  <button
                    type="button"
                    onClick={() => toggle(r)}
                    aria-label={`${playing ? 'Pause' : 'Play'} ${r.title}`}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white/80 transition-colors hover:bg-white/[0.10] hover:text-white"
                  >
                    {playing ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
                  </button>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-[13px] text-white/80">
                      <Music size={13} className="shrink-0 text-white/40" aria-hidden="true" />
                      <span className="truncate">{r.title}</span>
                    </span>
                    <span className="mt-0.5 block truncate font-mono text-[10px] uppercase tracking-[0.12em] text-white/40">
                      {[r.type, r.bpm ? `${Math.round(r.bpm)} BPM` : null, r.key, len, r.addedBy ? `added by ${r.addedBy}` : null].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  {r.downloadUrl && (
                    <a
                      href={r.downloadUrl}
                      download
                      aria-label={`Download ${r.title}`}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white/60 transition-colors hover:bg-white/[0.10] hover:text-white"
                    >
                      <Download size={15} aria-hidden="true" />
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {(me.can.comment || me.can.editMetadata) && (
        <p className="text-[11px] text-white/40" data-testid="shared-soon">
          {[me.can.comment ? 'comments' : null, me.can.editMetadata ? 'editing details' : null].filter(Boolean).join(' and ')} on this project open here in a
          later update. For now: listen, add versions and download, as your role allows.
        </p>
      )}

      {me.can.uploadVersions && (
        <section aria-label="Add a version" className="rounded-xl border border-white/10 bg-[#0D0D0A] p-4">
          <p className={`${LABEL} mb-3`}>Add a version</p>
          {uploadTargets.length === 0 ? (
            <p className="text-[11px] text-white/60">There is no song in this project to add a version to yet.</p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Dropdown aria-label="Song" value={songId} onChange={setSongId} options={songOptions} placeholder="Song" />
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                disabled={!songId}
                className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-[11px] text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.10] disabled:opacity-40"
              >
                <Upload className="h-3.5 w-3.5" aria-hidden />
                Choose files
              </button>
              <input ref={fileInput} type="file" multiple accept={ACCEPT} className="hidden" data-testid="shared-upload-input" onChange={(e) => onFiles(e.target.files)} />
            </div>
          )}
          <p className="mt-3 text-[11px] text-white/60" aria-live="polite">
            {queued !== null
              ? `${queued} file${queued === 1 ? '' : 's'} added to the uploads tray.`
              : 'A new version is added next to the song; it never replaces anything. It stays in this project, credited to you.'}
          </p>
        </section>
      )}
    </div>
  );
}
