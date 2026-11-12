'use client';

import { useCallback, type ReactNode } from 'react';
import { Download, Link2, Loader2, Music } from 'lucide-react';
import { ArtworkFallback } from '@/components/ui/ArtworkFallback';
import { Fact } from '@/components/projects/ProjectDetailHeader';
import { ShareActions } from '@/components/share/ShareActions';
import { ShareTrackList, type ShareListItem, type ShareRowDownload } from '@/components/share/ShareTrackList';
import { ShareTransportBar } from '@/components/share/ShareTransportBar';
import { ShareWaveformVinyl } from '@/components/share/ShareWaveformVinyl';
import { useShareTransport } from '@/components/share/ShareTransport';
import { copyToClipboard } from '@/lib/clipboard';
import { fmtDuration } from '@/lib/audio/format';
import { toast } from '@/hooks/useToast';

export interface ShareFrameProject {
  id: string;
  name: string;
  cover_url?: string | null;
  description?: string | null;
}

export interface ShareFrameOptions {
  allowDownloads: boolean;
  fullPlayback: boolean;
  collaboration?: { role: 'commenter' | 'editor'; commentCount: number; onOpen: () => void } | null;
}

interface Props<T extends ShareListItem> {
  project: ShareFrameProject;
  producerName?: string | null;
  tracks: T[];
  options: ShareFrameOptions;
  playingId?: string | null;
  isPlaying?: boolean;
  onPlay: (track: T) => void;
  /** The page's one engine draws its waveform here, under the vinyl. */
  waveRef?: React.RefObject<HTMLDivElement | null>;
  rowDownload?: ShareRowDownload;
  /** Client variant: a licence / Buy control per row, in the row's last column. */
  buy?: (track: T) => ReactNode;
  /** One zip of every track; offered only when downloads are allowed (rows carry their own Download). */
  onDownloadAll?: () => void;
  downloadingAll?: boolean;
  /** Extra header actions (the client variant's cart button, a discount chip). */
  headerExtras?: ReactNode;
  /** Variant detail columns for the rows (title is always first). */
  columnIds?: string[];
  /** Variant details, under the list. */
  children?: ReactNode;
}

/** The URL a recipient would paste: this page, without the checkout and view params. */
function shareUrl(): string {
  const u = new URL(window.location.href);
  for (const k of ['purchase', 'session_id', 'q', 'sort', 'type', 'genre', 'tag', 'key', 'bpmMin', 'bpmMax', 'scale']) u.searchParams.delete(k);
  return u.toString();
}

/**
 * The one frame every share variant renders: a simplified, read-only project
 * header (cover, name, description, facts, the share's actions), the vinyl that
 * shows the engine's state, the Library toolbar and rows under it at full
 * width, the variant's own details, and the bottom transport bar. The four
 * variants differ in the details they hang under the list, not in the page.
 */
export function SharePageFrame<T extends ShareListItem>({
  project, producerName, tracks, options, playingId, isPlaying, onPlay, waveRef, rowDownload, buy, headerExtras, columnIds, onDownloadAll, downloadingAll, children,
}: Props<T>) {
  const transport = useShareTransport();
  const total = tracks.reduce((sum, t) => sum + (t.duration_seconds ?? 0), 0);
  const current = transport?.track ?? null;

  const copyLink = useCallback(async () => {
    const ok = await copyToClipboard(shareUrl());
    if (ok) toast.success('Link copied');
    else toast.error('Could not copy the link');
  }, []);

  return (
    <div className="min-h-screen bg-[#090907] text-white">
      <div className="mx-auto max-w-6xl px-4 pb-40 pt-8 sm:px-6 sm:pt-12 md:px-10">
        <header data-testid="share-header" className="mb-8 flex flex-col gap-8 sm:mb-10 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 flex-col gap-5 sm:flex-row sm:items-end">
            <div className="relative size-32 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-[#0D0D0A] sm:size-44">
              <ArtworkFallback src={project.cover_url} seed={project.id} kind="project" sizes="176px" className="object-cover">
                <Music size={20} aria-hidden="true" />
              </ArtworkFallback>
            </div>
            <div className="flex min-w-0 flex-col gap-4">
              <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/50">Shared with you</p>
              <h1 className="text-2xl font-black uppercase leading-none tracking-tight text-white sm:text-4xl">{project.name}</h1>
              <div className="flex flex-wrap items-center gap-1.5">
                <Fact>{tracks.length} track{tracks.length !== 1 ? 's' : ''}</Fact>
                {total > 0 && <Fact>{fmtDuration(total)}</Fact>}
                {producerName && <Fact>{producerName}</Fact>}
              </div>
              {project.description && (
                <p className="max-w-2xl text-[11px] leading-relaxed text-white/60">{project.description}</p>
              )}
              <ShareActions allowDownloads={options.allowDownloads} fullPlayback={options.fullPlayback} collaboration={options.collaboration}>
                {headerExtras}
                {onDownloadAll && rowDownload?.allowed && tracks.length > 1 && (
                  <button
                    type="button"
                    onClick={onDownloadAll}
                    disabled={downloadingAll}
                    className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[11px] font-medium text-white transition-all hover:border-white/[0.12] hover:bg-white/[0.08] disabled:opacity-40 sm:gap-2 sm:px-4"
                  >
                    {downloadingAll ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <Download size={12} aria-hidden="true" />}
                    Download all
                  </button>
                )}
                <button
                  type="button"
                  onClick={copyLink}
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.06] bg-transparent px-3 py-2 text-[11px] font-medium text-white/60 transition-all hover:border-white/[0.1] hover:text-white sm:gap-2 sm:px-4"
                >
                  <Link2 size={12} aria-hidden="true" />
                  Copy link
                </button>
              </ShareActions>
            </div>
          </div>

          {/* Now playing: the vinyl turns while the engine is really playing,
              and the page's one engine draws its waveform into this container. */}
          <div className="w-full shrink-0 lg:w-[280px]">
            <ShareWaveformVinyl
              track={current ? { ...current, type: current.type ?? 'beat', audio_url: current.audio_url ?? '' } : null}
              projectCover={project.cover_url}
              isPlaying={transport?.playing ?? false}
              playingId={current?.id ?? null}
              onTogglePlay={transport ? () => transport.toggle() : undefined}
              size="compact"
              waveRef={waveRef}
            />
          </div>
        </header>

        <ShareTrackList
          tracks={tracks}
          playingId={playingId}
          isPlaying={isPlaying}
          onPlay={onPlay}
          download={rowDownload}
          buy={buy}
          columnIds={columnIds}
        />

        {children}
      </div>
      <ShareTransportBar />
    </div>
  );
}
