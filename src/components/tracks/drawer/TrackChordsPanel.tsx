'use client';

import { useEffect, useState } from 'react';
import { Download, Loader2, Music2 } from 'lucide-react';
import type { Track } from '@/lib/types';
import { toast } from '@/hooks/useToast';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import {
  chordMidiFilename,
  chordsToMidiNotes,
  formatChordTime,
  hasPlayableChords,
  writeMidiFile,
  type ChordSegmentInput,
} from '@/lib/audio/chord-midi';

interface Props {
  track: Track;
}

const BUTTON =
  'tap flex min-h-11 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.10] hover:text-white disabled:cursor-not-allowed disabled:opacity-40';

function savedChords(track: Track): ChordSegmentInput[] | null | undefined {
  // `undefined` = the row we were handed didn't select the column (the
  // library list doesn't, to keep the payload small); `null` = never detected.
  if (!('chords' in track)) return undefined;
  return Array.isArray(track.chords) ? track.chords : null;
}

/**
 * "Detect chords" for the track details drawer: runs Essentia chord
 * detection in the browser, shows the timeline, saves it to `tracks.chords`
 * and exports it as a Standard MIDI File at the track's tempo.
 */
export function TrackChordsPanel({ track }: Props) {
  const reducedMotion = useReducedMotion();
  const [chords, setChords] = useState<ChordSegmentInput[] | null>(() => savedChords(track) ?? null);
  const [detecting, setDetecting] = useState(false);

  // Reset per track, and load the saved timeline when the row we were given
  // didn't include it, so reopening the drawer shows it without a re-run.
  useEffect(() => {
    const initial = savedChords(track);
    setChords(initial ?? null);
    if (initial !== undefined) return;
    let cancelled = false;
    fetch(`/api/tracks/${track.id}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((row: { chords?: unknown } | null) => {
        if (!cancelled && row && Array.isArray(row.chords)) setChords(row.chords as ChordSegmentInput[]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // Only when the track changes — not on every parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.id]);

  const playable = hasPlayableChords(chords);
  const visible = (chords ?? []).filter((c) => c.chord !== 'N');

  const handleDetect = async () => {
    if (detecting) return;
    if (!track.audio_url) {
      toast.error('No audio file', 'Upload or replace this track’s source audio before detecting chords.');
      return;
    }
    setDetecting(true);
    try {
      const { detectChordsFromUrl } = await import('@/lib/audio/chords.client');
      const detected = await detectChordsFromUrl(track.audio_url);
      setChords(detected);
      if (!hasPlayableChords(detected)) {
        toast.info('No confident chords found', 'The detector couldn’t lock onto a chord anywhere in this track.');
        return;
      }
      try {
        const res = await fetch(`/api/tracks/${track.id}/analyze`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chords: detected }),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json.error || `HTTP ${res.status}`);
        }
        toast.success('Chords detected', `${detected.filter((c) => c.chord !== 'N').length} changes · saved to the track`);
      } catch (err) {
        toast.warning(
          'Chords detected but not saved',
          `${err instanceof Error ? err.message : 'Network error'} — the MIDI download still works.`,
        );
      }
    } catch (err) {
      toast.error('Chord detection failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setDetecting(false);
    }
  };

  const handleDownload = () => {
    if (!chords || !playable) return;
    const bytes = writeMidiFile(
      chordsToMidiNotes(chords, { durationSeconds: track.duration_seconds, bpm: track.bpm }),
      { bpm: track.bpm },
    );
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'audio/midi' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = chordMidiFilename(track.title);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[9px] font-bold text-white/40 uppercase tracking-widest">Chords</span>
        <div className="flex items-center gap-2">
          {playable && (
            <button type="button" onClick={handleDownload} disabled={detecting} className={BUTTON} aria-label="Download MIDI" title="Download the chords as a MIDI file">
              <Download size={11} />
              MIDI
            </button>
          )}
          <button
            type="button"
            onClick={handleDetect}
            disabled={detecting || !track.audio_url}
            aria-busy={detecting}
            title={track.audio_url ? 'Detect this track’s chords' : 'Upload source audio before detecting chords'}
            className={BUTTON}
          >
            {detecting ? (
              <Loader2 size={11} className={reducedMotion ? undefined : 'animate-spin'} />
            ) : (
              <Music2 size={11} />
            )}
            {detecting ? 'Detecting…' : chords && chords.length ? 'Re-detect' : 'Detect chords'}
          </button>
        </div>
      </div>

      {visible.length > 0 ? (
        <ol aria-label="Chord timeline" className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
          {visible.map((c, i) => (
            <li
              key={`${c.time}-${i}`}
              className="flex items-baseline gap-1.5 rounded-lg border border-white/10 px-2 py-1 font-mono text-[10px]"
            >
              <span className="text-white/30">{formatChordTime(c.time)}</span>
              <span className="text-white/80">{c.chord}</span>
            </li>
          ))}
        </ol>
      ) : chords && !detecting ? (
        <p className="text-xs text-white/40">No confident chords found.</p>
      ) : null}
    </div>
  );
}
