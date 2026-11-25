'use client';

/**
 * The details line of a DAW project file in the project's Files (AUDIO-02):
 * "· v21.2 · 140 BPM". One lazy, owner-gated request per file to
 * `/api/projects/[id]/assets/[assetId]/meta`, which returns the app, its
 * version and the tempo and nothing else. A failure or an unreadable file
 * renders nothing — the row already says what kind of file it is.
 *
 * A `.zip` asks too: if its first entry is a session it is a bundled project
 * and says so.
 */
import { useEffect, useState } from 'react';
import { dawOf } from '@/lib/projects/daw';
import { fileExtension } from '@/lib/projects/assets';

interface Meta {
  app: string;
  appVersion: string | null;
  bpm: number | null;
}

export function ProjectFileDawDetails({ projectId, assetId, fileName }: { projectId: string; assetId: string; fileName: string }) {
  const isSession = !!dawOf(fileName);
  const isZip = fileExtension(fileName) === 'zip';
  const [meta, setMeta] = useState<Meta | null>(null);

  useEffect(() => {
    if (!isSession && !isZip) return;
    let cancelled = false;
    fetch(`/api/projects/${projectId}/assets/${assetId}/meta`)
      .then((r) => (r.ok ? (r.json() as Promise<Meta>) : null))
      .then((m) => {
        if (!cancelled && m && typeof m.app === 'string') setMeta(m);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId, assetId, isSession, isZip]);

  if (!meta) return null;
  const parts = isSession
    ? [meta.appVersion ? `v${meta.appVersion}` : null, meta.bpm != null ? `${meta.bpm} BPM` : null]
    : [`Bundled ${meta.app} project`];
  const text = parts.filter(Boolean).join(' · ');
  if (!text) return null;
  // On a phone the details sit on their own line; from `sm` they follow the file name.
  return (
    <span data-testid={`project-file-daw-${assetId}`} className="block sm:inline">
      <span className="hidden sm:inline"> · </span>
      {text}
    </span>
  );
}
