'use client';

/**
 * Song detail in an organization (LABEL-17, 07 §2.3) — /o/<slug>/songs/<id>.
 *
 *   Midnight · Nova · SELECTED
 *   Recordings   ▶ Mix (A) · ▶ Master (B) · ▶ Demo …          [A/B]
 *   Projects · Releases
 *
 * Every recording plays through the persistent PlayerBar (`usePlayer`, the
 * (label) layout mounts it) from `/api/org/[orgId]/audio/[trackId]` — never
 * a stored reference. A/B swaps the player between two recordings at the
 * same moment (lib/labelos/org-workspace#abSeekFraction), so the listener
 * compares takes without a restart. Recordings the member's role may not
 * hear (D4: marketing never gets demos, loops or toplines) are absent from
 * the payload and the section says "restricted" (07 §3.4).
 *
 * Tasks on this song (LABEL-23) sit at the foot, the member's own side of them.
 * Reviews, credits, splits and comments are later tasks (LABEL-22–28).
 */

import { useState } from 'react';
import Link from 'next/link';
import { Music, Pause, Play } from 'lucide-react';
import { usePlayer } from '@/hooks/usePlayer';
import { ArtworkFallback } from '@/components/ui/ArtworkFallback';
import { RestrictedNote } from '@/components/artists/OrgArtistWorkspaceTabs';
import { SongStageControl } from '@/components/labelos/SongStageControl';
import { TasksPanel } from '@/components/labelos/TasksPanel';
import { abSeekFraction, toPlayerTrack, type RecordingView } from '@/lib/labelos/org-workspace';
import type { OrgSongDetail } from '@/lib/labelos/org-workspace-store';

const LABEL = 'text-[10px] font-mono uppercase tracking-[0.2em] text-white/40';
const CHIP = 'rounded-lg border px-2 py-0.5 text-[11px] transition-colors';
const CHIP_REST = 'border-white/10 bg-white/[0.06] text-white/60 hover:border-white/20 hover:bg-white/[0.10]';
const CHIP_ON = 'border-white/30 bg-white/[0.14] text-white';

function recordingsText(n: number): string {
  return `${n} more recording${n === 1 ? '' : 's'} (working material — demos, loops, toplines, beats): restricted for your role.`;
}

/**
 * Play `rec`, starting at the moment `from` (the recording now loaded) had
 * reached. The seek is applied straight away when the target's length is
 * known (the engine resolves it before metadata); otherwise on the first
 * progress tick of the new element, once its own duration exists.
 */
export function playRecordingAt(orgId: string, song: OrgSongDetail['song'], rec: RecordingView, from: RecordingView | null): void {
  const state = usePlayer.getState();
  const fraction = from && state.currentTrack?.id === from.trackId ? abSeekFraction(state.progress, from.durationSeconds, rec.durationSeconds) : 0;
  state.setTrack(toPlayerTrack(orgId, rec, song));
  if (fraction <= 0) return;
  if (rec.durationSeconds) {
    usePlayer.getState().seekTo(fraction);
    return;
  }
  const unsubscribe = usePlayer.subscribe((s) => {
    if (s.currentTrack?.id !== rec.trackId) { unsubscribe(); return; }
    if (s.progress > 0) {
      unsubscribe();
      usePlayer.getState().seekTo(fraction);
    }
  });
}

