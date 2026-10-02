'use client';

import { usePlayer } from '@/hooks/usePlayer';
import { logPlay } from '@/lib/buyer-session';
import type { BuyerLibraryTrackSummary } from '@/lib/store/buyer-library';
import { buyerPlayerQueue, buyerPlayerTrack } from '@/lib/store/buyer-playback';

/**
 * Plays a beat from a buyer account page through the app's one global player
 * (`usePlayer` -> the `PlayerBar` the store layout mounts). Pressing the beat
 * that is already loaded toggles it; any other beat replaces the queue with
 * the list it was pressed in, so Next walks that list.
 *
 * `identityQuery` is how the page proves who the buyer is to the audio and
 * play-log routes: `session=1` on /store/account/me, `token=<encoded>` on the
 * legacy /store/account/[token] page.
 *
 * Starting a different beat logs a play; pause/resume does not. The store's
 * grid logs through `trackStoreEvent`, which these pages never call, so this
 * is the only write. Best-effort: `logPlay` swallows failures.
 */
export function useBuyerPlayback(identityQuery: string) {
  const { currentTrack, isPlaying, setTrack, setQueue, togglePlay } = usePlayer();
  const isPlayingTrack = (id: string) => currentTrack?.id === id && isPlaying;
  const play = (track: BuyerLibraryTrackSummary, list: Array<BuyerLibraryTrackSummary | null>) => {
    if (currentTrack?.id === track.id) {
      togglePlay();
      return;
    }
    setQueue(buyerPlayerQueue(list, identityQuery));
    setTrack(buyerPlayerTrack(track, identityQuery));
    void logPlay(track.id, identityQuery);
  };
  return { isPlayingTrack, play };
}
