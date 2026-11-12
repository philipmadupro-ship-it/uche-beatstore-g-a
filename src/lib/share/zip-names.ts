/**
 * File names inside a share's "Download all" zip.
 *
 * Each entry is `NN Title.ext`: the number keeps the producer's order and makes
 * every name unique (two beats called "Untitled" must not overwrite each other
 * in the archive), and the title is stripped of anything an unzipper would read
 * as a path (`..`, slashes, control characters). The extension comes from the
 * stored master, defaulting to mp3 exactly as the single-track download does.
 */

const EXT_RE = /\.(mp3|wav|flac|aiff|aif|m4a|ogg)(?:\?|$)/i;

export function safeEntryTitle(title: string | null | undefined): string {
  const cleaned = (title ?? '')
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, ' ')
    .replace(/\.{2,}/g, '.')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 120)
    .trim();
  return cleaned || 'track';
}

export function zipEntryNames(items: readonly { title?: string | null; audio_url?: string | null }[]): string[] {
  const width = Math.max(2, String(items.length).length);
  return items.map((item, i) => {
    const ext = (item.audio_url?.match(EXT_RE)?.[1] ?? 'mp3').toLowerCase();
    return `${String(i + 1).padStart(width, '0')} ${safeEntryTitle(item.title)}.${ext}`;
  });
}

/** A zip's own file name from the share's label, safe in a Content-Disposition header. */
export function shareZipName(label: string | null | undefined): string {
  return `${safeEntryTitle(label || 'share')}.zip`;
}
