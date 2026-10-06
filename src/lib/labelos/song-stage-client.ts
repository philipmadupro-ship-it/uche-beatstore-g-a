/**
 * The browser's side of a stage move (LABEL-24): POST it and say what happened
 * in words a toast can show. Pure of React.
 */
import type { SongStage } from './song-stage';

export type MoveResult = { ok: true; stage: SongStage } | { ok: false; error: string };

const FAILED = 'Could not move the song.';

/** `from` is the stage the screen shows: if someone moved the song meanwhile the server answers 409 and nothing changes. */
export async function postSongStage(orgId: string, songId: string, to: SongStage, from: SongStage): Promise<MoveResult> {
  try {
    const res = await fetch(`/api/org/${orgId}/tracks/${songId}/stage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to, from }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string; to?: SongStage };
    if (!res.ok) return { ok: false, error: body.error ?? FAILED };
    return { ok: true, stage: body.to ?? to };
  } catch {
    return { ok: false, error: FAILED };
  }
}
