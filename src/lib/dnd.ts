/**
 * Cross-page drag-and-drop payload helpers.
 *
 * The HTML5 DataTransfer API is a string bus — every payload is a MIME
 * type → string. We define a single custom type and a typed JSON shape
 * so drag sources (TrackCard, TrackRow) and drop targets (contact rows,
 * playlist rows, project rows) agree on what gets passed.
 *
 * Why a custom type instead of `application/json` or `text/plain`:
 *   - Browsers expose `text/plain` as the user's selected text — we'd
 *     get false drops when they drag highlighted text into a contact row.
 *   - Custom types let us discriminate "this is OUR drag" from arbitrary
 *     OS drags (files, etc) by checking `event.dataTransfer.types`.
 *
 * DRAG-OUT (dashboard only): a producer dragging their own track card
 * toward the desktop — a DAW, Finder, Explorer — should be able to drop a
 * real audio file, not just the track's name as text. Chromium (Chrome,
 * Edge, Electron-based DAW hosts) supports this via the `DownloadURL`
 * dataTransfer type: `<mime>:<filename>:<absolute-url>`. When the OS
 * drop target isn't a web page, Chromium's browser process itself fetches
 * that URL and writes the file to disk. Firefox and Safari don't
 * implement `DownloadURL` at all — they simply never look at that type,
 * so the drag falls back to the existing `text/plain` title. That is a
 * silent, honest degradation: we never claim the affordance works (no
 * "drag to your DAW" label is shown), so there's nothing to lie about on
 * non-Chromium browsers.
 */

export const DND_TRACK_TYPE = 'application/x-antigravity-track';

export interface TrackDragPayload {
  kind: 'track';
  id: string;
  title: string;
  cover_url?: string | null;
}

/**
 * Windows forbids these device names as a bare filename, with or without
 * an extension (`CON`, `CON.wav` are both illegal on that filesystem). A
 * producer's own beat titles collide with this list more than you'd
 * think ("Con Artist" → "Con" if truncated elsewhere), so we guard it.
 */
const WINDOWS_RESERVED_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

