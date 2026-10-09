'use client';

/**
 * The org project page's comments (LABEL-22): the whole project's discussion,
 * or one recording's — chosen with a picker of the project's recordings (the
 * ones this member may hear) — so a version's open threads carry forward on
 * the current one. Everything else is `OrgComments`.
 */
import { useMemo, useState } from 'react';
import { Dropdown } from '@/components/ui/Dropdown';
import { OrgComments } from '@/components/labelos/OrgComments';
import { usePlayer } from '@/hooks/usePlayer';

const WHOLE = '';

export function OrgProjectComments({ orgId, projectId }: { orgId: string; projectId: string }) {
  const [recordings, setRecordings] = useState<{ id: string; title: string }[]>([]);
  const [trackId, setTrackId] = useState<string>(WHOLE);
  const loaded = usePlayer((s) => s.currentTrack);
  const options = useMemo(() => [{ value: WHOLE, label: 'Whole project' }, ...recordings.map((r) => ({ value: r.id, label: r.title }))], [recordings]);
  // A pin needs the length of the recording it is pinned to: known once that recording is the one loaded in the player.
  const duration = trackId && loaded?.id === trackId ? (loaded.duration_seconds ?? null) : null;

  return (
    <section aria-labelledby="org-project-comments" className="mb-10 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="org-project-comments" className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/40">Comments</h2>
        {recordings.length > 0 && <Dropdown aria-label="Comments on" value={trackId} onChange={setTrackId} options={options} placeholder="Whole project" />}
      </div>
      <div className="rounded-xl border border-white/10 bg-[#0D0D0A] p-4">
        <OrgComments orgId={orgId} projectId={projectId} trackId={trackId || null} durationSeconds={duration} onRecordings={setRecordings} />
      </div>
    </section>
  );
}
