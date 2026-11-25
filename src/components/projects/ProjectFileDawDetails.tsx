'use client';

/**
 * DAW project file details in the project's Files (AUDIO-02).
 *
 * `useDawMetas` makes one lazy, owner-gated request per candidate file (a
 * session by name, or a `.zip` that might be a bundled session) to
 * `/api/projects/[id]/assets/[assetId]/meta`, which answers with the app, its
 * version and the tempo and nothing else. A failure or an unreadable file
 * leaves no entry — the row already says what kind of file it is. The row
 * turns the answer into its kind label, icon and details line with
 * `dawRowInfo` (lib/projects/daw.ts).
 */
import { useEffect, useState } from 'react';
import { DAW_EXTENSIONS } from '@/lib/projects/daw';
import { fileExtension } from '@/lib/projects/assets';

export interface DawMeta {
  app: string;
  appVersion: string | null;
  bpm: number | null;
}

export function useDawMetas(projectId: string, files: ReadonlyArray<{ id: string; file_name: string }>, enabled: boolean): Record<string, DawMeta> {
  const [metas, setMetas] = useState<Record<string, DawMeta>>({});
  const wanted = enabled
    ? files.filter((f) => { const ext = fileExtension(f.file_name); return !!DAW_EXTENSIONS[ext] || ext === 'zip'; }).map((f) => f.id)
    : [];
  const key = wanted.join(',');

  useEffect(() => {
    let cancelled = false;
    for (const id of key ? key.split(',') : []) {
      fetch(`/api/projects/${projectId}/assets/${id}/meta`)
        .then((r) => (r.ok ? (r.json() as Promise<DawMeta>) : null))
        .then((m) => {
          if (!cancelled && m && typeof m.app === 'string') setMetas((prev) => ({ ...prev, [id]: m }));
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [projectId, key]);

  return metas;
}

/** The details line. On a phone it sits on its own line; from `sm` it follows the file name. */
export function ProjectFileDawDetails({ assetId, text }: { assetId: string; text: string | null }) {
  if (!text) return null;
  return (
    <span data-testid={`project-file-daw-${assetId}`} className="block sm:inline">
      <span className="hidden sm:inline"> · </span>
      {text}
    </span>
  );
}
