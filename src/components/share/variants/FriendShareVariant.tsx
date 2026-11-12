'use client';

import type { ShareRowDownload } from '@/components/share/ShareTrackList';
import { SharePageFrame, type ShareFrameOptions } from '@/components/share/SharePageFrame';

interface CreatorProfile {
  display_name?: string | null;
  bio?: string | null;
  hero_image_url?: string | null;
  instagram_handle?: string | null;
}

interface Track {
  id: string;
  title: string;
  type: string;
  audio_url: string;
  cover_url?: string | null;
  duration_seconds?: number | null;
}

interface Project {
  id: string;
  name: string;
  cover_url?: string | null;
  description?: string | null;
}

interface Props {
  project: Project;
  tracks: Track[];
  creator: CreatorProfile | null;
  onPlay: (track: Track) => void;
  playingId?: string | null;
  isPlaying?: boolean;
  /** Share options the producer set (downloads, playback, collaboration), for the header. */
  options: ShareFrameOptions;
  /** The page's one audio engine renders its waveform here, under the vinyl. */
  waveRef?: React.RefObject<HTMLDivElement | null>;
  /** Download on the row itself, beside the beat it belongs to. */
  rowDownload?: ShareRowDownload;
}

/** Friend: just listen. The shared frame, nothing hung under it. */
export function FriendShareVariant({ project, tracks, creator, onPlay, playingId, isPlaying, options, waveRef, rowDownload }: Props) {
  return (
    <SharePageFrame
      project={project}
      producerName={creator?.display_name || null}
      tracks={tracks}
      options={options}
      playingId={playingId}
      isPlaying={isPlaying}
      onPlay={onPlay}
      waveRef={waveRef}
      rowDownload={rowDownload}
    />
  );
}
