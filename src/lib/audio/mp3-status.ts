import { canDeriveMp3, isMp3Master } from './mp3-deliverable';

/**
 * What the producer is told about the MP3 a lease on this track delivers.
 *
 * A lease tier promises MP3. If the master is an MP3 there is nothing to do; if
 * it is a WAV (or flac/aiff/m4a/ogg) the MP3 is made from it — at upload, or on
 * the first download (lib/audio/mp3-deliverable). This is the one place that
 * turns "what is the master" + "does a current derivative exist" into wording,
 * so the drawer cannot say "ready" about something that is not.
 *
 * `derivativeExists` is null when it could not be checked (no private storage
 * in local dev, or the lookup failed): never claimed as ready.
 */
export type Mp3State = 'master' | 'ready' | 'pending' | 'unsupported' | 'no-audio';

export type Mp3Status = {
  state: Mp3State;
  /** Short pill text. */
  label: string;
  /** One sentence for the producer. */
  detail: string;
  /** Whether "Make MP3 now" is offered. */
  canMake: boolean;
};

export function mp3Status(audioUrl: string | null | undefined, derivativeExists: boolean | null): Mp3Status {
  if (!audioUrl) {
    return { state: 'no-audio', label: 'No audio', detail: 'This track has no audio file, so there is no MP3 to deliver.', canMake: false };
  }
  if (isMp3Master(audioUrl)) {
    return { state: 'master', label: 'MP3 ready', detail: 'The master is already an MP3, so a lease delivers it as it is.', canMake: false };
  }
  if (!canDeriveMp3(audioUrl)) {
    return { state: 'unsupported', label: 'No MP3 possible', detail: 'This file type cannot be turned into an MP3. Upload an MP3 or WAV version of the track.', canMake: false };
  }
  if (derivativeExists === true) {
    return { state: 'ready', label: 'MP3 ready', detail: 'A 320 kbps MP3 has been made from your master and is what a lease delivers.', canMake: false };
  }
  return {
    state: 'pending',
    label: 'MP3 not made yet',
    detail: 'A lease delivers an MP3 made from your master. It is made the first time a buyer downloads it — make it now so nobody waits.',
    canMake: true,
  };
}
