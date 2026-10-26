'use client';

/**
 * The stage of a song as a control (LABEL-24, 07 §2.3): a `Dropdown` of the
 * stages this member may move it to, taken from `allowedTransitions` — the
 * same function the route enforces, so the menu never offers a move the route
 * refuses. A member with no move (read-only roles, an artist past Inbox, an
 * archived-only song's reader…) sees the stage as a plain chip, not a menu.
 * A failed move shows a toast and leaves the stage as it was.
 */
import { useState } from 'react';
import { Dropdown } from '@/components/ui/Dropdown';
import { toast } from '@/hooks/useToast';
import { useOrgShell } from '@/components/labelos/OrgShellContext';
import { SONG_STAGE_LABEL, allowedTransitions, isSongStage, type SongStage } from '@/lib/labelos/song-stage';
import { postSongStage } from '@/lib/labelos/song-stage-client';

const CHIP = 'shrink-0 rounded-lg border border-white/20 px-2 py-0.5 text-[11px] text-white/70';

export function SongStageControl({
  orgId,
  songId,
  stage,
  onMoved,
  testId,
}: {
  orgId: string;
  songId: string;
  stage: string | null;
  onMoved?: (stage: SongStage) => void;
  testId?: string;
}) {
  const shell = useOrgShell();
  const [moved, setMoved] = useState<{ from: string | null; stage: SongStage } | null>(null);
  const [busy, setBusy] = useState(false);
  // A newer stage from the server (a refresh) wins over what this control last moved to.
  const shown = moved && moved.from === stage ? moved.stage : stage;
  const label = isSongStage(shown) ? SONG_STAGE_LABEL[shown] : shown ?? '—';

  const allowed = shell && isSongStage(shown) ? allowedTransitions(shown, new Set(shell.capabilities), shell.role) : [];
  if (allowed.length === 0 || !isSongStage(shown)) {
    return <span className={CHIP} data-testid={testId}>{label}</span>;
  }

  const from = shown;
  const move = async (to: SongStage) => {
    if (busy) return;
    setBusy(true);
    const res = await postSongStage(orgId, songId, to, from);
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setMoved({ from: stage, stage: res.stage });
    onMoved?.(res.stage);
    toast.success(`Moved to ${SONG_STAGE_LABEL[res.stage]}`);
  };

  return (
    <span className="inline-flex" data-testid={testId} data-stage={from}>
      <Dropdown<string>
        value=""
        placeholder={label}
        disabled={busy}
        aria-label={`Stage: ${label}. Move to…`}
        options={allowed.map((s) => ({ value: s, label: SONG_STAGE_LABEL[s] }))}
        onChange={(v) => { if (isSongStage(v)) void move(v); }}
      />
    </span>
  );
}