// Control characters plus every character Windows forbids in a filename.
// `/` and `\` double as path separators on the two platforms that matter.
const UNSAFE_FILENAME_CHARS = /[\x00-\x1f<>:"/\\|?*]/g;

const MAX_FILENAME_LENGTH = 150;

/**
 * Turn a track title into a filesystem-safe filename with the given
 * extension. Pure — no DOM, no network — so it's fully unit-testable.
 *
 * Rules: strip path separators and control/reserved characters, strip
 * leading dots (would otherwise create a hidden dotfile), trim trailing
 * dots/spaces (Windows silently drops them, which can make two different
 * titles collide), rename a bare Windows-reserved device name, and never
 * produce an empty name.
 */
export function sanitizeDownloadFilename(rawTitle: string, extension: string): string {
  let name = (rawTitle ?? '').replace(UNSAFE_FILENAME_CHARS, ' ');
  name = name.replace(/\s+/g, ' ').trim();
  // Strip any leading run of dots/spaces together — "../../etc" becomes
  // "..  .. etc" after path separators turn to spaces, and a dots-only
  // strip would leave the interleaved spaces behind.
  name = name.replace(/^[.\s]+/, '');
  name = name.replace(/[.\s]+$/, '');
  if (!name) name = 'track';
  if (name.length > MAX_FILENAME_LENGTH) {
    name = name.slice(0, MAX_FILENAME_LENGTH).trim() || 'track';
  }

  const bareUpper = name.toUpperCase().split('.')[0];
  if (WINDOWS_RESERVED_NAMES.has(bareUpper)) {
    name = `${name}_`;
  }

  const cleanExt = (extension || '').replace(/^\.+/, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const ext = cleanExt || 'mp3';
  return `${name}.${ext}`;
}

/**
 * Best-effort file extension from a stored audio URL — including the
 * opaque `r2://bucket/key.ext` form, which still has a real filename as
 * its last path segment.
 */
export function extensionFromAudioUrl(url: string): string {
  const withoutQuery = (url || '').split(/[?#]/)[0];
  const last = withoutQuery.split('/').pop() || '';
  const dot = last.lastIndexOf('.');
  if (dot === -1 || dot === last.length - 1) return 'mp3';
  return last.slice(dot + 1).toLowerCase();
}

const AUDIO_MIME_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  aiff: 'audio/aiff',
};

export function audioMimeTypeForExtension(extension: string): string {
  return AUDIO_MIME_TYPES[extension.toLowerCase()] || 'audio/mpeg';
}

/**
 * Whether a track can be dragged out of the app as a real file at all.
 * A track with no resolvable audio source has nothing to fetch — the
 * drag should still carry the in-app payload and the text/plain title,
 * just not a `DownloadURL` entry that would 404.
 */
export function canDragTrackOutOfApp(track: { audio_url?: string | null }): boolean {
  return typeof track.audio_url === 'string' && track.audio_url.trim().length > 0;
}

/**
 * Build the absolute URL Chromium's browser process will fetch for a
 * drag-out. It always routes through the authenticated `/api/audio`
 * proxy (never a raw R2 URL, and never a bare `r2://` reference — that's
 * an opaque key, not something a browser can fetch): the proxy already
 * requires a signed-in Supabase session (401s otherwise), so a dragged
 * file is exactly as private as playback already is. `download=1` makes
 * the response a `Content-Disposition: attachment` with our sanitised
 * filename, and it works whether the underlying source is a private R2
 * object, a public R2 URL, or a local `/uploads` file — `/api/audio`
 * resolves all three today.
 */
export function buildTrackDownloadUrl(origin: string, audioUrl: string, filename: string): string {
  const base = origin.replace(/\/+$/, '');
  const params = new URLSearchParams({ src: audioUrl, download: '1', filename });
  return `${base}/api/audio?${params.toString()}`;
}

/**
 * Chromium's `DownloadURL` dataTransfer value: a colon-delimited
 * `mime:filename:url` triple. Only the trailing URL is allowed to
 * contain colons (e.g. `https://`), so the mime type and filename are
 * defensively stripped of any — `sanitizeDownloadFilename` already
 * excludes `:` from filenames, this just protects the format itself if
 * that ever changes.
 */
export function formatDownloadUrlData(mimeType: string, filename: string, absoluteUrl: string): string {
  const safeMime = mimeType.replace(/:/g, '');
  const safeFilename = filename.replace(/:/g, '');
  return `${safeMime}:${safeFilename}:${absoluteUrl}`;
}

export function setTrackDragData(
  e: React.DragEvent,
  payload: Omit<TrackDragPayload, 'kind'>,
  audioUrl?: string | null,
) {
  // Need to set effectAllowed for the cursor to show the right
  // "copy/move/link" affordance. We're not moving the source, so 'copy'.
  e.dataTransfer.effectAllowed = 'copy';
  e.dataTransfer.setData(
    DND_TRACK_TYPE,
    JSON.stringify({ kind: 'track', id: payload.id, title: payload.title, cover_url: payload.cover_url }),
  );
  // text/plain fallback so dropping into an external text input still
  // produces something sensible (the track title). This is also what
  // Firefox/Safari fall back to when they ignore DownloadURL below.
  e.dataTransfer.setData('text/plain', payload.title);

  // Drag-out-of-app: only when there's a real audio source and we're in a
  // browser (this module is also imported by non-DOM test contexts).
  if (audioUrl && canDragTrackOutOfApp({ audio_url: audioUrl }) && typeof window !== 'undefined') {
    const extension = extensionFromAudioUrl(audioUrl);
    const filename = sanitizeDownloadFilename(payload.title, extension);
    const mimeType = audioMimeTypeForExtension(extension);
    const url = buildTrackDownloadUrl(window.location.origin, audioUrl, filename);
    e.dataTransfer.setData('DownloadURL', formatDownloadUrlData(mimeType, filename, url));
  }
}

export function readTrackDragData(e: React.DragEvent): TrackDragPayload | null {
  // Browsers serialize the data lazily — we can't peek during dragover
  // (the spec restricts getData() there for security). Use this on drop.
  try {
    const raw = e.dataTransfer.getData(DND_TRACK_TYPE);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.kind === 'track' && typeof parsed.id === 'string') {
      return parsed as TrackDragPayload;
    }
  } catch {
    // Bad JSON or external drag — silently reject.
  }
  return null;
}

/**
 * Check during dragover whether the active drag carries our track type.
 * Used to decide if the drop target should preventDefault() (which
 * makes it "valid" — the cursor changes) and apply hover styling.
 *
 * We can't read the actual data here (browser security restriction),
 * but the *type* is accessible via `types`.
 */
export function isTrackDrag(e: React.DragEvent): boolean {
  // dataTransfer.types is a DOMStringList in some browsers, an Array in
  // others — `includes` works on both.
  return e.dataTransfer.types.includes(DND_TRACK_TYPE);
}

/**
 * Whether a dragstart originating inside a draggable track row should be
 * allowed to hijack the gesture into a card drag, or left alone so a
 * button click / text selection / inline-rename field keeps working.
 * Browsers start a drag from the nearest `draggable` ancestor even when
 * the press began on a nested `<button>`, so without this check clicking
 * "Rename" or the row's ⋯ menu can occasionally fire a one-pixel drag
 * instead of the click.
 */
export function isInteractiveDragStartTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  // `[role="slider"]` covers the row waveform: pressing on it means seek, and
  // without this a press-and-move there started dragging the whole row.
  return (
    target.closest('button, input, textarea, select, a, [contenteditable="true"], [role="slider"]') !== null
  );
}
