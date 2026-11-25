'use client';

/**
 * Every file a track has, in one list (AUDIO-01): master, WAV, stems — each
 * with the same storage and offline wording the offline page, the project
 * Files section and the Studio use (`lib/assets`). Read-only: saving offline
 * stays on the controls that already do it. Stems are read only when the
 * track says they are done, through the same stems API the Studio uses.
 */
import { useEffect, useMemo, useState } from 'react';
import { useOfflineCache } from '@/hooks/useOfflineCache';
import {
  assetKindLabel,
  assetsOfTrack,
  locationLabel,
  offlineCacheId,
  offlineLabel,
  withOfflineState,
  type StemRefs,
} from '@/lib/assets';

interface Props {
  trackId: string;
  title?: string | null;
  audioUrl?: string | null;
  wavUrl?: string | null;
  stemsDone?: boolean;
}

const LABEL = 'text-[10px] font-mono uppercase tracking-[0.2em] text-white/40';

export function TrackFilesSection({ trackId, title, audioUrl, wavUrl, stemsDone }: Props) {
  // Keyed by track so a previous track's stems never show against the next one.
  const [loaded, setLoaded] = useState<{ trackId: string; refs: StemRefs } | null>(null);
  const stems = stemsDone && loaded?.trackId === trackId ? loaded.refs : null;
  const { cached } = useOfflineCache();

  useEffect(() => {
    if (!stemsDone) return;
    let cancelled = false;
    fetch(`/api/stems?track_id=${encodeURIComponent(trackId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const s = d?.stem || d?.stems || d;
        if (cancelled || !s) return;
        setLoaded({ trackId, refs: { vocals: s.vocals_url, drums: s.drums_url, bass: s.bass_url, other: s.other_url } });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [trackId, stemsDone]);

  const rows = useMemo(() => {
    const byId = new Map(cached.map((m) => [m.id, m]));
    return withOfflineState(
      assetsOfTrack({ id: trackId, title, audio_url: audioUrl, wav_url: wavUrl }, stems),
      offlineCacheId,
      byId,
    );
  }, [trackId, title, audioUrl, wavUrl, stems, cached]);

  if (rows.length === 0) return null;
  return (
    <section aria-label="Files" data-testid="track-files">
      <p className={LABEL}>Files</p>
      <ul className="mt-2 divide-y divide-white/[0.06]">
        {rows.map((a) => {
          const word = offlineLabel(a.offline);
          return (
            <li key={a.id} className="flex items-center justify-between gap-3 py-2 text-[11px]" data-testid={`track-file-${a.source}${a.kind === 'stem' ? `-${a.id.split(':').pop()}` : ''}`}>
              <span className="min-w-0 truncate text-white/80">{a.label}</span>
              <span className="flex shrink-0 items-center gap-3 font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">
                <span>{assetKindLabel(a.kind)} · {locationLabel(a.location)}</span>
                {word && <span className={a.offline === 'saved' ? 'text-[#6DC6A4]' : a.offline === 'stale' ? 'text-white/70' : ''}>{word}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
