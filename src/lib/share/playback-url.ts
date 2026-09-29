/**
 * Server-only half of lib/share/playback: the URL a share page's player gets.
 * Kept apart so the pure rules can be imported by client components without
 * pulling the HMAC signer into the browser bundle.
 */
import { cdnAudioSrc } from '@/lib/audio/cdn';
import { signedSharePreviewUrl } from '@/lib/share-media-token';
import type { PlaybackTrack } from './playback';

/**
 * Preview mode may point straight at the public clip on the CDN (fast,
 * edge-cached, public by design). Full mode always goes through the signed
 * grant route: the master lives in the private bucket and its reference never
 * appears in public JSON.
 */
export function sharePlaybackUrl(track: PlaybackTrack, token: string, full: boolean): string {
  if (!full) {
    const clip = track.preview_url;
    if (typeof clip === 'string' && /^https?:\/\//i.test(clip)) return cdnAudioSrc(clip);
  }
  return signedSharePreviewUrl(token, track.id);
}