export function OrgSongView({ orgId, orgSlug, detail }: { orgId: string; orgSlug: string; detail: OrgSongDetail }) {
  const { song, recordings } = detail;
  const base = `/o/${orgSlug}`;
  const currentId = usePlayer((s) => s.currentTrack?.id ?? null);
  const isPlaying = usePlayer((s) => s.isPlaying);
  const [a, setA] = useState<string | null>(recordings[0]?.trackId ?? null);
  const [b, setB] = useState<string | null>(recordings[1]?.trackId ?? null);
  const byId = new Map(recordings.map((r) => [r.trackId, r]));
  const loaded = currentId ? byId.get(currentId) ?? null : null;

  const toggle = (rec: RecordingView) => {
    if (currentId === rec.trackId) { usePlayer.getState().togglePlay(); return; }
    // From another recording of THIS song: keep the moment (that is what A/B is for).
    playRecordingAt(orgId, song, rec, loaded);
  };

  const swap = () => {
    const ra = a ? byId.get(a) : undefined;
    const rb = b ? byId.get(b) : undefined;
    if (!ra || !rb) return;
    const target = currentId === ra.trackId ? rb : ra;
    playRecordingAt(orgId, song, target, loaded);
  };

  const canAB = !!(a && b && a !== b && byId.has(a) && byId.has(b));
  const playingSide = currentId === a ? 'A' : currentId === b ? 'B' : null;

  return (
    <div className="space-y-8" data-testid="org-song">
      <header className="flex items-start gap-4">
        <span className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-white/[0.06] sm:h-28 sm:w-28">
          <ArtworkFallback src={song.cover_url} seed={song.id} kind="track" sizes="112px" className="object-cover">
            <Music size={20} className="text-white/30" aria-hidden="true" />
          </ArtworkFallback>
        </span>
        <div className="min-w-0 flex-1">
          <p className={`${LABEL} mb-2`}>Song</p>
          <h1 className="font-heading text-[28px] font-bold leading-[1.05] tracking-tight text-white sm:text-[32px] md:text-[40px]">{song.title ?? 'Untitled'}</h1>
          <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-white/60">
            {detail.artists.map((ar, i) => (
              <span key={ar.id}>
                {i > 0 && <span className="mr-2 text-white/30">·</span>}
                <Link href={`${base}/artists/${ar.id}`} className="hover:text-white">{ar.name}</Link>
              </span>
            ))}
            <SongStageControl orgId={orgId} songId={song.id} stage={song.stage} testId="org-song-stage" />
            {song.bpm ? <span className="font-mono text-[10px] text-white/40">{Math.round(song.bpm)} BPM</span> : null}
            {song.key ? <span className="font-mono text-[10px] text-[#c8a47a]">{song.key}</span> : null}
          </p>
        </div>
      </header>

      <section aria-labelledby="org-song-recordings">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="org-song-recordings" className={LABEL}>Recordings</h2>
          <button
            type="button"
            onClick={swap}
            disabled={!canAB}
            aria-label={playingSide ? `Switch to ${playingSide === 'A' ? 'B' : 'A'} at the same moment` : 'Play A, then switch between A and B'}
            className={`rounded-lg border px-3 py-1.5 text-[11px] transition-colors disabled:opacity-40 ${playingSide ? CHIP_ON : CHIP_REST}`}
            data-testid="org-song-ab"
          >
            A/B{playingSide ? ` · ${playingSide}` : ''}
          </button>
        </div>
        {recordings.length === 0 ? (
          <p className="rounded-xl border border-white/10 bg-[#0D0D0A] px-4 py-6 text-center text-[11px] text-white/40">No recording you can play yet.</p>
        ) : (
          <ul className="divide-y divide-white/[0.06] rounded-xl border border-white/10 bg-[#0D0D0A]">
            {recordings.map((r) => {
              const active = currentId === r.trackId;
              const playing = active && isPlaying;
              return (
                <li key={r.trackId} className="flex items-center gap-3 px-3 py-2.5" data-testid={`org-rec-${r.trackId}`}>
                  <button
                    type="button"
                    onClick={() => toggle(r)}
                    aria-label={`${playing ? 'Pause' : 'Play'} ${r.label}`}
                    aria-pressed={active}
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-white/[0.10] ${active ? 'text-white' : 'text-white/60'}`}
                  >
                    {playing ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-[13px] ${active ? 'text-white' : 'text-white/80'}`}>
                      {r.label}{r.current ? <span className="ml-2 text-[11px] text-white/40">current</span> : null}
                    </p>
                    <p className="truncate text-[11px] text-white/40">{r.title ?? 'Untitled'} · {r.recordingClass}</p>
                  </div>
                  <div className="flex shrink-0 gap-1" role="group" aria-label={`Compare ${r.label}`}>
                    <button type="button" aria-pressed={a === r.trackId} onClick={() => { setA(r.trackId); if (b === r.trackId) setB(a); }} className={`${CHIP} ${a === r.trackId ? CHIP_ON : CHIP_REST}`}>A</button>
                    <button type="button" aria-pressed={b === r.trackId} onClick={() => { setB(r.trackId); if (a === r.trackId) setA(b); }} className={`${CHIP} ${b === r.trackId ? CHIP_ON : CHIP_REST}`}>B</button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {detail.restrictedRecordings > 0 && (
          <div className="mt-3"><RestrictedNote testId="org-song-restricted">{recordingsText(detail.restrictedRecordings)}</RestrictedNote></div>
        )}
      </section>

      <section aria-labelledby="org-song-where" className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div>
          <h2 id="org-song-where" className={`${LABEL} mb-3`}>Projects</h2>
          {detail.projects.length === 0 ? (
            <p className="text-[11px] text-white/40">In no project you can see.</p>
          ) : (
            <ul className="space-y-1.5">
              {detail.projects.map((p) => (
                <li key={p.id}><Link href={`${base}/projects/${p.id}`} className="text-[13px] text-white/80 hover:text-white">{p.name}</Link></li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h2 className={`${LABEL} mb-3`}>Releases</h2>
          {detail.releases.length === 0 ? (
            <p className="text-[11px] text-white/40">On no release yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {detail.releases.map((r) => (
                <li key={r.id} className="text-[13px] text-white/80">{r.title} <span className="text-[11px] text-white/40">· {r.state}</span></li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <TasksPanel orgId={orgId} object={{ kind: 'song', id: song.id }} testId="org-song-tasks" />
    </div>
  );
}
