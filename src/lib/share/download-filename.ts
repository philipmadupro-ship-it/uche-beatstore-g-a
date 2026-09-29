/**
 * The file name a share download saves under, taken from the gated route's
 * Content-Disposition (lib/audio/stream-source names it from the master, so a
 * WAV stays .wav). The page used to guess the extension from `audio_url`, but a
 * recipient's `audio_url` is a signed stream URL with no extension, so every
 * download saved as .mp3.
 */
export function downloadFilename(contentDisposition: string | null | undefined, title: string | null | undefined): string {
  const fallback = `${(title || 'track').replace(/[\\/:*?"<>|]+/g, '_')}.mp3`;
  if (!contentDisposition) return fallback;

  const star = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(contentDisposition);
  if (star) {
    try {
      const decoded = decodeURIComponent(star[1].trim());
      if (decoded) return decoded;
    } catch {
      /* malformed percent-encoding: fall through to the plain parameter */
    }
  }
  const plain = /filename\s*=\s*"([^"]+)"|filename\s*=\s*([^;]+)/i.exec(contentDisposition);
  const name = (plain?.[1] ?? plain?.[2] ?? '').trim();
  return name || fallback;
}
